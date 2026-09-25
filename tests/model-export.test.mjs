import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { modelExtent, modelMask, loadAtmoModelExport } from "../scripts/atmo-model-export.mjs";
import { rightsForDataset } from "../scripts/rights.mjs";

test("bounded projected extent and ten-commune mask preserve transparent surroundings", async () => {
  const extent = modelExtent(128);
  assert.equal(Math.max(extent.width, extent.height), 128);
  assert.ok(extent.bbox[2] > extent.bbox[0] && extent.bbox[3] > extent.bbox[1]);
  const png = await sharp(modelMask(extent)).png().toBuffer();
  const stats = await sharp(png).stats();
  assert.equal(stats.channels[3].min, 0);
  assert.equal(stats.channels[3].max, 255);
});
test("Atmo raster export validates PNG dimensions and masks before publishing", async (t) => {
  const extent = modelExtent();
  const source = await sharp({ create: { width: extent.width, height: extent.height, channels: 4, background: "red" } }).png().toBuffer();
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.searchParams.get("HEIGHT"), String(extent.height));
    return new Response(source, { headers: { "content-type": "image/png" } });
  });
  const result = await loadAtmoModelExport("pm25", new AbortController().signal);
  assert.equal(result.id, "pm25");
  assert.equal(result.crs, "EPSG:3857");
  assert.deepEqual(result.bbox, extent.bbox);
  const stats = await sharp(Buffer.from(result.imageDataUrl.split(",")[1], "base64")).stats();
  assert.equal(stats.channels[3].min, 0);
  assert.equal(stats.channels[3].max, 255);
  t.mock.method(globalThis, "fetch", async () => new Response("<Exception/>", { headers: { "content-type": "text/xml" } }));
  await assert.rejects(loadAtmoModelExport("pm25", new AbortController().signal), /unavailable/);
});
test("all new snapshots have dataset-specific rights and provenance", () => {
  for (const key of ["pesticide-purchases", "cerema-light"]) assert.equal(rightsForDataset(key).license.id, "etalab-2.0");
  for (const id of ["pm25", "pm10", "no2", "o3"]) {
    const rights = rightsForDataset(`atmo-model-${id}`);
    assert.equal(rights.license.id, "ODbL-1.0");
    assert.match(rights.attribution, /Cartes annuelles 2025/);
    assert.match(rights.transformations, /4096/);
  }
});
