import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, isDue, contentHash } from "../scripts/store.mjs";

test("failure preserves the last successful snapshot and timestamp, then recovers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-store-test-"));
  try {
    const first = await openStore(dir, "2026-09-24T00:00:00Z");
    await first.update("air", "provider", 1, async () => ({ readings: [12] }));
    await first.save();
    const original = await readFile(join(dir, "data/air.json"), "utf8");
    const next = await openStore(dir, "2026-09-24T01:00:00Z");
    assert.deepEqual(await next.update("air", "provider", 1, async () => { throw new Error("secret"); }), { readings: [12] });
    assert.equal(await next.save(), 1);
    assert.equal(await readFile(join(dir, "data/air.json"), "utf8"), original);
    assert.equal(next.manifest.datasets.air.lastSuccessAt, "2026-09-24T00:00:00Z");
    assert.equal(next.manifest.datasets.air.status, "error");
    assert.ok(!JSON.stringify(next.manifest).includes("secret"));
    await next.update("air", "provider", 1, async () => ({ readings: [15] }));
    assert.equal(next.manifest.datasets.air.status, "ok");
  } finally { await rm(dir, { recursive: true }); }
});
test("first failure creates no false empty data; validation failure is retained", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-store-test-"));
  try {
    const store = await openStore(dir);
    await store.update("river", "provider", 24, async () => [], () => { throw new Error("Unexpected empty"); });
    assert.equal(store.manifest.datasets.river.path, undefined);
    assert.equal(await store.save(), 1);
  } finally { await rm(dir, { recursive: true }); }
});
test("timestamps don't create observation changes and schedules respect last attempt", () => {
  assert.equal(contentHash({ fetchedAt: "a", x: 1 }), contentHash({ x: 1, fetchedAt: "b" }));
  assert.notEqual(contentHash({ x: 1 }), contentHash({ x: 2 }));
  assert.equal(isDue(undefined, 24), true);
  assert.equal(isDue({ lastAttemptAt: "2026-09-24T00:00:00Z" }, 24, Date.parse("2026-09-24T23:00:00Z")), false);
  assert.equal(isDue({ lastAttemptAt: "2026-09-24T11:29:00Z" }, 1, Date.parse("2026-09-24T12:27:00Z")), true);
  assert.equal(isDue({ lastAttemptAt: "2026-09-24T00:00:00Z" }, 720, Date.parse("2026-10-01T00:00:00Z")), true);
});
test("concurrent source checkpoints retain all sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-store-test-"));
  try {
    const store = await openStore(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.update(`station-${i}`, "provider", 24, async () => [i])));
    await store.save();
    assert.equal(Object.keys(JSON.parse(await readFile(join(dir, "manifest.json"))).datasets).length, 20);
  } finally { await rm(dir, { recursive: true }); }
});
test("partial publication never claims complete success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-store-test-"));
  try {
    const store = await openStore(dir);
    await store.update("bathing", "provider", 24, async () => ({ points: [1] }), () => "partial");
    assert.equal(store.manifest.datasets.bathing.status, "error");
    assert.equal(store.manifest.datasets.bathing.path, "data/bathing.json");
    assert.equal(store.manifest.datasets.bathing.lastSuccessAt, undefined);
    assert.equal(await store.save(), 1);
  } finally { await rm(dir, { recursive: true }); }
});
test("Atmo licence and attribution accompany JSON and manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-store-test-"));
  try {
    const store = await openStore(dir);
    await store.update("air-pm25", "provider", 1, async () => [{ readings: [] }]);
    const snapshot = JSON.parse(await readFile(join(dir, "data/air-pm25.json")));
    assert.equal(snapshot.license.id, "ODbL-1.0");
    assert.ok(snapshot.attribution.includes("Source ATMO"));
    assert.equal(store.manifest.datasets["air-pm25"].license.id, "ODbL-1.0");
  } finally { await rm(dir, { recursive: true }); }
});
test("Géorisques licence accompanies snapshots; partial catalogue failure retains complete data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-store-test-"));
  try {
    const store = await openStore(dir);
    await store.update("georisques", "provider", 24, async () => ({ sites: [1, 2], errors: [] }));
    const snapshot = JSON.parse(await readFile(join(dir, "data/georisques.json")));
    assert.equal(snapshot.license.id, "etalab-2.0");
    assert.match(snapshot.attribution, /BRGM/);
    const retained = await store.update("georisques", "provider", 24, async () => ({ sites: [1], errors: ["SIS unavailable"] }), (data) => {
      if (data.errors.length) throw new Error("Incomplete catalogue");
    });
    assert.deepEqual(retained.sites, [1, 2]);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "data/georisques.json"))), snapshot);
    assert.equal(store.manifest.datasets.georisques.status, "error");
  } finally { await rm(dir, { recursive: true }); }
});
