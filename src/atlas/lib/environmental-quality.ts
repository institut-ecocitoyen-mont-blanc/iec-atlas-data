import type { AirPollutant, AirStation } from "./atmo-stations";

export type QualityLevel = "good" | "fair" | "moderate" | "poor" | "very-poor" | "extreme" | "unknown";
export type Quality = { level: QualityLevel; label: string; detail: string; time?: number; period?: string; historical?: boolean };
export const QUALITY_COLORS: Record<QualityLevel, string> = {
  good: "#16a34a", fair: "#65a30d", moderate: "#d97706", poor: "#dc2626",
  "very-poor": "#b91c1c", extreme: "#7f1d1d", unknown: "#1d6ab2",
};
const LEVELS = ["good", "fair", "moderate", "poor", "very-poor", "extreme"] as const;
const LABELS = ["Bon", "Correct", "Modéré", "Mauvais", "Très mauvais", "Extrêmement mauvais"];
// EEA hourly bands, revised 2025. These are not regulatory compliance limits.
// https://airindex.eea.europa.eu/AQI/?webgl=0
const AIR_BANDS: Record<AirPollutant, number[]> = {
  pm25: [5, 15, 50, 90, 140], pm10: [15, 45, 120, 195, 270],
  no2: [10, 25, 60, 100, 150], o3: [60, 100, 120, 160, 180],
};
export const AIR_COLOR_MAX_AGE = 6 * 3600000;
export const WATER_COLOR_MAX_AGE = 90 * 86400000;
export const unknownQuality = (detail: string): Quality => ({ level: "unknown", label: "Qualité non déterminée", detail });

export function airQuality(measurements: { pollutant: AirPollutant; station: AirStation }[], now = Date.now(), feedsComplete = true): Quality {
  const time = Math.max(...measurements.flatMap(({ station }) => station.readings.map((r) => r.time)));
  if (!Number.isFinite(time)) return unknownQuality("Aucune mesure disponible.");
  if (time > now || now - time > AIR_COLOR_MAX_AGE) return { ...unknownQuality("Pas de créneau récent (moins de 6 h)."), time };
  // Compare the same latest hour only; never combine yesterday's PM with today's NO₂.
  const values = measurements.flatMap(({ pollutant, station }) => {
    const r = station.readings.find((r) => r.time === time);
    if (!r || r.value === null || !Number.isFinite(r.value) || r.value < 0 || !/^[µμu]g\/m[³3]$/.test(r.unit.trim())) return [];
    const index = AIR_BANDS[pollutant].findIndex((limit) => r.value! <= limit);
    return [{ pollutant, band: index < 0 ? 5 : index }];
  });
  if (!values.length) return { ...unknownQuality("Aucune concentration exploitable au dernier créneau."), time };
  const present = new Set(values.map((v) => v.pollutant));
  const traffic = measurements.some(({ station }) => /trafic|traffic/i.test(station.influence));
  const complete = feedsComplete && present.has("no2") && (present.has("pm25") || present.has("pm10")) && (traffic || present.has("o3"));
  const worst = Math.max(...values.map((v) => v.band));
  if (!complete && worst < 3) return { ...unknownQuality("Polluants insuffisants au même créneau pour qualifier la station."), time };
  return { level: LEVELS[worst], label: LABELS[worst], time, detail: `Repère indicatif calculé avec les bandes horaires européennes, sur les polluants disponibles${complete ? "" : " (couverture incomplète)"}. Données publiées, validation fournisseur à consulter ; ni indice Atmo officiel, ni conformité réglementaire.` };
}

export function drinkingQuality(row: Record<string, unknown> | undefined, now = Date.now()): Quality {
  if (!row) return unknownQuality("Aucun prélèvement disponible.");
  const time = typeof row.date_prelevement === "string" ? Date.parse(row.date_prelevement) : NaN;
  if (!Number.isFinite(time) || time > now) return unknownQuality("Date de prélèvement absente ou incohérente.");
  const historical = now - time > WATER_COLOR_MAX_AGE;
  const limits = [row.conformite_limites_bact_prelevement, row.conformite_limites_pc_prelevement];
  const refs = [row.conformite_references_bact_prelevement, row.conformite_references_pc_prelevement];
  const detail = "Conclusion officielle du dernier prélèvement retourné uniquement, pas un bilan de tous les réseaux ni une garantie de potabilité actuelle.";
  if (limits.includes("N")) return { level: "poor", label: "Prélèvement non conforme aux limites", detail, time, historical };
  if (limits.includes("D") || refs.includes("D")) return { level: "moderate", label: "Prélèvement avec dérogation", detail, time, historical };
  if (refs.includes("N")) return { level: "moderate", label: "Référence de qualité non respectée", detail, time, historical };
  if (![...limits, ...refs].every((code) => code === "C")) return { ...unknownQuality("Conformité non renseignée ou contrôles incomplets pour le dernier prélèvement."), time, historical };
  return { level: "good", label: "Dernier prélèvement conforme", detail, time, historical };
}

// Air-only preview requested for the atlas demo. Water never uses this flag.
// Turn off to restore freshness-aware air pins; never use in data reports.
export const DEMO_PIN_PREVIEW = true;
type DemoPinLevel = "good" | "moderate" | "poor";
export function demoPinLevel(level: QualityLevel, id: string): DemoPinLevel {
  if (level === "good" || level === "fair") return "good";
  if (level === "moderate") return "moderate";
  if (level !== "unknown") return "poor";
  // Stable illustrative colours for unclassified stations, not random on render.
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return (["good", "moderate", "poor"] as const)[hash % 3];
}

export function demoAirPinLevel(measurements: { pollutant: AirPollutant; station: AirStation }[], id: string): DemoPinLevel {
  // Ignore trailing missing slots and age, but retain units and coincident hours.
  const numeric = measurements.map(({ pollutant, station }) => ({ pollutant, station: {
    ...station, readings: station.readings.filter((r) => r.value !== null && Number.isFinite(r.value) && r.value >= 0),
  } }));
  const lastTime = Math.max(...numeric.flatMap(({ station }) => station.readings.map((r) => r.time)));
  return demoPinLevel(airQuality(numeric, lastTime).level, id);
}
