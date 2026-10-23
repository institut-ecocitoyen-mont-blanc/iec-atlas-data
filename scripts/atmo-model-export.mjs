import sharp from "sharp";
import { CCPMB_BOUNDS, CCPMB_POLYGONS } from "../src/atlas/lib/ccpmb-territory.ts";
import { ATMO_MODELS, atmoModelTileUrl } from "../src/atlas/lib/atmo-model.ts";

const project = ([lng, lat]) => [6378137 * lng * Math.PI / 180, 6378137 * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
export function modelExtent(maxSize = 4096) {
  const sw = project([CCPMB_BOUNDS.west, CCPMB_BOUNDS.south]);
  const ne = project([CCPMB_BOUNDS.east, CCPMB_BOUNDS.north]);
  const bbox = [...sw, ...ne];
  const pixelSize = Math.max(ne[0] - sw[0], ne[1] - sw[1]) / maxSize;
  return { bbox, width: Math.ceil((ne[0] - sw[0]) / pixelSize), height: Math.ceil((ne[1] - sw[1]) / pixelSize) };
}
export function modelMask({ bbox: [west, south, east, north], width, height }) {
  const paths = CCPMB_POLYGONS.map((polygon) => polygon.map((ring) => ring.map((point, i) => {
    const [x, y] = project(point);
    return `${i ? "L" : "M"}${(x - west) / (east - west) * width},${(north - y) / (north - south) * height}`;
  }).join(" ") + " Z").join(" "));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${paths.map((d) => `<path d="${d}" fill="white" fill-rule="evenodd"/>`).join("")}</svg>`);
}
export async function loadAtmoModelExport(id, signal) {
  const model = ATMO_MODELS.find((model) => model.id === id);
  if (!model) throw new Error("Unknown model");
  const extent = modelExtent();
  const url = new URL(atmoModelTileUrl(id, extent.bbox, extent.width));
  url.searchParams.set("HEIGHT", String(extent.height));
  return renderModel(url, extent, { id, year: 2025, period: model.period, metric: model.metric }, signal);
}
async function renderModel(url, extent, metadataFields, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.headers.get("content-type")?.includes("image/png")) throw new Error("Atmo raster unavailable");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Unexpected raster size");
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "png" || metadata.width !== extent.width || metadata.height !== extent.height) throw new Error("Unexpected raster dimensions");
  const png = await sharp(bytes).ensureAlpha().composite([{ input: modelMask(extent), blend: "dest-in" }]).png({ compressionLevel: 9 }).toBuffer();
  const stats = await sharp(png).stats();
  if (stats.channels[3]?.max !== 255 || stats.channels[3]?.min !== 0) throw new Error("Empty raster or missing territory mask");
  return { ...metadataFields, crs: "EPSG:3857", ...extent, imageDataUrl: `data:image/png;base64,${png.toString("base64")}`, sourceUrl: url.toString(), fetchedAt: new Date().toISOString() };
}
export const MODEL_CATALOGUE = 'https://sig.atmo-auvergnerhonealpes.fr/geoserver/ows?service=WMS&version=1.3.0&request=GetCapabilities';
export function parseModelCatalogue(xml) {
  if (!xml.includes('</WMS_Capabilities>')) throw new Error('Incomplete WMS catalogue');
  const names = [...new Set([...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map(m => m[1]))];
  const layers = names.filter(name => /^mod_aura_region_\d{4}:/.test(name) && /(?:no2|pm10|pm25).*moyan|moyan.*(?:no2|pm10|pm25)|o3.*nbj.*120/i.test(name) && !/terristory|boolean|_oms|_mef/i.test(name));
  if (!layers.length) throw new Error('No historical Atmo model layers');
  return layers.map(layer => ({ layer, year: Number(layer.match(/^mod_aura_region_(\d{4})/)[1]) }));
}
export async function loadModelCatalogue() {
  const response = await fetch(MODEL_CATALOGUE, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Model catalogue unavailable');
  const models = parseModelCatalogue(await response.text());
  for (const year of new Set(models.map(m => m.year))) {
    const metadata = await fetch(`https://www.data.gouv.fr/api/1/datasets/cartes-annuelles-${year}/`, {signal:AbortSignal.timeout(30000)});
    if (!metadata.ok) throw new Error(`Historical model rights unavailable: ${year}`);
    const value = await metadata.json();
    if (value.license !== 'odc-odbl' || value.organization?.name !== 'Atmo Auvergne-Rhône-Alpes') throw new Error(`Historical model rights changed: ${year}`);
  }
  return models;
}
export async function loadHistoricalModel({ layer, year }) {
  if (!/^mod_aura_region_\d{4}:[A-Za-z0-9_]+$/.test(layer)) throw new Error('Invalid historical model');
  const extent = modelExtent(), signal = AbortSignal.timeout(120000);
  const url = new URL('https://sig.atmo-auvergnerhonealpes.fr/geoserver/ows');
  url.search = new URLSearchParams({ SERVICE:'WMS', VERSION:'1.1.1', REQUEST:'GetMap', LAYERS:layer, STYLES:'', FORMAT:'image/png', TRANSPARENT:'true', SRS:'EPSG:3857', BBOX:extent.bbox.join(','), WIDTH:String(extent.width), HEIGHT:String(extent.height) }).toString();
  const legend = new URL(url); legend.search = new URLSearchParams({SERVICE:'WMS', VERSION:'1.1.1', REQUEST:'GetLegendGraphic', LAYER:layer, FORMAT:'application/json'}).toString();
  const response = await fetch(legend, { signal });
  if (!response.ok) throw new Error('Historical legend unavailable');
  const legendData = await response.json();
  if (!Array.isArray(legendData.Legend) || !legendData.Legend.length) throw new Error('Invalid historical legend');
  return renderModel(url, extent, { layer, year, legend: legendData, representation: 'Provider-rendered map and original legend; not a numerical concentration grid' }, signal);
}
