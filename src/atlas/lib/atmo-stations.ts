import { filterCcpmbPoints, insideCcpmb } from "./ccpmb-territory.ts";
export const ATMO_SERVICE = "https://services3.arcgis.com/o7Q3o5SkiSeZD5LK/arcgis/rest/services/Concentrations%20moyennes%20horaires/FeatureServer";
export const ATMO_DAILY_SERVICE = "https://services3.arcgis.com/o7Q3o5SkiSeZD5LK/arcgis/rest/services/Concentrations%20moyennes%20journali%C3%A8res/FeatureServer";
export const EXCLUDED_AIR_STATION = "FR33232"; // Les Bossons: excluded from this atlas by request.
// Published coordinates verified against Atmo's daily feed, 9 September 2026.
export const ADDITIONAL_AIR_STATIONS = [
  { id: "FR33236", name: "Sallanches Régie", lat: 45.932595640890376, lng: 6.641259550194283, influence: "fond", typology: "Péri Urbain" },
  { id: "ET00909", name: "Passy Chedde", lat: 45.927993999999984, lng: 6.724833999999997, influence: "industrielle", typology: "Site d’étude" },
];
export const AIR_POLLUTANTS = [
  { id: "pm25", label: "PM₂.₅", layer: 2 },
  { id: "pm10", label: "PM₁₀", layer: 4 },
  { id: "no2", label: "NO₂", layer: 1 },
  { id: "o3", label: "O₃", layer: 3 },
] as const;
export type AirPollutant = typeof AIR_POLLUTANTS[number]["id"];
type Row = Record<string, unknown>;
export interface AirReading {
  time: number;
  end: number | null;
  value: number | null;
  unit: string;
  validation: string | null;
}
export interface AirStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  influence: string;
  typology: string;
  readings: AirReading[];
  period?: "hourly" | "daily";
}
export interface AirBounds { west: number; south: number; east: number; north: number }
export function combineAirStations(datasets: Partial<Record<AirPollutant, { stations: AirStation[] }>>) {
  const groups = new Map<string, { station: AirStation; measurements: { pollutant: AirPollutant; station: AirStation }[] }>();
  for (const station of filterCcpmbPoints(ADDITIONAL_AIR_STATIONS)) groups.set(station.id, { station: { ...station, readings: [] }, measurements: [] });
  for (const { id } of AIR_POLLUTANTS) {
    for (const station of datasets[id]?.stations ?? []) {
      if (station.id === EXCLUDED_AIR_STATION || !insideCcpmb(station.lat, station.lng)) continue;
      const group = groups.get(station.id) ?? { station, measurements: [] };
      if (!group.measurements.length) group.station = station;
      group.measurements.push({ pollutant: id, station });
      groups.set(station.id, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.station.name.localeCompare(b.station.name, "fr"));
}
const text = (v: unknown) => typeof v === "string" ? v : "";
const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const timestamp = (v: unknown) => numeric(v) ?? (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

export function groupAirStations(rows: Row[], bounds: AirBounds, period: "hourly" | "daily" = "hourly"): AirStation[] {
  const stations = new Map<string, AirStation>();
  // Newest row supplies the published location and station metadata.
  for (const row of [...rows].sort((a, b) => (timestamp(b.date_debut) ?? 0) - (timestamp(a.date_debut) ?? 0))) {
    const id = text(row.code_station), lat = numeric(row.y_wgs84), lng = numeric(row.x_wgs84);
    const time = timestamp(row.date_debut);
    if (!id || time === null || lat === null || lng === null || lat < bounds.south || lat > bounds.north || lng < bounds.west || lng > bounds.east) continue;
    const station = stations.get(id) ?? { id, name: text(row.nom_station) || id, lat, lng, influence: text(row.influence), typology: text(row.typologie), readings: [], period };
    if (!station.readings.some((reading) => reading.time === time)) {
      const validation = period === "daily" ? row.validite : row.statut_valid;
      station.readings.push({ time, end: timestamp(row.date_fin), value: numeric(row.valeur), unit: text(row.unite), validation: validation == null ? null : String(validation) });
    }
    stations.set(id, station);
  }
  return Array.from(stations.values()).map((station) => ({ ...station, readings: station.readings.sort((a, b) => a.time - b.time) })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export function airQueryUrl(pollutant: AirPollutant, bounds: AirBounds, offset = 0) {
  const { layer } = AIR_POLLUTANTS.find((p) => p.id === pollutant)!;
  const params = new URLSearchParams({ f: "json", where: `x_wgs84>=${bounds.west} AND x_wgs84<=${bounds.east} AND y_wgs84>=${bounds.south} AND y_wgs84<=${bounds.north}`, outFields: "OBJECTID,code_station,nom_station,x_wgs84,y_wgs84,typologie,influence,date_debut,date_fin,valeur,unite,statut_valid", orderByFields: "date_debut DESC,OBJECTID ASC", resultRecordCount: "2000", resultOffset: String(offset), returnGeometry: "false" });
  return `${ATMO_SERVICE}/${layer}/query?${params}`;
}

export function dailyAirQueryUrl(pollutant: "pm10" | "pm25", stationIds: string[], offset = 0) {
  const ids = stationIds.filter((id) => ADDITIONAL_AIR_STATIONS.some((station) => station.id === id));
  if (!ids.length) throw new Error("Aucune station complémentaire demandée.");
  const params = new URLSearchParams({ f: "json", where: `code_station IN (${ids.map((id) => `'${id}'`).join(",")})`, outFields: "OBJECTID,code_station,nom_station,x_wgs84,y_wgs84,typologie,influence,date_debut,date_fin,valeur,unite,validite", orderByFields: "date_debut DESC,OBJECTID ASC", resultRecordCount: "2000", resultOffset: String(offset), returnGeometry: "false" });
  return `${ATMO_DAILY_SERVICE}/${pollutant === "pm10" ? 4 : 3}/query?${params}`;
}

async function loadAdditionalDaily(pollutant: "pm10" | "pm25", bounds: AirBounds, ids: string[], signal: AbortSignal) {
  const all: Row[] = [];
  for (let page = 0; page < 10; page++) {
    const response = await fetch(dailyAirQueryUrl(pollutant, ids, all.length), { signal });
    if (!response.ok) throw new Error("Mesures journalières indisponibles.");
    const data = await response.json();
    if (data.error || !Array.isArray(data.features)) throw new Error("Mesures journalières indisponibles.");
    const records = data.features.map((f: { attributes?: Row }) => f.attributes);
    if (records.some((r: unknown) => !r || typeof r !== "object")) throw new Error("Mesures journalières au format inattendu.");
    all.push(...records);
    if (!data.exceededTransferLimit) return filterCcpmbPoints(groupAirStations(all, bounds, "daily")).filter((s) => ids.includes(s.id));
    if (!records.length) break;
  }
  throw new Error("Mesures journalières incomplètes.");
}

export async function loadAirStations(pollutant: AirPollutant, bounds: AirBounds, signal: AbortSignal): Promise<AirStation[]> {
  const all: Row[] = [];
  // Bound the entire pagination sequence, not just individual requests.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
  for (let page = 0; page < 10; page++) {
    const response = await fetch(airQueryUrl(pollutant, bounds, all.length), { signal: deadline });
    if (!response.ok) throw new Error(`Atmo : erreur HTTP ${response.status}.`);
    const data = await response.json();
    if (data.error || !Array.isArray(data.features)) throw new Error("La réponse Atmo est indisponible ou son format a changé.");
    const rows = data.features.map((feature: { attributes?: Row }) => feature.attributes);
    if (rows.some((row: unknown) => !row || typeof row !== "object")) throw new Error("Mesures Atmo au format inattendu.");
    all.push(...rows);
    if (!data.exceededTransferLimit) {
      const hourly = filterCcpmbPoints(groupAirStations(all, bounds)).filter((station) => station.id !== EXCLUDED_AIR_STATION);
      if (pollutant !== "pm10" && pollutant !== "pm25") return hourly;
      const missing = ADDITIONAL_AIR_STATIONS.filter((s) => !hourly.some((h) => h.id === s.id)).map((s) => s.id);
      if (!missing.length) return hourly;
      // Keep the two sampling periods distinct, never merge daily and hourly
      // records into the same station/pollutant history.
      try {
        return [...hourly, ...await loadAdditionalDaily(pollutant, bounds, missing, deadline)];
      } catch (error) {
        if (signal.aborted) throw error;
        // A failed complementary feed must not hide the working hourly feed.
        // The station remains selectable with an unavailable-measurements message.
        return hourly;
      }
    }
    if (!rows.length) break;
  }
  throw new Error("Le flux Atmo est trop volumineux : affichage partiel refusé.");
}

export function latestAirValue(station: AirStation) {
  return station.readings.findLast((reading) => reading.value !== null);
}

// Split on absent values and missing hourly slots instead of implying continuity.
export function airChartSegments(readings: AirReading[], period: "hourly" | "daily" = "hourly"): AirReading[][] {
  const segments: AirReading[][] = [];
  let segment: AirReading[] = [];
  for (const reading of readings) {
    if (reading.value === null || (segment.length && reading.time - segment[segment.length - 1].time > (period === "daily" ? 36 * 3600000 : 90 * 60000)) || (segment.length && reading.unit !== segment[segment.length - 1].unit)) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (reading.value !== null) segment.push(reading);
  }
  if (segment.length) segments.push(segment);
  return segments;
}

export const airDate = (time: number) => new Date(time).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const airIsStale = (time: number, now = Date.now()) => now - time > 48 * 3600000;
