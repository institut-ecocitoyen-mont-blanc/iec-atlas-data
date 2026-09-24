import type { RiverAssessment, RiverAssessments } from "./river-assessments";
export const RIVER_EXPORT_URL = "https://www.rhone-mediterranee.eaufrance.fr/streams-quality-data/export-data-search";

// Semicolon CSV, including quoted delimiters/newlines and escaped quotes.
export function parseRiverCsv(csv: string, currentYear = new Date().getUTCFullYear()): Record<string, RiverAssessment> {
  const records: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (c === ";" || c === "\n")) {
      row.push(cell.trim()); cell = "";
      if (c === "\n") { if (row.some(Boolean)) records.push(row); row = []; }
    } else cell += c;
  }
  if (quoted) throw new Error("CSV incomplet.");
  if (cell || row.length) { row.push(cell.trim()); records.push(row); }
  const header = records.shift()?.map((s) => s.replace(/^\uFEFF/, ""));
  const required = ["numero_station", "annee", "nature_MDO", "ECO", "POTENTIEL_ECOLO", "CHIM", "DECLASS_CHIM"];
  if (!header || !required.every((key) => header.includes(key))) throw new Error("Le format AERMC a changé.");
  const stations: Record<string, RiverAssessment> = {};
  for (const values of records) {
    if (values.length !== header.length) throw new Error("Colonnes AERMC incomplètes.");
    const get = (key: string): string => values[header.indexOf(key)];
    const stationId = get("numero_station"), year = Number(get("annee"));
    if (!/^\d{8}$/.test(stationId)) throw new Error("Identifiant de station invalide.");
    // Empty year = a station with no assessment. Never turn it into year zero.
    if (!get("annee")) continue;
    if (!Number.isInteger(year) || year < 1900 || year > currentYear) throw new Error("Année d’évaluation invalide.");
    if (stations[stationId]?.year === year) throw new Error("Évaluations contradictoires ou dupliquées.");
    if (stations[stationId] && stations[stationId].year > year) continue;
    stations[stationId] = { stationId, year, nature: get("nature_MDO"), ecological: get("ECO"), potential: get("POTENTIEL_ECOLO"), chemical: get("CHIM"), chemicalDowngraders: get("DECLASS_CHIM") };
  }
  if (!Object.keys(stations).length) throw new Error("Export AERMC vide.");
  return stations;
}

export async function loadRiverAssessments(fetcher: typeof fetch = fetch): Promise<RiverAssessments> {
  try {
    // Verified form value 531 = Haute-Savoie (not the department's INSEE code).
    const options = { method: "POST", body: new URLSearchParams({ field_sq_departement: "531", search_api_fulltext: "", field_sq_region: "", field_sq_commune: "", field_sq_watershed: "", field_sq_subwatershed: "", field_sq_stream: "" }), signal: AbortSignal.timeout(25000), next: { revalidate: 3600 } };
    const response = await fetcher(RIVER_EXPORT_URL, options);
    if (!response.ok) throw new Error("Export indisponible.");
    const csv = await response.text();
    if (csv.length > 8_000_000) throw new Error("Export trop volumineux.");
    return { stations: parseRiverCsv(csv), fetchedAt: new Date().toISOString() };
  } catch {
    return { stations: {}, fetchedAt: null, error: "Évaluations AERMC indisponibles lors de la reconstruction du site. Les analyses Hub’Eau restent consultables ; les stations non évaluées sont affichées en contour." };
  }
}
