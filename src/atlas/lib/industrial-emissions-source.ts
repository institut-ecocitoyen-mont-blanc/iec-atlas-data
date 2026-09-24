// Build-time only: the public register distributes national annual ZIP files,
// not a per-facility browser API. Only the small CCPMB subset reaches the client.
import { unzipSync } from "fflate";
import { parse } from "csv-parse/sync";
import { CCPMB_COMMUNES, insideCcpmb } from "./ccpmb-territory.ts";
import type { IndustrialEmission, IndustrialEmissionsData, IndustrialFacility } from "./industrial-emissions.ts";

export const IREP_CATALOGUE_URL = "https://www.georisques.gouv.fr/webappReport/ws/telechargement/irep?anneemin=2003";
const MAX_ARCHIVE = 20_000_000;
const MAX_CSV = 25_000_000;

export function latestIrepArchive(catalogue: unknown, currentYear = new Date().getUTCFullYear()) {
  if (!catalogue || typeof catalogue !== "object" || !("annuel" in catalogue) || !catalogue.annuel || typeof catalogue.annuel !== "object") throw new Error("Catalogue IREP inattendu.");
  const candidates = Object.entries(catalogue.annuel).flatMap(([key, entry]) => {
    if (!/^20\d{2}$/.test(key) || Number(key) >= currentYear || !entry) return [];
    if (typeof entry !== "object" || !("lien" in entry) || !("formatFichier" in entry) || entry.formatFichier !== "zip") throw new Error("Archive IREP inattendue.");
    const url = `https://files.georisques.fr/irep/${key}.zip`;
    if (entry.lien !== url) throw new Error("Adresse d’archive IREP inattendue.");
    return [{ year: Number(key), url }];
  }).sort((a, b) => b.year - a.year);
  if (!candidates.length) throw new Error("Aucune archive IREP publiée.");
  return candidates[0];
}

function csv(bytes: Uint8Array, required: string[]): Record<string, string>[] {
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return parse(content, {
    delimiter: ";", bom: true, skip_empty_lines: true, trim: true, max_record_size: 32768,
    columns: (headers: string[]) => {
      if (new Set(headers).size !== headers.length || required.some((key) => !headers.includes(key))) throw new Error("Colonnes IREP modifiées.");
      return headers;
    },
  });
}

export function parseIrepArchive(archive: Uint8Array, year: number): IndustrialFacility[] {
  if (archive.byteLength > MAX_ARCHIVE || !Number.isInteger(year) || year < 2003) throw new Error("Archive IREP invalide.");
  const establishmentsPath = `${year}/etablissements.csv`, emissionsPath = `${year}/emissions.csv`;
  let total = 0;
  const files = unzipSync(archive, { filter: (file) => {
    if (file.name !== establishmentsPath && file.name !== emissionsPath) return false;
    total += file.originalSize;
    if (total > MAX_CSV) throw new Error("Fichiers IREP trop volumineux.");
    return true;
  } });
  if (!files[establishmentsPath] || !files[emissionsPath]) throw new Error("Fichiers IREP manquants.");
  const facilities = new Map<string, IndustrialFacility>();
  const communes = new Set(CCPMB_COMMUNES.map((commune) => commune.code));
  for (const row of csv(files[establishmentsPath], ["identifiant", "nom_etablissement", "numero_siret", "code_insee", "commune", "coordonnees_x", "coordonnees_y", "code_epsg"])) {
    if (!communes.has(row.code_insee)) continue;
    // Current register supplies WGS84 lon/lat. Do not guess other projections.
    if (row.code_epsg !== "4326") throw new Error("Projection IREP non prise en charge.");
    const lng = Number(row.coordonnees_x), lat = Number(row.coordonnees_y);
    if (!row.coordonnees_x || !row.coordonnees_y || !Number.isFinite(lat) || !Number.isFinite(lng) || !insideCcpmb(lat, lng)) continue;
    if (!/^\d{10}$/.test(row.identifiant) || !row.nom_etablissement || !row.commune || facilities.has(row.identifiant)) throw new Error("Identité IREP absente ou dupliquée.");
    facilities.set(row.identifiant, { id: row.identifiant, name: row.nom_etablissement, siret: row.numero_siret, commune: row.commune, communeCode: row.code_insee, emissions: [] });
  }
  const seen = new Set<string>();
  for (const row of csv(files[emissionsPath], ["identifiant", "code_insee", "annee_emission", "milieu", "polluant", "quantite", "unite"])) {
    const facility = facilities.get(row.identifiant);
    if (!facility) continue;
    if (row.annee_emission !== String(year) || row.code_insee !== facility.communeCode) throw new Error("Année ou commune d’émission IREP incohérente.");
    if (!["Air", "Eau (direct)", "Eau (indirect)", "Sol"].includes(row.milieu) || !row.polluant || !row.unite || row.unite.length > 40) throw new Error("Émission IREP non reconnue.");
    let quantity: IndustrialEmission["quantity"];
    if (row.quantite === "< seuil") quantity = "< seuil";
    else {
      if (!/^\d+(?:[.,]\d+)?(?:e[+-]?\d+)?$/i.test(row.quantite)) throw new Error("Quantité IREP non reconnue.");
      quantity = Number(row.quantite.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Quantité IREP invalide.");
    }
    const key = JSON.stringify([facility.id, row.milieu, row.polluant, row.unite]);
    if (seen.has(key)) throw new Error("Émission IREP dupliquée.");
    seen.add(key);
    facility.emissions.push({ pollutant: row.polluant, medium: row.milieu, quantity, unit: row.unite });
  }
  for (const facility of facilities.values()) facility.emissions.sort((a, b) => a.medium.localeCompare(b.medium, "fr") || a.pollutant.localeCompare(b.pollutant, "fr"));
  return [...facilities.values()];
}

async function boundedDownload(response: Response, maxBytes: number) {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) throw new Error("Téléchargement IREP indisponible ou trop volumineux.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Téléchargement IREP trop volumineux.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function loadIndustrialEmissions(fetcher: typeof fetch = fetch): Promise<IndustrialEmissionsData> {
  try {
    const signal = AbortSignal.timeout(45000);
    const catalogue = await boundedDownload(await fetcher(IREP_CATALOGUE_URL, { signal, next: { revalidate: 3600 } }), 100_000);
    const { year, url } = latestIrepArchive(JSON.parse(new TextDecoder().decode(catalogue)));
    const archive = await boundedDownload(await fetcher(url, { signal, next: { revalidate: 3600 } }), MAX_ARCHIVE);
    return { year, downloadUrl: url, fetchedAt: new Date().toISOString(), facilities: parseIrepArchive(archive, year) };
  } catch (error) {
    console.error("Unable to load IREP emissions", error instanceof Error ? error.message : "Unknown error");
    return { year: null, fetchedAt: null, downloadUrl: null, facilities: [], error: "Les rejets industriels IREP n’ont pas pu être récupérés lors de la reconstruction du site." };
  }
}
