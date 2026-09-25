export const ATMO_MODEL_YEAR = 2025;
export const ATMO_MODEL_SOURCE = "https://www.atmo-auvergnerhonealpes.fr/carte/exposition-la-pollution-atmospherique-en-2025";
export const ATMO_MODEL_WMS = "https://sig.atmo-auvergnerhonealpes.fr/geoserver/mod_aura_region_2025/wms";
export const ATMO_MODELS = [
  { id: "pm25", label: "PM₂.₅", layer: "mod_aura_2025_pm25_moyan", period: "2025", metric: "Moyenne annuelle · µg/m³" },
  { id: "pm10", label: "PM₁₀", layer: "mod_aura_2025_pm10_moyan", period: "2025", metric: "Moyenne annuelle · µg/m³" },
  { id: "no2", label: "NO₂", layer: "mod_aura_2025_no2_moyan", period: "2025", metric: "Moyenne annuelle · µg/m³" },
  { id: "o3", label: "O₃", layer: "mod_aura_2025_o3_nbjdep120_2023_2025", period: "2023–2025", metric: "Nombre moyen annuel de jours > 120 µg/m³ (maximum journalier de la moyenne sur 8 h)" },
] as const;
export type AtmoModelId = typeof ATMO_MODELS[number]["id"];
export function atmoModelLayer(id: AtmoModelId) {
  return `mod_aura_region_2025:${ATMO_MODELS.find((model) => model.id === id)!.layer}`;
}
export function atmoModelTileUrl(id: AtmoModelId, bbox: number[], size: number) {
  return `${ATMO_MODEL_WMS}?${new URLSearchParams({ SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: atmoModelLayer(id), STYLES: "", FORMAT: "image/png", TRANSPARENT: "true", SRS: "EPSG:3857", BBOX: bbox.join(","), WIDTH: String(size), HEIGHT: String(size) })}`;
}
export function atmoModelLegendUrl(id: AtmoModelId) {
  return `${ATMO_MODEL_WMS}?${new URLSearchParams({ SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetLegendGraphic", LAYER: atmoModelLayer(id), FORMAT: "application/json" })}`;
}

// Exact opaque stops from the 2025 WMS GetLegendGraphic JSON, checked 2026-09-25.
// These are continuous raster ramps, not equally spaced health categories.
// Exclude transparent nodata (-9999). Preserve PM10's distinct dark endpoint.
const RAMP_COLORS = ["#00CCAA", "#32B8A3", "#5CCB60", "#99E600", "#C3F000", "#FFFF00", "#FFD100", "#FFAA00", "#FF5E00", "#FF0000", "#800000"];
const scale = (values: number[], ticks: number[], unit: string, colors = RAMP_COLORS) => ({
  stops: values.map((value, i) => ({ value, color: colors[i] })), ticks, unit,
});
export const ATMO_MODEL_SCALES = {
  pm25: scale([0, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 50], [0, 10, 25, 50], "µg/m³"),
  pm10: scale([0, 8, 12, 16, 20, 24, 28, 32, 36, 40, 50], [0, 20, 40, 50], "µg/m³", [...RAMP_COLORS.slice(0, -1), "#222222"]),
  no2: scale([0, 8, 12, 16, 20, 24, 28, 32, 36, 40, 80], [0, 20, 40, 80], "µg/m³"),
  o3: scale([0, 7, 10, 12, 15, 17, 20, 22, 25, 50], [0, 10, 25, 50], "jours/an", RAMP_COLORS.filter((_, index) => index !== 1)),
} satisfies Record<AtmoModelId, ReturnType<typeof scale>>;
// Reference markers reproduced from Atmo's 2025 PNG legends, not inferred
// from colour stops. WHO guidance and regulatory limits remain distinct.
export const ATMO_MODEL_REFERENCES: Record<AtmoModelId, { limit: number; label: string; who?: number }> = {
  pm25: { limit: 25, label: "Valeur limite", who: 5 },
  pm10: { limit: 40, label: "Valeur limite", who: 15 },
  no2: { limit: 40, label: "Valeur limite", who: 10 },
  o3: { limit: 25, label: "Valeur cible pour la protection de la santé humaine" },
};
export function atmoLegendGradient(id: AtmoModelId) {
  const { stops } = ATMO_MODEL_SCALES[id];
  const max = stops.at(-1)!.value;
  return `linear-gradient(to right, ${stops.map(({ value, color }) => `${color} ${value / max * 100}%`).join(", ")})`;
}
