import { readJson } from "./store.mjs";
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const manifest = await readJson("public/manifest.json", null);
if (!manifest || manifest.schemaVersion !== 1) throw new Error("Missing manifest");
for (const [key, entry] of Object.entries(manifest.datasets)) {
  if (!entry.path) continue; // Failed first import is explicitly unavailable, not an empty dataset.
  if (entry.path !== `data/${key}.json`) throw new Error("Unexpected path");
  const snapshot = await readJson(`public/${entry.path}`, null);
  if (snapshot?.schemaVersion !== 1 || snapshot.key !== key || snapshot.data == null) throw new Error(`Invalid snapshot: ${key}`);
  if (snapshot.archive) {
    const archive = snapshot.archive;
    if (archive.version !== 1 || archive.complete !== true || !['$', 'analyses', 'records'].includes(archive.field) || !Number.isSafeInteger(archive.count) || archive.count < 0 || !Array.isArray(archive.parts)) throw new Error(`Invalid archive: ${key}`);
    let total = 0;
    for (const part of archive.parts) {
      if (!/^[a-f0-9]{64}$/.test(part.hash) || part.path !== `history/${key}/${part.hash}.json.gz`) throw new Error(`Unsafe archive path: ${key}`);
      const bytes = await readFile(`public/${part.path}`);
      if (createHash('sha256').update(bytes).digest('hex') !== part.hash) throw new Error(`Corrupt archive: ${key}`);
      const records = JSON.parse(gunzipSync(bytes));
      if (!Array.isArray(records) || records.length !== part.count) throw new Error(`Incomplete archive: ${key}`);
      total += records.length;
    }
    if (total !== archive.count) throw new Error(`Truncated archive: ${key}`);
  }
  if (key === "atmo-index" && (snapshot.license?.id !== "ODbL-1.0" || !snapshot.attribution || entry.license?.id !== "ODbL-1.0" || !snapshot.data.records?.length)) throw new Error("Invalid Atmo index snapshot or rights");
  if (key.startsWith("geodair-") && (snapshot.license?.id !== "Licence-Ouverte" || !snapshot.attribution || entry.license?.id !== "Licence-Ouverte")) throw new Error(`Missing Geod’air rights notice: ${key}`);
  if (key.startsWith("air-") && (snapshot.license?.id !== "ODbL-1.0" || !snapshot.attribution || entry.license?.id !== "ODbL-1.0")) throw new Error(`Missing Atmo rights notice: ${key}`);
  if (key.startsWith("atmo-model-") && (snapshot.license?.id !== "ODbL-1.0" || snapshot.data.crs !== "EPSG:3857" || !snapshot.data.imageDataUrl?.startsWith("data:image/png;base64,"))) throw new Error(`Invalid Atmo model export: ${key}`);
  if (["cerema-light", "pesticide-purchases"].includes(key) && (snapshot.license?.id !== "etalab-2.0" || !snapshot.attribution)) throw new Error(`Missing open-data rights notice: ${key}`);
}
console.log(`Checked ${Object.keys(manifest.datasets).length} manifest entries`);
