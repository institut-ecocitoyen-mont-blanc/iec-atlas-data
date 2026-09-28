import { CCPMB_COMMUNES, insideCcpmb } from "./ccpmb-territory.ts";
import type { GeorisquesData, GeorisquesSite } from "./georisques.ts";

const communes = new Set(CCPMB_COMMUNES.map(commune => commune.code));
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Format des installations Géorisques inattendu.");
  return value as Record<string, unknown>;
}
export function installationsUrl(page = 1) {
  const query = new URLSearchParams({ code_insee: [...communes].join(","), page: String(page), page_size: "100" });
  return `https://www.georisques.gouv.fr/api/v1/installations_classees?${query}`;
}
function publishedDate(value: unknown) {
  // The API publishes update dates as YYYY-MM-DD/HH-mm-ss without a timezone.
  // Keep the calendar date, rather than inventing a UTC time.
  const day = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) ? day : "";
}
export function parseInstallations(values: unknown[]) {
  const sites: GeorisquesSite[] = [];
  const coverage = { total: 0, mapped: 0, missingCoordinates: 0, outsideTerritory: 0 };
  const ids = new Set<string>();
  for (const value of values) {
    const row = object(value);
    if (!communes.has(text(row.codeInsee))) continue;
    const id = text(row.codeAIOT), name = text(row.raisonSociale);
    if (!/^\d{10}$/.test(id) || ids.has(id) || !name) throw new Error("Installation Géorisques absente ou dupliquée.");
    ids.add(id); coverage.total++;
    const lng = row.longitude, lat = row.latitude;
    if (lng == null || lat == null) { coverage.missingCoordinates++; continue; }
    if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new Error("Coordonnées d’installation invalides.");
    if (!insideCcpmb(lat, lng)) { coverage.outsideTerritory++; continue; }
    if (row.inspections != null && !Array.isArray(row.inspections)) throw new Error("Inspections Géorisques invalides.");
    const dates = (Array.isArray(row.inspections) ? row.inspections : []).map(value => publishedDate(object(value).dateInspection)).filter(Boolean).sort();
    sites.push({ id: `AIOT${id}`, name, commune: text(row.commune), communeCode: text(row.codeInsee),
      address: [row.adresse1, row.adresse2, row.adresse3, row.codePostal].map(text).filter(Boolean).join(" · "),
      geometry: { type: "Point", coordinates: [lng, lat] },
      records: [{ id, kind: "installation", status: text(row.etatActivite), regime: text(row.regime), seveso: text(row.statutSeveso),
        inspectionService: text(row.serviceAIOT), lastInspectionAt: dates.at(-1) ?? "", updatedAt: publishedDate(row.date_maj),
        url: `https://www.georisques.gouv.fr/risques/installations/donnees/details/${id}` }],
    });
    coverage.mapped++;
  }
  return { sites, coverage };
}
export async function loadInstallations(fetcher: typeof fetch = fetch): Promise<{ sites: GeorisquesSite[]; coverage: NonNullable<GeorisquesData["installations"]> }> {
  const signal = AbortSignal.timeout(60000), values: unknown[] = [];
  let expected: number | undefined, pages: number | undefined;
  for (let page = 1; page <= 10; page++) {
    const response = await fetcher(installationsUrl(page), { signal });
    if (!response.ok) throw new Error(`Installations Géorisques ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Réponse installations absente.");
    const decoder = new TextDecoder(); let bytes = 0, body = "";
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { body += decoder.decode(); break; }
        bytes += chunk.value.byteLength;
        if (bytes > 4_000_000) throw new Error("Réponse installations trop volumineuse.");
        body += decoder.decode(chunk.value, { stream: true });
      }
    } finally { await reader.cancel(); }
    const data = object(JSON.parse(body));
    if (!Array.isArray(data.data) || data.page !== page || !Number.isInteger(data.results) || Number(data.results) < 0 || !Number.isInteger(data.total_pages) || Number(data.total_pages) < 0 || Number(data.total_pages) > 10) throw new Error("Pagination installations inattendue.");
    if ((expected !== undefined && expected !== data.results) || (pages !== undefined && pages !== data.total_pages)) throw new Error("Catalogue installations modifié pendant la lecture.");
    expected = Number(data.results); pages = Number(data.total_pages);
    values.push(...data.data);
    if (!data.next) {
      if (values.length !== expected || page !== Math.max(1, pages)) throw new Error("Catalogue installations incomplet.");
      return parseInstallations(values);
    }
    if (page >= pages || !data.data.length || values.length >= expected) throw new Error("Pagination installations incohérente.");
  }
  throw new Error("Catalogue installations incomplet.");
}
