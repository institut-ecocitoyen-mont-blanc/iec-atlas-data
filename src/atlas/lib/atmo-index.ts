import { ccpmbCommuneAt } from "./ccpmb-territory.ts";
import type { AirStation } from "./atmo-stations.ts";

export const ATMO_INDEX_SOURCE = "https://www.atmo-auvergnerhonealpes.fr/air-commune";
export const ATMO_INDEX_CLASSES = [
  { code: 1, label: "Bon", color: "#50f0e6" },
  { code: 2, label: "Moyen", color: "#50ccaa" },
  { code: 3, label: "Dégradé", color: "#f0e641" },
  { code: 4, label: "Mauvais", color: "#ff5050" },
  { code: 5, label: "Très mauvais", color: "#960032" },
  { code: 6, label: "Extrêmement mauvais", color: "#872181" },
] as const;
export const ATMO_INDEX_NEUTRAL = "#94a3b8";
export interface AtmoIndexRecord { communeCode: string; communeName: string; date: string; publishedAt: string; code: number | null; label: string; color: string; source: string }
export interface AtmoIndexData { records: AtmoIndexRecord[]; fetchedAt: string }
export const parisDay = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const indexDateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });

export function stationAtmoIndex(station: Pick<AirStation, "lat" | "lng">, data?: AtmoIndexData, now = Date.now()) {
  const commune = ccpmbCommuneAt(station.lat, station.lng), date = parisDay(now);
  // Never substitute yesterday, tomorrow, a neighbour, or station concentrations.
  const record = commune ? data?.records.filter(r => r.communeCode === commune.code && r.date === date && Date.parse(r.publishedAt) <= now).sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] : undefined;
  const category = ATMO_INDEX_CLASSES.find(c => c.code === record?.code);
  return { commune, date, record, color: category?.color ?? ATMO_INDEX_NEUTRAL, label: category?.label ?? "Indisponible", available: Boolean(category) };
}
