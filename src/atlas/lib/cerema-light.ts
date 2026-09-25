import { CCPMB_COMMUNES } from "./ccpmb-territory.ts";

export const CEREMA_LIGHT_SOURCE = "https://www.data.gouv.fr/datasets/cartographie-nationale-des-pratiques-declairage-nocturne";
export const CEREMA_LIGHT_SERVICE = "https://cartagene.cerema.fr/server/rest/services/Hosted/COUCHE_FRANCE_ENTIERE_MAJ_2026/FeatureServer/1";
export const CEREMA_LIGHT_LICENSE = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/";
export interface LightCommune {
  code: string; name: string; monthly: Record<string, number | null>;
  extinction: string | null; renovation: string | null;
}
export interface LightData { communes: LightCommune[]; months: string[]; fetchedAt: string }
export function defaultLightMonth(months: readonly string[], now = new Date()): string {
  // Compare seasons in the territory's timezone, regardless of the visitor's locale.
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(now);
  const month = parts.find((part) => part.type === "month")!.value;
  const current = `${parts.find((part) => part.type === "year")!.value}-${month}`;
  const available = months.filter((date) => /^\d{4}-(0[1-9]|1[0-2])$/.test(date) && date <= current).sort();
  return available.filter((date) => date.endsWith(`-${month}`)).at(-1) ?? available.at(-1) ?? "";
}
export function ceremaLightUrl() {
  return `${CEREMA_LIGHT_SERVICE}/query?${new URLSearchParams({ where: `code_insee IN (${CCPMB_COMMUNES.map(({ code }) => `'${code}'`).join(",")})`, outFields: "*", returnGeometry: "false", f: "json" })}`;
}
export function parseCeremaLight(value: unknown, fetchedAt: string): LightData {
  const data = value as { features?: { attributes?: Record<string, unknown> }[]; error?: unknown; exceededTransferLimit?: boolean } | null;
  if (!data || data.error || !Array.isArray(data.features) || data.exceededTransferLimit) throw new Error("Réponse Cerema incomplète ou incompatible.");
  const expected = new Map(CCPMB_COMMUNES.map(({ code, nom }) => [code, nom]));
  const seen = new Set<string>(), months = new Set<string>();
  const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
  const communes = data.features.flatMap(({ attributes: row }) => {
    const code = String(row?.code_insee ?? "");
    if (!row || !expected.has(code)) return [];
    if (seen.has(code)) throw new Error("Commune dupliquée dans les données Cerema.");
    seen.add(code);
    const monthly: LightCommune["monthly"] = {};
    for (const [key, value] of Object.entries(row)) {
      const match = /^f(20\d{2})_(0[1-9]|1[0-2])$/.exec(key);
      if (!match) continue;
      const month = `${match[1]}-${match[2]}`;
      // Missing values must never look like zero radiance.
      const number = typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
      monthly[month] = number;
      if (number !== null) months.add(month);
    }
    return [{ code, name: expected.get(code)!, monthly, extinction: text(row.d_extinct), renovation: text(row.d_renov) }];
  });
  if (seen.size !== expected.size || !months.size) throw new Error("La couverture des dix communes est incomplète.");
  return { communes, months: [...months].sort(), fetchedAt };
}
let cached: LightData | undefined;
export async function loadCeremaLight(signal: AbortSignal, refresh = false): Promise<LightData> {
  if (!refresh && cached && Date.now() - Date.parse(cached.fetchedAt) < 3600000) return cached;
  const response = await fetch(ceremaLightUrl(), { signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
  if (!response.ok) throw new Error(`Cerema est indisponible (${response.status}).`);
  const data = parseCeremaLight(await response.json(), new Date().toISOString());
  signal.throwIfAborted();
  cached = data;
  return data;
}
// Fixed descriptive classes, not health thresholds. Same scale for every month.
export const LIGHT_BANDS = [
  { max: 0.5, color: "#fef3c7", label: "< 0,5" },
  { max: 1, color: "#fbbf24", label: "0,5 – < 1" },
  { max: 2, color: "#f97316", label: "1 – < 2" },
  { max: 5, color: "#be185d", label: "2 – < 5" },
  { max: Infinity, color: "#581c87", label: "≥ 5" },
] as const;
export function lightColor(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) || value < 0 ? "#94a3b8" : LIGHT_BANDS.find((band) => value < band.max)!.color;
}
export function lightMonth(month: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}
