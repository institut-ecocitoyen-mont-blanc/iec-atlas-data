import { appendFile } from "node:fs/promises";
import { openStore, isDue, readJson } from "./store.mjs";
import { fetchAllPollutionSites } from "../src/lib/google-sheets.ts";
import { clipAtlasInventory } from "../src/atlas/lib/atlas-inventory.ts";
import { AREA, loadLayer, fetchJson, rows, analysisUrl } from "../src/atlas/lib/environmental-layers.ts";
import { AIR_POLLUTANTS, ATMO_SERVICE, loadAirStations } from "../src/atlas/lib/atmo-stations.ts";
import { loadBathingWater } from "../src/atlas/lib/bathing-water-source.ts";
import { loadRiverAssessments, RIVER_EXPORT_URL } from "../src/atlas/lib/river-assessments-source.ts";
import { loadRoadTraffic, roadTrafficUrl } from "../src/atlas/lib/road-traffic-source.ts";
import { loadIndustrialEmissions, IREP_CATALOGUE_URL } from "../src/atlas/lib/industrial-emissions-source.ts";
import { loadGroundwaterCatalogue } from "../src/atlas/lib/groundwater-source.ts";
import { loadGroundwaterAnalyses, GROUNDWATER_SOURCE } from "../src/atlas/lib/groundwater.ts";
import { loadDrinkingSummaries } from "../src/atlas/lib/drinking-networks.ts";
import { CCPMB_COMMUNES } from "../src/atlas/lib/ccpmb-territory.ts";
import { loadGeorisques } from "../src/atlas/lib/georisques-source.ts";
import { loadPesticidePurchases, PESTICIDE_SOURCE } from "../src/atlas/lib/pesticide-purchases.ts";
import { loadCeremaLight, CEREMA_LIGHT_SOURCE } from "../src/atlas/lib/cerema-light.ts";
import { ATMO_MODELS, ATMO_MODEL_SOURCE } from "../src/atlas/lib/atmo-model.ts";
import { loadAtmoModelExport } from "./atmo-model-export.mjs";

const mode = process.env.IMPORT_MODE || "due";
if (!["due", "all", "hourly", "water", "annual", "georisques", "bathing", "overlays"].includes(mode)) throw new Error("Invalid import mode");
const store = await openStore("public");
const signal = () => AbortSignal.timeout(60000);
const valid = (data) => { if (!data || data.error || data.fetchedAt === null) throw new Error("Invalid or incomplete dataset"); };
const nonempty = (data) => { if (!Array.isArray(data) || !data.length) throw new Error("Unexpected empty catalogue"); };
function due(key, group, hours) { return mode === "all" || mode === group || mode === key || mode === "due" && isDue(store.manifest.datasets[key], hours); }
async function update(key, group, hours, source, loader, validate = valid) {
  if (!due(key, group, hours)) {
    const path = store.manifest.datasets[key]?.path;
    return path ? (await readJson(`public/${path}`, null))?.data : undefined;
  }
  return store.update(key, source, hours, loader, validate);
}
// All requests have a deadline, including the shared inventory importer.
const upstreamFetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) => upstreamFetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(60000), ...(init.signal ? [init.signal] : [])]) });

await update("inventory", "hourly", 1, "https://docs.google.com/spreadsheets/d/1diIR2EXPf2QfkxUw-T0r3CRjinhcJVnnNH5azd0QxZg", async () => clipAtlasInventory(await fetchAllPollutionSites()), (data) => { valid(data); nonempty(data.sites); });
for (const { id } of AIR_POLLUTANTS) {
  await update(`air-${id}`, "hourly", 1, ATMO_SERVICE, () => loadAirStations(id, AREA, signal()), nonempty);
}

const water = "https://hubeau.eaufrance.fr";
const rivers = await update("rivers", "water", 24, water, async () => ({ points: await loadLayer("rivers", signal()), fetchedAt: new Date().toISOString() }), (data) => { valid(data); nonempty(data.points); });
await update("river-assessments", "water", 24, RIVER_EXPORT_URL, async () => {
  const data = await loadRiverAssessments();
  valid(data);
  const points = rivers?.points ?? await loadLayer("rivers", signal());
  const ids = new Set(points.map((p) => p.id));
  return { ...data, stations: Object.fromEntries(Object.entries(data.stations).filter(([id]) => ids.has(id))) };
});
for (const point of rivers?.points ?? []) {
  await update(`river-${point.id.toLowerCase()}`, "water", 24, analysisUrl("rivers", point.id), async () => {
    const data = rows(await fetchJson(analysisUrl("rivers", point.id), signal(), 3));
    if (data.some((r) => String(r.code_station) !== point.id)) throw new Error("Station mismatch");
    return data;
  }, (data) => { if (!Array.isArray(data)) throw new Error("Invalid results"); });
}

const drinking = await update("drinking", "water", 24, water, async () => {
  const points = await loadLayer("drinking", signal());
  const codes = new Set(CCPMB_COMMUNES.map((c) => c.code));
  return { points: points.filter((p) => codes.has(p.id)), fetchedAt: new Date().toISOString() };
}, (data) => { valid(data); nonempty(data.points); });
if (drinking) {
  const summaries = await update("drinking-summaries", "water", 24, water, async () => {
    const result = {};
    let failed = false;
    await loadDrinkingSummaries(drinking.points.map((p) => p.id), AbortSignal.timeout(300000), (id, summary) => { result[id] = summary; }, async (url, abort) => {
      try { return await fetchJson(url, abort, 3); } catch (error) { failed = true; throw error; }
    });
    if (failed || Object.keys(result).length !== drinking.points.length) throw new Error("Incomplete networks");
    return result;
  });
  const ids = new Set(Object.values(summaries ?? {}).flatMap((s) => s.networks.map((n) => n.id)));
  for (const id of ids) {
    await update(`drinking-${id}`, "water", 24, analysisUrl("drinking", id), async () => {
      const data = rows(await fetchJson(analysisUrl("drinking", id), signal(), 3));
      if (data.some((r) => !r.reseaux?.some((n) => String(n.code) === id))) throw new Error("Network mismatch");
      return data;
    }, (data) => { if (!Array.isArray(data)) throw new Error("Invalid results"); });
  }
}

await update("bathing", "water", 24, "https://baignades.sante.gouv.fr/baignades/", async () => {
  const data = await loadBathingWater();
  const previous = (await readJson("public/data/bathing.json", null))?.data;
  for (const point of data.points) for (const season of point.seasons) {
    if (!season.error) continue;
    const old = previous?.points.find((p) => p.id === point.id)?.seasons.find((s) => s.year === season.year);
    if (old?.samples.length) { season.samples = old.samples; season.fetchedAt = old.fetchedAt; }
  }
  return data;
}, (data) => {
  nonempty(data.points);
  if (data.points.every((p) => p.seasons.every((s) => s.error && !s.samples.length))) throw new Error("No bathing results available");
  if (data.points.some((p) => p.seasons.some((s) => s.error))) return "partial";
});
const groundwater = await update("groundwater", "water", 24, GROUNDWATER_SOURCE, loadGroundwaterCatalogue, (data) => { valid(data); nonempty(data.stations); });
// Bounded concurrency, one small history window per published station, never national downloads.
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < (groundwater?.stations.length ?? 0)) {
    const station = groundwater.stations[cursor++];
    await update(`groundwater-${station.id.toLowerCase()}`, "water", 24, GROUNDWATER_SOURCE, () => loadGroundwaterAnalyses(station, signal()), (data) => { if (!Array.isArray(data.analyses)) throw new Error("Invalid analyses"); });
  }
}));
await update("traffic", "annual", 24 * 30, roadTrafficUrl(), loadRoadTraffic);
await update("emissions", "annual", 24 * 30, IREP_CATALOGUE_URL, loadIndustrialEmissions);
await update("georisques", "georisques", 24, "https://www.georisques.gouv.fr/services", loadGeorisques, (data) => {
  valid(data);
  // Never replace a complete catalogue with one missing an entire source.
  if (data.errors.length || !Array.isArray(data.sites)) throw new Error("Incomplete Géorisques catalogue");
});
// Small local annual/monthly products, refreshed monthly; never visitor requests.
await update("pesticide-purchases", "overlays", 720, PESTICIDE_SOURCE, () => loadPesticidePurchases(signal(), true), (data) => { valid(data); nonempty(data.rows); nonempty(data.years); });
await update("cerema-light", "overlays", 720, CEREMA_LIGHT_SOURCE, () => loadCeremaLight(signal(), true));
for (const { id } of ATMO_MODELS) {
  await update(`atmo-model-${id}`, "overlays", 720, ATMO_MODEL_SOURCE, () => loadAtmoModelExport(id, signal()));
}
const failures = await store.save();
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = Object.entries(store.manifest.datasets).map(([key, d]) => `| ${key} | ${d.status} | ${d.lastSuccessAt ?? "never"} |`);
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Atlas import\n\n${failures} failed imports; previous successful snapshots retained.\n\n| Dataset | Status | Last successful import |\n|---|---|---|\n${lines.join("\n")}\n`);
}
// Publication must run even on provider failures; workflow reports failure afterwards.
process.exitCode = failures ? 1 : 0;
