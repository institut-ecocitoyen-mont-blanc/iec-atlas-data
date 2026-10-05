import { parse } from "csv-parse/sync";
import { insideCcpmb } from "./ccpmb-territory.ts";
import { GEODAIR_POLLUTANTS, GEODAIR_STATION, type GeodairHourly, type GeodairHistory, type GeodairHistoricalReading } from "./geodair.ts";
import type { AirReading, AirStation } from "./atmo-stations.ts";

const HOUR = 3600000;
type Row = Record<string, string>;
const required = ["Date de début", "Date de fin", "code site", "nom site", "Polluant", "valeur", "valeur brute", "unité de mesure", "type de valeur", "validité", "code qualité", "Latitude", "Longitude"];
export function geodairTime(value: string) {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Date Geod’air invalide.");
  const canonical = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  const time = Date.parse(canonical);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== canonical) throw new Error("Date Geod’air invalide.");
  return time;
}
function numeric(value: string | undefined) {
  if (value == null || value.trim() === "") return null;
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value))) throw new Error("Valeur Geod’air invalide.");
  return Number(value);
}
function rows(csv: string): Row[] {
  if (Buffer.byteLength(csv, "utf8") > 2_000_000) throw new Error("Export Geod’air trop volumineux.");
  const result = parse(csv, { bom: true, delimiter: ";", skip_empty_lines: true, columns: (headers: string[]) => {
    if (new Set(headers).size !== headers.length || required.some(field => !headers.includes(field))) throw new Error("Colonnes Geod’air absentes.");
    return headers;
  } }) as Row[];
  if (!result.length) throw new Error("Export Geod’air vide.");
  return result;
}
function reading(row: Row): AirReading {
  const time = geodairTime(row["Date de début"]), end = geodairTime(row["Date de fin"]);
  const validity = numeric(row["validité"]), reportedValue = numeric(row.valeur), rawValue = numeric(row["valeur brute"]);
  if (end <= time || validity === null || !Number.isInteger(validity)) throw new Error("Intervalle ou validité Geod’air invalide.");
  const originalUnit = row["unité de mesure"];
  const unit = /^µg(?:-|\/)m3$/.test(originalUnit) ? "µg/m³" : /^ng(?:-|\/)m3$/.test(originalUnit) ? "ng/m³" : null;
  if (!unit) throw new Error("Unité Geod’air inconnue.");
  return { time, end, value: validity >= 1 ? reportedValue : null, reportedValue, rawValue, unit, validation: null,
    valueType: row["type de valeur"], validity, qualityCode: row["code qualité"], calculatedAt: row["Date de calcul"] ? geodairTime(row["Date de calcul"]) : null };
}
function location(row: Row) {
  const lat = numeric(row.Latitude), lng = numeric(row.Longitude);
  if (row["code site"] !== GEODAIR_STATION || lat === null || lng === null || !insideCcpmb(lat, lng)) throw new Error("Station Geod’air hors périmètre ou inattendue.");
  return { lat, lng };
}
export function parseGeodairHourly(csv: string, from: number, to: number): GeodairHourly {
  const stations: GeodairHourly["stations"] = {}, seen = new Set<string>();
  for (const row of rows(csv)) {
    const coordinates = location(row);
    const pollutant = GEODAIR_POLLUTANTS.find(p => p.name === row.Polluant);
    if (!pollutant || pollutant.id === "bap") throw new Error("Polluant horaire Geod’air inattendu.");
    const value = reading(row);
    if (value.unit !== "µg/m³" || !["moyenne horaire brute", "moyenne horaire validée"].includes(value.valueType!) || value.end! - value.time !== HOUR) throw new Error("Mesure horaire Geod’air inattendue.");
    // Provider bounds can be inclusive. Keep only complete intervals in the window.
    if (value.time < from || value.end! > to) continue;
    const key = `${pollutant.id}:${value.time}`;
    if (seen.has(key)) throw new Error("Mesure Geod’air dupliquée.");
    seen.add(key);
    const station: AirStation = stations[pollutant.id] ?? { id: GEODAIR_STATION, name: row["nom site"], ...coordinates, influence: row["type d'influence"], typology: row["type d'implantation"], period: "hourly", source: "geodair", readings: [] };
    if (station.lat !== coordinates.lat || station.lng !== coordinates.lng) throw new Error("Position Geod’air modifiée dans la fenêtre.");
    station.readings.push(value); stations[pollutant.id] = station;
  }
  // A missing pollutant is not a successful replacement of a complete snapshot.
  for (const { id } of GEODAIR_POLLUTANTS.filter(p => p.id !== "bap")) {
    const station = stations[id];
    if (!station?.readings.length) throw new Error("Export horaire Geod’air incomplet.");
    station.readings.sort((a,b) => a.time - b.time);
  }
  return { stations, from, to, fetchedAt: new Date().toISOString() };
}
export function parseGeodairHistory(csv: string, kind: "annual" | "samples", from: number, to: number): GeodairHistoricalReading[] {
  const result: GeodairHistoricalReading[] = [], seen = new Set<string>();
  for (const row of rows(csv)) {
    location(row);
    const pollutant = GEODAIR_POLLUTANTS.find(p => p.name === row.Polluant);
    if (!pollutant) continue; // Old, unsupported species (e.g. invalid SO2 in 2013).
    const value = reading(row);
    if (value.time < from || value.end! > to) continue;
    if (value.valueType !== (kind === "annual" ? "Moy. annuelle" : "Analyses différées") || (kind === "samples" && pollutant.id !== "bap") || value.unit !== (pollutant.id === "bap" ? "ng/m³" : "µg/m³")) throw new Error("Statistique Geod’air inattendue.");
    const key = `${pollutant.id}:${value.time}`;
    if (seen.has(key)) throw new Error("Statistique Geod’air dupliquée.");
    seen.add(key);
    result.push({ ...value, pollutant: pollutant.id, coverage: numeric(row["couverture de données"]) });
  }
  if (!result.length) throw new Error("Historique Geod’air absent.");
  return result.sort((a,b) => a.time - b.time || a.pollutant.localeCompare(b.pollutant));
}
const dateParameter = (time: number) => { const s = new Date(time).toISOString(); return `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)} ${s.slice(11,16)}`; };
async function responseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Réponse Geod’air absente.");
  const decoder = new TextDecoder(); let bytes = 0, body = "";
  try { for (;;) { const { done, value } = await reader.read(); if (done) return body + decoder.decode(); bytes += value.length; if (bytes > 2_000_000) throw new Error("Réponse Geod’air trop volumineuse."); body += decoder.decode(value, { stream: true }); } }
  finally { await reader.cancel(); }
}
export async function geodairExport(key: string, params: Record<string, string>, fetcher: typeof fetch = fetch, pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!key?.trim()) throw new Error("Clé Geod’air absente.");
  const signal = AbortSignal.timeout(60000), init = { headers: { apikey: key }, signal, redirect: "error" as const };
  const job = await fetcher(`https://www.geodair.fr/api-ext/statistique/export?${new URLSearchParams({ station: GEODAIR_STATION, ...params })}`, init);
  if (job.status !== 200) throw new Error(`Génération Geod’air HTTP ${job.status}.`);
  const id = (await responseText(job)).trim();
  if (!/^api_gp_[A-Za-z0-9_.-]{1,500}$/.test(id)) throw new Error("Identifiant export Geod’air inattendu.");
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetcher(`https://www.geodair.fr/api-ext/download?${new URLSearchParams({ id })}`, init);
    if (response.status === 200) return responseText(response);
    await response.body?.cancel();
    if (response.status !== 412) throw new Error(`Téléchargement Geod’air HTTP ${response.status}.`);
    await pause(1000 * (attempt + 1)); signal.throwIfAborted();
  }
  throw new Error("Export Geod’air non terminé.");
}
export async function loadGeodairHourly(key: string, now = Date.now()) {
  const to = Math.floor(now / HOUR) * HOUR, from = to - 7 * 24 * HOUR;
  return parseGeodairHourly(await geodairExport(key, { date_debut: dateParameter(from), date_fin: dateParameter(to), type_donnee: "a1", famille_polluant: "2000", date_calcul: "true" }), from, to);
}
export async function loadGeodairHistory(key: string, now = Date.now()): Promise<GeodairHistory> {
  const year = new Date(now).getUTCFullYear(), to = Date.UTC(year,0,1), from = Date.UTC(2013,0,1), sampleFrom = Date.UTC(year-1,0,1), sampleTo = Math.floor(now / HOUR) * HOUR;
  const annual = parseGeodairHistory(await geodairExport(key, { date_debut: dateParameter(from), date_fin: dateParameter(to - 60000), type_donnee: "a7", famille_polluant: "2000" }), "annual", from, to);
  const samples = parseGeodairHistory(await geodairExport(key, { date_debut: dateParameter(sampleFrom), date_fin: dateParameter(sampleTo), type_donnee: "01", polluant: "P6" }), "samples", sampleFrom, sampleTo);
  return { stationId: GEODAIR_STATION, annual, samples, fetchedAt: new Date().toISOString() };
}
