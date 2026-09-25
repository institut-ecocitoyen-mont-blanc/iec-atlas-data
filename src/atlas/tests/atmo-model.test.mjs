import test from "node:test";
import assert from "node:assert/strict";
import { ATMO_MODELS, ATMO_MODEL_SCALES, ATMO_MODEL_REFERENCES, atmoLegendGradient, atmoModelTileUrl, atmoModelLegendUrl } from "../lib/atmo-model.ts";
test("annual maps and legends use the same pollutant with mercator tiles", () => {
  for (const model of ATMO_MODELS) {
    const map = new URL(atmoModelTileUrl(model.id, [1, 2, 3, 4], 256));
    const legend = new URL(atmoModelLegendUrl(model.id));
    assert.equal(map.searchParams.get("LAYERS"), legend.searchParams.get("LAYER"));
    assert.equal(map.searchParams.get("SRS"), "EPSG:3857");
    assert.equal(map.searchParams.get("BBOX"), "1,2,3,4");
    assert.equal(map.searchParams.get("WIDTH"), "256");
    assert.equal(map.searchParams.get("TRANSPARENT"), "true");
  }
});
test("ozone shows a days indicator and three-year period, not annual concentration", () => {
  const o3 = ATMO_MODELS.find(({ id }) => id === "o3");
  assert.equal(o3.period, "2023–2025"); assert.match(o3.metric, /jours/);
});
test("native legends preserve the exact provider ramps and units", () => {
  const expected = { pm25: [0, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 50], pm10: [0, 8, 12, 16, 20, 24, 28, 32, 36, 40, 50], no2: [0, 8, 12, 16, 20, 24, 28, 32, 36, 40, 80], o3: [0, 7, 10, 12, 15, 17, 20, 22, 25, 50] };
  for (const { id } of ATMO_MODELS) {
    const { stops, ticks, unit } = ATMO_MODEL_SCALES[id];
    assert.deepEqual(stops.map(({ value }) => value), expected[id]);
    assert.equal(unit, id === "o3" ? "jours/an" : "µg/m³");
    assert.ok(ticks.every((tick) => stops.some(({ value }) => value === tick)));
    assert.equal(stops[0].color, "#00CCAA");
    assert.equal(stops.at(-1).color, id === "pm10" ? "#222222" : "#800000");
  }
  assert.equal(ATMO_MODEL_SCALES.o3.stops.find(({ value }) => value === 25).color, "#FF0000");
  assert.match(atmoLegendGradient("o3"), /#FF0000 50%/);
  assert.match(atmoLegendGradient("pm10"), /#FF0000 80%/);
  assert.match(atmoLegendGradient("no2"), /#FF0000 50%/);
});
test("highlighted references distinguish annual limits, WHO guidance and ozone target", () => {
  assert.deepEqual(ATMO_MODEL_REFERENCES.pm25, { limit: 25, label: "Valeur limite", who: 5 });
  assert.deepEqual(ATMO_MODEL_REFERENCES.pm10, { limit: 40, label: "Valeur limite", who: 15 });
  assert.deepEqual(ATMO_MODEL_REFERENCES.no2, { limit: 40, label: "Valeur limite", who: 10 });
  assert.deepEqual(ATMO_MODEL_REFERENCES.o3, { limit: 25, label: "Valeur cible pour la protection de la santé humaine" });
});
