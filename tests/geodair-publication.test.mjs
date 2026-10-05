import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, isDue } from "../scripts/store.mjs";
import { rightsForDataset } from "../scripts/rights.mjs";

test("Geod’air rights stay separate from regional ODbL", () => {
  for (const key of ["geodair-hourly", "geodair-history"]) {
    assert.equal(rightsForDataset(key).license.id, "Licence-Ouverte");
    assert.match(rightsForDataset(key).attribution, /Geod’air/);
  }
  assert.equal(rightsForDataset("air-pm25").license.id, "ODbL-1.0");
});
test("secret is supplied only through the workflow import environment", async () => {
  const workflow = await readFile(new URL("../.github/workflows/import.yml", import.meta.url), "utf8");
  assert.equal((workflow.match(/secrets\.GEODAIR_API_KEY/g) || []).length, 1);
  assert.match(workflow, /GEODAIR_API_KEY: \$\{\{ secrets.GEODAIR_API_KEY \}\}/);
  assert.ok(!workflow.includes("NEXT_PUBLIC_GEODAIR"));
});
test("hourly guard and monthly buckets include failed attempts", () => {
  const now = Date.parse("2026-10-05T07:30:00Z");
  const entry = { lastAttemptAt: "2026-10-05T07:00:00Z", status: "error" };
  assert.equal(isDue(entry, 1, now), false);
  assert.equal(isDue(entry, 1, now + 3600000), true);
  assert.equal(isDue(entry, 720, now + 86400000), false);
});
test("credential/upstream failure retains published Geod’air and does not disclose the thrown secret", async () => {
  const directory = await mkdtemp(join(tmpdir(), "geodair-store-test-"));
  try {
    const store = await openStore(directory);
    await store.update("geodair-hourly", "https://www.geodair.fr/donnees/api", 1, async () => ({ stations: { pm25: { readings: [{ value: 4 }] } } }), () => {});
    const before = JSON.parse(await readFile(join(directory, "data/geodair-hourly.json"), "utf8"));
    await store.update("geodair-hourly", "https://www.geodair.fr/donnees/api", 1, async () => { throw new Error("test-secret-do-not-publish"); }, () => {});
    await store.save();
    assert.deepEqual(JSON.parse(await readFile(join(directory, "data/geodair-hourly.json"), "utf8")), before);
    assert.equal(before.license.id, "Licence-Ouverte");
    assert.ok(!(await readFile(join(directory, "manifest.json"), "utf8")).includes("test-secret-do-not-publish"));
  } finally { await rm(directory, { recursive: true }); }
});
