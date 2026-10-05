import { CCPMB_COMMUNES } from "./ccpmb-territory.ts";
import { ATMO_INDEX_CLASSES, ATMO_INDEX_NEUTRAL, parisDay, type AtmoIndexData, type AtmoIndexRecord } from "./atmo-index.ts";

export const ATMO_INDEX_WFS = "https://sig.atmo-auvergnerhonealpes.fr/geoserver/ind_aura/wfs";
export function atmoIndexUrl(now = Date.now()) {
  const today = Date.parse(`${parisDay(now)}T00:00:00Z`);
  const first = new Date(today - 86400000).toISOString().replace(".000Z", "Z"), last = new Date(today + 86400000).toISOString().replace(".000Z", "Z");
  return `${ATMO_INDEX_WFS}?${new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: "ind_aura:vuemat_agol_indices_2021", outputFormat: "application/json", count: "1000", sortBy: "date_ech D,code_zone A,date_dif D", propertyName: "date_ech,date_dif,code_zone,lib_zone,type_zone,code_qual,lib_qual,coul_qual,source", CQL_FILTER: `code_zone IN (${CCPMB_COMMUNES.map(c => `'${c.code}'`).join(",")}) AND date_ech >= '${first}' AND date_ech <= '${last}'` })}`;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,19) !== value.slice(0,19)) throw new Error("Date d’indice Atmo invalide.");
  return value;
}
export function parseAtmoIndex(value: unknown): AtmoIndexData {
  const json = value as { type?: string; features?: { properties?: Record<string, unknown> }[]; numberMatched?: number; numberReturned?: number };
  if (json?.type !== "FeatureCollection" || !Array.isArray(json.features) || !json.features.length || json.features.length > 1000 || json.numberMatched !== json.features.length || json.numberReturned !== json.features.length) throw new Error("Export des indices Atmo incomplet.");
  const byKey = new Map<string, AtmoIndexRecord>();
  for (const feature of json.features) {
    const row = feature.properties;
    const commune = CCPMB_COMMUNES.find(c => c.code === row?.code_zone);
    if (!row || !commune || row.type_zone !== "commune" || typeof row.lib_zone !== "string" || typeof row.source !== "string") throw new Error("Commune d’indice Atmo inattendue.");
    const date = timestamp(row.date_ech), publishedAt = timestamp(row.date_dif);
    if (!date.includes("T00:00:00")) throw new Error("Échéance Atmo non journalière.");
    const category = ATMO_INDEX_CLASSES.find(c => c.code === row.code_qual);
    if (!category && row.code_qual !== null && row.code_qual !== 0) throw new Error("Code d’indice Atmo inconnu.");
    if (category && (row.lib_qual !== category.label || typeof row.coul_qual !== "string" || row.coul_qual.toLowerCase() !== category.color)) throw new Error("Légende Atmo incompatible.");
    const record: AtmoIndexRecord = { communeCode: commune.code, communeName: row.lib_zone, date: date.slice(0,10), publishedAt, code: category?.code ?? null, label: category?.label ?? "Indisponible", color: category?.color ?? ATMO_INDEX_NEUTRAL, source: row.source };
    const key = `${record.communeCode}:${record.date}`, old = byKey.get(key);
    if (old && Date.parse(old.publishedAt) === Date.parse(publishedAt) && old.code !== record.code) throw new Error("Indices Atmo contradictoires.");
    if (!old || Date.parse(publishedAt) > Date.parse(old.publishedAt)) byKey.set(key, record);
  }
  return { records: [...byKey.values()].sort((a,b) => a.date.localeCompare(b.date) || a.communeCode.localeCompare(b.communeCode)), fetchedAt: new Date().toISOString() };
}
export async function loadAtmoIndex(now = Date.now()) {
  const response = await fetch(atmoIndexUrl(now), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Indices Atmo HTTP ${response.status}.`);
  return parseAtmoIndex(await response.json());
}
