import assert from "node:assert/strict";
import test from "node:test";
import { airQuality, drinkingQuality, AIR_COLOR_MAX_AGE, WATER_COLOR_MAX_AGE, demoPinLevel, demoAirPinLevel } from "../lib/environmental-quality.ts";

const now = Date.parse("2026-09-08T12:00:00Z");
const time = now - 3600000;
const measurement = (pollutant, value = 0, extra = {}) => ({ pollutant, station: { id: "station", influence: "Fond", readings: [{ value, time, unit: "µg/m³", validation: "t", ...extra }] } });
const complete = (pollutant = "no2", value = 0, extra = {}) => [measurement("pm25"), measurement("no2"), measurement("o3")].map((m) => m.pollutant === pollutant ? measurement(pollutant, value, extra) : m);

test("air uses the worst hourly band including genuine zero values", () => {
  assert.equal(airQuality(complete(), now).level, "good");
  for (const [pollutant, limits] of [["pm25", [5, 15, 50, 90, 140]], ["no2", [10, 25, 60, 100, 150]], ["o3", [60, 100, 120, 160, 180]]]) {
    const levels = ["good", "fair", "moderate", "poor", "very-poor", "extreme"];
    limits.forEach((limit, index) => {
      assert.equal(airQuality(complete(pollutant, limit), now).level, levels[index]);
      assert.equal(airQuality(complete(pollutant, limit + 0.01), now).level, levels[index + 1]);
    });
  }
  const pm10 = [measurement("pm10", 121), measurement("no2"), measurement("o3")];
  assert.equal(airQuality(pm10, now).level, "poor");
});

test("air cannot appear green from incomplete, mixed-hour, missing, invalid-unit or old data", () => {
  assert.equal(airQuality([measurement("no2")], now).level, "unknown");
  assert.equal(airQuality(complete(), now, false).level, "unknown");
  assert.equal(airQuality(complete("o3", 10, { time: time - 3600000 }), now).level, "unknown");
  for (const extra of [{ value: null }, { value: -1 }, { value: NaN }, { unit: "mg/L" }]) {
    assert.equal(airQuality(complete("o3", 0, extra), now).level, "unknown");
  }
  assert.equal(airQuality(complete(), time + AIR_COLOR_MAX_AGE + 1).level, "unknown");
  assert.equal(airQuality(complete(), time - 1).level, "unknown");
  assert.equal(airQuality([], now).level, "unknown");
});

test("poor individual pollutants remain flagged with explicit incomplete coverage", () => {
  const quality = airQuality([measurement("no2", 101)], now);
  assert.equal(quality.level, "very-poor");
  assert.match(quality.detail, /incomplète/);
  const traffic = [measurement("no2"), measurement("pm25")];
  traffic.forEach((m) => { m.station.influence = "Trafic"; });
  assert.equal(airQuality(traffic, now).level, "good");
});

const sample = (extra = {}) => ({ date_prelevement: new Date(time).toISOString(), conformite_limites_bact_prelevement: "C", conformite_limites_pc_prelevement: "C", conformite_references_bact_prelevement: "C", conformite_references_pc_prelevement: "C", ...extra });
test("water uses official sample conformity codes, not raw parameter concentrations", () => {
  assert.equal(drinkingQuality(sample(), now).level, "good");
  assert.equal(drinkingQuality(sample({ conformite_limites_pc_prelevement: "N" }), now).level, "poor");
  assert.equal(drinkingQuality(sample({ conformite_limites_bact_prelevement: "N", conformite_limites_pc_prelevement: "D" }), now).level, "poor");
  assert.equal(drinkingQuality(sample({ conformite_limites_pc_prelevement: "D" }), now).level, "moderate");
  assert.equal(drinkingQuality(sample({ conformite_references_pc_prelevement: "N" }), now).level, "moderate");
  for (const code of ["S", "", null, undefined, "unexpected"]) {
    assert.equal(drinkingQuality(sample({ conformite_limites_pc_prelevement: code }), now).level, "unknown");
  }
  assert.match(drinkingQuality(sample(), now).detail, /pas un bilan de tous les réseaux/);
});

test("historical water keeps the published assessment with age flagged; invalid dates stay unknown", () => {
  assert.equal(drinkingQuality(sample(), time + WATER_COLOR_MAX_AGE + 1).level, "good");
  assert.equal(drinkingQuality(sample(), time + WATER_COLOR_MAX_AGE + 1).historical, true);
  assert.equal(drinkingQuality(sample({ conformite_limites_pc_prelevement: "N" }), time + WATER_COLOR_MAX_AGE + 1).level, "poor");
  assert.equal(drinkingQuality(sample({ date_prelevement: null }), now).level, "unknown");
  assert.equal(drinkingQuality(sample(), time - 1).level, "unknown");
  assert.equal(drinkingQuality(undefined, now).level, "unknown");
});

test("demo pins use historical ratings without mutating dates, readings or real assessments", () => {
  const measurements = complete("no2", 61);
  for (const { station } of measurements) station.readings.push({ ...station.readings[0], time: now, value: null });
  const before = structuredClone(measurements);
  assert.equal(demoAirPinLevel(measurements, "air"), "poor");
  assert.equal(airQuality(measurements, now + AIR_COLOR_MAX_AGE + 1).level, "unknown");
  assert.deepEqual(measurements, before);
});

test("demo fallback is stable and limited to green, orange and red", () => {
  const levels = new Set(Array.from({ length: 30 }, (_, i) => demoPinLevel("unknown", `station-${i}`)));
  assert.deepEqual([...levels].sort(), ["good", "moderate", "poor"]);
  assert.equal(demoPinLevel("unknown", "same"), demoPinLevel("unknown", "same"));
  assert.equal(demoPinLevel("fair", "a"), "good");
  assert.equal(demoPinLevel("very-poor", "a"), "poor");
  assert.equal(demoPinLevel("extreme", "a"), "poor");
  assert.ok(levels.has(demoAirPinLevel([], "missing")));
});
