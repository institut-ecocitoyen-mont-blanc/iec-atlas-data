import { CCPMB_COMMUNES, insideCcpmb } from "./ccpmb-territory.ts";
import { asText, fetchJson, rows, type Row } from "./environmental-layers.ts";

export const GROUNDWATER_SOURCE = "https://hubeau.eaufrance.fr/page/api-qualite-nappes";
const API = "https://hubeau.eaufrance.fr/api/v1/qualite_nappes";
export const GROUNDWATER_RESULT_LIMIT = 200;
export interface GroundwaterStation {
  id: string; bssCode: string; name: string; commune: string; communeCode: string;
  lat: number; lng: number; precision: number; nature: string;
  firstMeasurement: string; lastMeasurement: string; networks: string[];
}
export interface GroundwaterCatalogue { stations: GroundwaterStation[]; fetchedAt: string | null; error?: string }
export interface GroundwaterAnalysis {
  parameter: string; name: string; date: string; value: number | null; unit: string;
  remarkCode: number; remark: string; qualification: string; status: string; fraction: string;
}
export interface GroundwaterResults { analyses: GroundwaterAnalysis[]; total: number; more: boolean }
export function groundwaterCatalogueUrl(page = 1) {
  return `${API}/stations?${new URLSearchParams({ code_commune: CCPMB_COMMUNES.map((commune) => commune.code).join(","), size: "1000", page: String(page) })}`;
}
export function groundwaterAnalysisUrl(id: string) {
  if (!/^BSS[A-Z0-9]+$/.test(id)) throw new Error("Identifiant de point d’eau invalide.");
  return `${API}/analyses?${new URLSearchParams({ bss_id: id, size: String(GROUNDWATER_RESULT_LIMIT), sort: "desc", fields: "bss_id,code_insee_actuel,date_debut_prelevement,code_param,nom_param,resultat,symbole_unite,nom_unite,code_remarque_analyse,nom_remarque_analyse,nom_qualification,nom_statut_analyse,nom_fraction" })}`;
}
export function groundwaterStationUrl(id: string) { return `${API}/stations?bss_id=${encodeURIComponent(id)}`; }
export function coordinatePrecision(code: number) {
  if (code === 18) return "Chef-lieu de la commune (précision déclarée par le fournisseur)";
  if (code === 17) return "Centroïde de la commune (précision déclarée par le fournisseur)";
  if (code === 0) return "Précision non renseignée";
  return `Précision publiée : code Sandre ${code}`;
}
export function parseGroundwaterStations(values: Row[]): GroundwaterStation[] {
  const communes = new Set(CCPMB_COMMUNES.map((commune) => commune.code));
  const ids = new Set<string>();
  return values.flatMap((row) => {
    if (!communes.has(asText(row.code_insee))) return [];
    const lat = row.latitude, lng = row.longitude;
    if (typeof lat !== "number" || typeof lng !== "number" || !insideCcpmb(lat, lng)) return [];
    const id = asText(row.bss_id);
    if (!/^BSS[A-Z0-9]+$/.test(id) || ids.has(id)) throw new Error("Identifiant de point d’eau absent ou dupliqué.");
    ids.add(id);
    return [{ id, bssCode: asText(row.code_bss), name: asText(row.libelle_pe) || `${asText(row.nom_nature_pe) || "Point d’eau"} · ${id}`, commune: asText(row.nom_commune), communeCode: asText(row.code_insee), lat, lng,
      precision: typeof row.precision_coordonnees === "number" ? row.precision_coordonnees : 0, nature: asText(row.nom_nature_pe),
      firstMeasurement: asText(row.date_debut_mesure), lastMeasurement: asText(row.date_fin_mesure), networks: Array.isArray(row.noms_reseau) ? row.noms_reseau.map(asText).filter(Boolean) : [],
    }];
  });
}
export function parseGroundwaterAnalyses(value: unknown, station: GroundwaterStation): GroundwaterResults {
  const data = rows(value);
  const envelope = value as Row;
  if (!Array.isArray(envelope.data) || !Number.isInteger(envelope.count) || Number(envelope.count) < data.length || data.length > GROUNDWATER_RESULT_LIMIT || (data.length === 0 && (Number(envelope.count) > 0 || envelope.next))) throw new Error("Réponse d’analyses incomplète.");
  const analyses = data.map((row): GroundwaterAnalysis => {
    if (row.bss_id !== station.id || asText(row.code_insee_actuel) !== station.communeCode) throw new Error("Les analyses ne correspondent pas au point sélectionné.");
    const date = asText(row.date_debut_prelevement), parameter = asText(row.code_param);
    if (!date || !Number.isFinite(Date.parse(date)) || !parameter) throw new Error("Date ou paramètre d’analyse manquant.");
    if (row.resultat !== null && (typeof row.resultat !== "number" || !Number.isFinite(row.resultat))) throw new Error("Valeur d’analyse inattendue.");
    return { parameter, name: asText(row.nom_param) || `Paramètre ${parameter}`, date, value: row.resultat as number | null, unit: asText(row.symbole_unite) || asText(row.nom_unite),
      remarkCode: typeof row.code_remarque_analyse === "number" ? row.code_remarque_analyse : -1, remark: asText(row.nom_remarque_analyse), qualification: asText(row.nom_qualification), status: asText(row.nom_statut_analyse), fraction: asText(row.nom_fraction),
    };
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return { analyses, total: Number(envelope.count), more: !!envelope.next || Number(envelope.count) > analyses.length };
}
export async function loadGroundwaterAnalyses(station: GroundwaterStation, signal: AbortSignal) {
  return parseGroundwaterAnalyses(await fetchJson(groundwaterAnalysisUrl(station.id), signal, 2), station);
}
export function groundwaterResultLabel(analysis: GroundwaterAnalysis) {
  const { value, remarkCode } = analysis;
  if (remarkCode === 0) return "Analyse non faite";
  if (remarkCode === 4) return value === 1 ? "Présence" : value === 2 ? "Absence" : value === 0 ? "Non quantifié / non détecté" : "Présence/absence non renseignée";
  if (value === null) return "Non renseigné";
  const formatted = new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 10 }).format(value);
  if ([2, 7, 9, 10].includes(remarkCode)) return `< ${formatted}`;
  if ([3, 8].includes(remarkCode)) return `> ${formatted}`;
  return remarkCode === 1 ? formatted : `${formatted} (valeur publiée)`;
}
export function groundwaterResultUnit(analysis: GroundwaterAnalysis) { return [0, 4].includes(analysis.remarkCode) ? "" : analysis.unit; }
