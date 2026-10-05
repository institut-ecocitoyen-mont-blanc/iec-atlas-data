import test from "node:test";
import assert from "node:assert/strict";
import { stationAtmoIndex, ATMO_INDEX_NEUTRAL, ATMO_INDEX_CLASSES, parisDay } from "../lib/atmo-index.ts";
import { parseAtmoIndex, atmoIndexUrl, loadAtmoIndex } from "../lib/atmo-index-source.ts";
import { ADDITIONAL_AIR_STATIONS } from "../lib/atmo-stations.ts";

const now = Date.parse("2026-10-05T08:00:00Z"), passy = { lat: 45.92361, lng: 6.713611 };
const row = (extra = {}) => ({ date_ech: "2026-10-05T00:00:00Z", date_dif: "2026-10-04T11:09:50Z", code_zone: "74208", lib_zone: "Passy", type_zone: "commune", code_qual: 2, lib_qual: "Moyen", coul_qual: "#50ccaa", source: "Atmo Auvergne-Rhône-Alpes", ...extra });
const response = rows => ({ type: "FeatureCollection", numberMatched: rows.length, numberReturned: rows.length, features: rows.map(properties => ({ properties })) });
const data = (...rows) => parseAtmoIndex(response(rows));

test("today's official index can be published yesterday, independent of station readings", () => {
  const result = stationAtmoIndex(passy, data(row()), now);
  assert.equal(result.label, "Moyen"); assert.equal(result.color, "#50ccaa"); assert.equal(result.commune.code, "74208"); assert.equal(result.date, "2026-10-05");
  for (const c of ATMO_INDEX_CLASSES) assert.equal(stationAtmoIndex(passy, data(row({code_qual:c.code,lib_qual:c.label,coul_qual:c.color})),now).color, c.color);
});
test("same-commune stations share an index; Sallanches uses its own commune", () => {
  const snapshot = data(row(), row({ code_zone: "74256", lib_zone: "Sallanches", code_qual:4, lib_qual:"Mauvais", coul_qual:"#ff5050" }));
  assert.equal(stationAtmoIndex(ADDITIONAL_AIR_STATIONS.find(s=>s.id==="ET00909"), snapshot, now).label, "Moyen");
  assert.equal(stationAtmoIndex(ADDITIONAL_AIR_STATIONS.find(s=>s.id==="FR33236"), snapshot, now).label, "Mauvais");
});
test("absent, yesterday, tomorrow, foreign, unpublished and unavailable indices stay neutral", () => {
  for (const snapshot of [undefined, data(row({date_ech:"2026-10-04T00:00:00Z"})), data(row({date_ech:"2026-10-06T00:00:00Z"})),data(row({code_zone:"74256"})),data(row({date_dif:"2026-10-05T09:00:00Z"})),data(row({code_qual:null}))]) {
    assert.equal(stationAtmoIndex(passy,snapshot,now).color,ATMO_INDEX_NEUTRAL);
    assert.equal(stationAtmoIndex(passy,snapshot,now).available,false);
  }
  assert.equal(stationAtmoIndex({lat:0,lng:0},data(row()),now).available,false);
});
test("Paris date switches at midnight including DST, never to tomorrow's newest record early", () => {
  const snapshot=data(row(),row({date_ech:"2026-10-06T00:00:00Z",code_qual:4,lib_qual:"Mauvais",coul_qual:"#ff5050"}));
  assert.equal(stationAtmoIndex(passy,snapshot,Date.parse("2026-10-05T21:59:59Z")).label,"Moyen");
  assert.equal(stationAtmoIndex(passy,snapshot,Date.parse("2026-10-05T22:00:00Z")).label,"Mauvais");
  assert.equal(parisDay(Date.parse("2026-12-31T23:00:00Z")),"2027-01-01");
});
test("newest revision wins; incomplete, incompatible, contradictory and foreign exports fail", () => {
  assert.equal(data(row(),row({date_dif:"2026-10-05T07:00:00Z",code_qual:4,lib_qual:"Mauvais",coul_qual:"#ff5050"})).records[0].code,4);
  for(const extra of [{code_zone:"75056"},{type_zone:"EPCI"},{code_qual:7},{coul_qual:"red"},{lib_qual:"Correct"},{date_ech:"2026-02-30T00:00:00Z"}]) assert.throws(()=>data(row(extra)));
  assert.throws(()=>parseAtmoIndex({...response([row()]),numberMatched:2}));
  assert.throws(()=>data(row(),row({code_qual:4,lib_qual:"Mauvais",coul_qual:"#ff5050"})));
  assert.throws(()=>data());
});
test("query restricts ten communes and yesterday through tomorrow without copying centroids", async t => {
  const url = new URL(atmoIndexUrl(now));
  assert.match(url.searchParams.get("CQL_FILTER"), /2026-10-04T00:00:00Z.*2026-10-06T00:00:00Z/);
  assert.equal((url.searchParams.get("CQL_FILTER").match(/'74\d{3}'/g)||[]).length,10);
  assert.ok(!url.searchParams.get("propertyName").includes("wgs84"));
  t.mock.method(globalThis,"fetch",async()=>Response.json(response([row()])));
  assert.equal((await loadAtmoIndex(now)).records[0].code,2);
});
