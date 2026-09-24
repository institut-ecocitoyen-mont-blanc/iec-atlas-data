import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rightsForDataset } from "./rights.mjs";

export const SCHEMA_VERSION = 1;
export function contentHash(data) {
  // Import timestamps are tracked in the manifest, not treated as new observations.
  const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().filter((k) => !["fetchedAt", "lastUpdated"].includes(k)).map((k) => [k, stable(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(stable(data))).digest("hex");
}
export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
export async function writeJson(path, data) {
  await writeFile(`${path}.tmp`, JSON.stringify(data) + "\n");
  await rename(`${path}.tmp`, path);
}
export function isDue(entry, intervalHours, now = Date.now()) {
  if (!entry?.lastAttemptAt) return true;
  const previous = Date.parse(entry.lastAttemptAt);
  if (!Number.isFinite(previous)) return true;
  if (intervalHours === 720) return new Date(now).toISOString().slice(0, 7) !== new Date(previous).toISOString().slice(0, 7);
  // UTC buckets avoid skipping an hour/day because the previous job started late.
  return Math.floor(now / (intervalHours * 3600000)) > Math.floor(previous / (intervalHours * 3600000));
}
export async function openStore(directory, now = new Date().toISOString()) {
  await mkdir(join(directory, "data"), { recursive: true });
  const manifest = await readJson(join(directory, "manifest.json"), { schemaVersion: SCHEMA_VERSION, datasets: {} });
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error("Unsupported existing manifest");
  let failures = 0;
  let checkpoint = Promise.resolve();
  const persist = () => {
    checkpoint = checkpoint.then(() => writeJson(join(directory, "manifest.json"), manifest));
    return checkpoint;
  };
  return {
    manifest,
    async update(key, source, intervalHours, loader, validate = () => {}) {
      if (!/^[a-z0-9-]+$/.test(key)) throw new Error("Unsafe dataset key");
      const previous = manifest.datasets[key];
      try {
        const data = await loader();
        const partial = validate(data) === "partial";
        const hash = contentHash(data);
        const path = `data/${key}.json`;
        const rights = rightsForDataset(key);
        const existing = await readJson(join(directory, path), null);
        if (previous?.hash !== hash || !existing || JSON.stringify(existing.license) !== JSON.stringify(rights.license)) {
          await writeJson(join(directory, path), { schemaVersion: SCHEMA_VERSION, key, ...rights, data });
        }
        manifest.datasets[key] = { path, hash, source, ...rights, intervalHours, lastAttemptAt: now, lastPublishedAt: now, ...(partial ? { lastSuccessAt: previous?.lastSuccessAt, status: "error", error: "Import partiel. Résultats valides conservés ; certaines données restent indisponibles." } : { lastSuccessAt: now, status: "ok" }) };
        if (partial) failures++;
        console.log(`${key}: ${partial ? "partial (available results retained)" : "ok"}`);
        return data;
      } catch (error) {
        failures++;
        // Only importer-owned labels enter public errors: never URLs with credentials.
        manifest.datasets[key] = { ...previous, source, intervalHours, lastAttemptAt: now, status: "error", error: "Import indisponible ou réponse invalide. Dernières données valides conservées si disponibles." };
        console.error(`${key}: import failed (${error instanceof Error ? error.name : "unknown"}); previous snapshot retained`);
        return previous?.path ? (await readJson(join(directory, previous.path), null))?.data : undefined;
      } finally {
        // Checkpoint each source, even if a later import is interrupted.
        manifest.checkedAt = now;
        await persist();
      }
    },
    async save() {
      manifest.checkedAt = now;
      await persist();
      return failures;
    },
  };
}
