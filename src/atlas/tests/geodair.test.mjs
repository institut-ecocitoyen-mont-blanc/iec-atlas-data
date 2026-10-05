import test from "node:test";
import assert from "node:assert/strict";
import { geodairTime, parseGeodairHourly, parseGeodairHistory, geodairExport } from "../lib/geodair-source.ts";
import { withGeodairStation, airReadingStatus, GEODAIR_POLLUTANTS } from "../lib/geodair.ts";
import { airQuality } from "../lib/environmental-quality.ts";

const from = Date.parse("2026-10-05T00:00:00Z"), to = from + 3600000;
const row = (extra = {}) => ({ "Date de début": "2026-10-05 00:00:00", "Date de fin": "2026-10-05 01:00:00", "code site": "FR33220", "nom site": "PASSY", Polluant: "PM10", valeur: "5.7", "valeur brute": "5.66666667", "unité de mesure": "µg-m3", "type de valeur": "moyenne horaire brute", validité: "1", "code qualité": "A", Latitude: "45.92361", Longitude: "6.713611", "couverture de données": "", ...extra });
const csv = (rows) => '\ufeff' + [Object.keys(rows[0]), ...rows.map(Object.values)].map(values => values.map(v => JSON.stringify(v)).join(";")).join("\n");
const hourly = (extra = {}) => GEODAIR_POLLUTANTS.filter(p => p.id !== "bap").map(p => row({ Polluant: p.name, ...extra }));

test("dates are UTC in both formats, including DST; impossible dates rejected", () => {
  assert.equal(geodairTime("2026/10/25 02:00:00"), Date.parse("2026-10-25T02:00:00Z"));
  assert.equal(geodairTime("2026-10-05 00:00:00"), from);
  assert.throws(() => geodairTime("2026-02-30 00:00:00"));
  assert.throws(() => geodairTime("05/10/2026 00:00:00"));
});
test("six hourly species preserve coordinates, units, raw values and distinct status fields", () => {
  const data = parseGeodairHourly(csv(hourly()), from, to);
  assert.equal(Object.keys(data.stations).length, 6);
  const station = data.stations.pm10, reading = station.readings[0];
  assert.equal(station.lat, 45.92361);
  assert.equal(station.lng, 6.713611);
  assert.equal(station.source, "geodair");
  assert.equal(reading.value, 5.7);
  assert.equal(reading.rawValue, 5.66666667);
  assert.equal(reading.unit, "µg/m³");
  assert.match(airReadingStatus(reading, true), /horaire brute · validité 1 · qualité A/);
});
test("invalid and empty values never become zero or enter pin quality", () => {
  for (const extra of [{ valeur: "", "valeur brute": "" }, { validité: "-1" }]) {
    const data = parseGeodairHourly(csv(hourly(extra)), from, to);
    assert.equal(data.stations.pm25.readings[0].value, null);
    assert.equal(airQuality(["pm25", "pm10", "no2", "o3"].map(pollutant => ({ pollutant, station: data.stations[pollutant] })), to, true).level, "unknown");
  }
  assert.equal(parseGeodairHourly(csv(hourly({ validité: "4" })), from, to).stations.o3.readings[0].value, 5.7);
});
test("incomplete, duplicate, wrong-site, non-hourly and incompatible exports fail closed", () => {
  for (const records of [hourly().slice(1), [...hourly(), row()], hourly({ "code site": "FR33236" }), hourly({ Latitude: "0" }), hourly({ "type de valeur": "Moy. annuelle" }), hourly({ valeur: "oops" }), hourly({ "unité de mesure": "ng/m3" })]) {
    assert.throws(() => parseGeodairHourly(csv(records), from, to));
  }
  assert.throws(() => parseGeodairHourly("<html>Error</html>", from, to));
  assert.throws(() => parseGeodairHourly(csv(hourly()).replaceAll("validité", "status"), from, to));
});
test("annual and deferred sample units and periods remain distinct", () => {
  const annual = row({ Polluant: "BaP in PM10", "Date de début": "2025/01/01 00:00:00", "Date de fin": "2025/12/31 23:59:59", "type de valeur": "Moy. annuelle", "unité de mesure": "ng/m3", valeur: "1.0", "valeur brute": "0.9615", "couverture de données": "96.0" });
  const [result] = parseGeodairHistory(csv([annual]), "annual", Date.UTC(2013,0,1), from);
  assert.equal(result.pollutant, "bap"); assert.equal(result.rawValue, 0.9615); assert.equal(result.coverage, 96);
  const sample = { ...annual, "type de valeur": "Analyses différées" };
  assert.equal(parseGeodairHistory(csv([sample]), "samples", Date.UTC(2013,0,1), from)[0].unit, "ng/m³");
  assert.throws(() => parseGeodairHistory(csv([sample]), "annual", Date.UTC(2013,0,1), from));
});
test("national snapshot replaces whole Passy series, never splices sources or other stations", () => {
  const national = parseGeodairHourly(csv(hourly()), from, to);
  const regional = [{ ...national.stations.pm10, source: undefined, readings: [] }, { ...national.stations.pm10, id: "FR33236" }];
  assert.equal(withGeodairStation(regional, "pm10"), regional);
  assert.deepEqual(withGeodairStation(regional, "pm10", national), [regional[1], national.stations.pm10]);
});
test("pending download retries one job, key stays in header on official origin", async () => {
  const calls = [], responses = [new Response("api_gp_test"), new Response("pending", { status: 412 }), new Response("csv")];
  assert.equal(await geodairExport("test-only", { type_donnee: "a1" }, async (url, init) => {
    calls.push(url); assert.equal(new URL(url).origin, "https://www.geodair.fr"); assert.equal(init.headers.apikey, "test-only"); assert.equal(init.redirect, "error"); assert.ok(!url.includes("test-only")); return responses.shift();
  }, async () => {}), "csv");
  assert.equal(calls.filter(url => url.includes("statistique/export")).length, 1);
  assert.equal(calls[1], calls[2]);
});
test("missing key, forbidden response, empty export and unsafe job IDs never retry generation", async () => {
  await assert.rejects(geodairExport("", {}, async () => { throw new Error("must not fetch"); }), /Clé/);
  for (const response of [new Response("denied", { status: 403 }), new Response(null, { status: 204 }), new Response("https://attacker.invalid")]) {
    let calls = 0;
    await assert.rejects(geodairExport("test-only", {}, async () => { calls++; return response; }));
    assert.equal(calls, 1);
  }
});
