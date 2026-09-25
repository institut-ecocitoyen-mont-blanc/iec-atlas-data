import { readJson } from "./store.mjs";
const manifest = await readJson("public/manifest.json", null);
if (!manifest || manifest.schemaVersion !== 1) throw new Error("Missing manifest");
for (const [key, entry] of Object.entries(manifest.datasets)) {
  if (!entry.path) continue; // Failed first import is explicitly unavailable, not an empty dataset.
  if (entry.path !== `data/${key}.json`) throw new Error("Unexpected path");
  const snapshot = await readJson(`public/${entry.path}`, null);
  if (snapshot?.schemaVersion !== 1 || snapshot.key !== key || snapshot.data == null) throw new Error(`Invalid snapshot: ${key}`);
  if (key.startsWith("air-") && (snapshot.license?.id !== "ODbL-1.0" || !snapshot.attribution || entry.license?.id !== "ODbL-1.0")) throw new Error(`Missing Atmo rights notice: ${key}`);
  if (key.startsWith("atmo-model-") && (snapshot.license?.id !== "ODbL-1.0" || snapshot.data.crs !== "EPSG:3857" || !snapshot.data.imageDataUrl?.startsWith("data:image/png;base64,"))) throw new Error(`Invalid Atmo model export: ${key}`);
  if (["cerema-light", "pesticide-purchases"].includes(key) && (snapshot.license?.id !== "etalab-2.0" || !snapshot.attribution)) throw new Error(`Missing open-data rights notice: ${key}`);
}
console.log(`Checked ${Object.keys(manifest.datasets).length} manifest entries`);
