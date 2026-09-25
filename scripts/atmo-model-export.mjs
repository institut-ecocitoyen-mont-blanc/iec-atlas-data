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
  const response = await fetch(url, { signal });
  if (!response.ok || !response.headers.get("content-type")?.includes("image/png")) throw new Error("Atmo raster unavailable");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Unexpected raster size");
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "png" || metadata.width !== extent.width || metadata.height !== extent.height) throw new Error("Unexpected raster dimensions");
  const png = await sharp(bytes).ensureAlpha().composite([{ input: modelMask(extent), blend: "dest-in" }]).png({ compressionLevel: 9 }).toBuffer();
  const stats = await sharp(png).stats();
  if (stats.channels[3]?.max !== 255 || stats.channels[3]?.min !== 0) throw new Error("Empty raster or missing territory mask");
  return { id, year: 2025, period: model.period, metric: model.metric, crs: "EPSG:3857", ...extent, imageDataUrl: `data:image/png;base64,${png.toString("base64")}`, sourceUrl: url.toString(), fetchedAt: new Date().toISOString() };
}
