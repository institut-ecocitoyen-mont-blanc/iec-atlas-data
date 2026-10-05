import type { AirPollutant, AirReading, AirStation } from "./atmo-stations.ts";
export const GEODAIR_SOURCE = "https://www.geodair.fr/donnees/api";
export const GEODAIR_STATION = "FR33220";
export const GEODAIR_POLLUTANTS = [
  { id: "pm25", name: "PM2.5", label: "PM₂.₅" }, { id: "pm10", name: "PM10", label: "PM₁₀" },
  { id: "no2", name: "NO2", label: "NO₂" }, { id: "o3", name: "O3", label: "O₃" },
  { id: "no", name: "NO", label: "NO" }, { id: "nox", name: "NOX as NO2", label: "NOₓ (équivalent NO₂)" },
  { id: "bap", name: "BaP in PM10", label: "Benzo[a]pyrène dans les PM₁₀" },
] as const;
export type GeodairPollutant = typeof GEODAIR_POLLUTANTS[number]["id"];
export interface GeodairHourly { stations: Partial<Record<GeodairPollutant, AirStation>>; fetchedAt: string; from: number; to: number }
export interface GeodairHistoricalReading extends AirReading { pollutant: GeodairPollutant; coverage: number | null }
export interface GeodairHistory { stationId: string; annual: GeodairHistoricalReading[]; samples: GeodairHistoricalReading[]; fetchedAt: string }
export function withGeodairStation(regional: AirStation[], pollutant: AirPollutant, national?: GeodairHourly): AirStation[] {
  const station = national?.stations[pollutant];
  // Replace the whole history, never splice differently sourced timestamps.
  return station ? [...regional.filter(row => row.id !== GEODAIR_STATION), station] : regional;
}
export function airReadingStatus(reading: AirReading, national = false) {
  if (!national) return reading.validation == null ? "Non renseignée" : `Code fournisseur « ${reading.validation} »`;
  return `${reading.valueType || "Type non renseigné"} · validité ${reading.validity ?? "non renseignée"} · qualité ${reading.qualityCode || "non renseignée"}`;
}
