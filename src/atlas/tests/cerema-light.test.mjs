import test from "node:test";
import assert from "node:assert/strict";
import { CCPMB_COMMUNES } from "../lib/ccpmb-territory.ts";
import { parseCeremaLight, ceremaLightUrl, lightColor, defaultLightMonth } from "../lib/cerema-light.ts";

const fixture = () => ({ features: CCPMB_COMMUNES.map(({ code }) => ({ attributes: { code_insee: code, f2025_12: 1.5, f2025_06: 0, d_extinct: " ", d_renov: "2019-07" } })) });
test("defaults to the latest matching calendar month, without mutating source order", () => {
  const months = ["2025-12", "2024-09", "2025-09", "2027-09"];
  assert.equal(defaultLightMonth(months, new Date("2026-09-25T10:00:00Z")), "2025-09");
  assert.deepEqual(months, ["2025-12", "2024-09", "2025-09", "2027-09"]);
  assert.equal(defaultLightMonth([...months, "2026-09"], new Date("2026-09-25T10:00:00Z")), "2026-09");
});
test("falls back to the latest available past month if no seasonal match exists", () => {
  assert.equal(defaultLightMonth(["2025-06", "2025-12", "2027-02"], new Date("2026-09-25T10:00:00Z")), "2025-12");
  assert.equal(defaultLightMonth([], new Date("2026-09-25T10:00:00Z")), "");
});
test("uses the Paris calendar month at year boundaries", () => {
  assert.equal(defaultLightMonth(["2025-01", "2025-12"], new Date("2025-12-31T23:30:00Z")), "2025-01");
});
test("Cerema requests exactly our ten communes, without remote geometries", () => {
  const url = new URL(ceremaLightUrl());
  for (const { code } of CCPMB_COMMUNES) assert.ok(url.searchParams.get("where").includes(`'${code}'`));
  assert.equal(url.searchParams.get("returnGeometry"), "false");
  assert.equal(url.searchParams.get("where").match(/'\d+'/g).length, 10);
});
test("keeps monthly dates and zero, normalizes source blanks", () => {
  const data = parseCeremaLight(fixture(), "2026-09-25T10:00:00Z");
  assert.equal(data.communes.length, 10);
  assert.deepEqual(data.months, ["2025-06", "2025-12"]);
  assert.equal(data.communes[0].monthly["2025-06"], 0);
  assert.equal(data.communes[0].extinction, null);
  assert.equal(data.communes[0].renovation, "2019-07");
});
test("does not coerce missing/invalid monthly values to zero", () => {
  const f = fixture();
  Object.assign(f.features[0].attributes, { f2025_01: null, f2025_02: "", f2025_03: -9999, f2025_04: NaN, f2025_05: Infinity });
  const data = parseCeremaLight(f, "2026-09-25T10:00:00Z");
  for (let m = 1; m <= 5; m++) assert.equal(data.communes[0].monthly[`2025-0${m}`], null);
  assert.equal(lightColor(null), "#94a3b8");
  assert.notEqual(lightColor(0), lightColor(null));
});
test("rejects incomplete, truncated and duplicate catalogues; excludes neighbours", () => {
  const f = fixture(); f.features.pop();
  assert.throws(() => parseCeremaLight(f, "now"), /incomplète/);
  assert.throws(() => parseCeremaLight({ ...fixture(), exceededTransferLimit: true }, "now"));
  assert.throws(() => parseCeremaLight({ error: { code: 500 } }, "now"));
  const duplicate = fixture(); duplicate.features.push(duplicate.features[0]);
  assert.throws(() => parseCeremaLight(duplicate, "now"), /dupliquée/);
  const neighbour = fixture(); neighbour.features.push({ attributes: { code_insee: "74056", f2025_12: 10 } });
  assert.equal(parseCeremaLight(neighbour, "now").communes.length, 10);
});
test("radiance classes stay fixed across months", () => {
  assert.equal(lightColor(0.49), "#fef3c7"); assert.equal(lightColor(0.5), "#fbbf24");
  assert.equal(lightColor(1), "#f97316"); assert.equal(lightColor(2), "#be185d"); assert.equal(lightColor(5), "#581c87");
});
