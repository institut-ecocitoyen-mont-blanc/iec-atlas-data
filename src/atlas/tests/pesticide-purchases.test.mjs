import test from "node:test";
import assert from "node:assert/strict";
import { PESTICIDE_ZONES, pesticideUrl, parsePurchasePage, purchaseSummary, substanceSummaries, purchaseLabel, pesticideColor, loadPesticidePurchases } from "../lib/pesticide-purchases.ts";
import { CCPMB_COMMUNES } from "../lib/ccpmb-territory.ts";

const row = (overrides = {}) => ({ type_territoire: "Zone postale", code_territoire: "74190", annee: 2024, libelle_substance: "Test", code_cas: "CAS1", quantite: 2, achat_etranger: "Non", fonction: "Herbicide", ...overrides });
const page = (rows, more = false, count = rows.length) => ({ data: rows, count, next: more ? "http://hubeau.eaufrance.fr:80/next" : null });
test("postal correspondence covers exactly ten communes, once each", () => {
  const codes = PESTICIDE_ZONES.flatMap((zone) => zone.communes);
  assert.equal(new Set(codes).size, 10);
  assert.deepEqual(codes.sort(), CCPMB_COMMUNES.map(({ code }) => code).sort());
  const url = new URL(pesticideUrl(2));
  assert.equal(url.protocol, "https:");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("type_territoire"), "Zone postale");
  assert.equal(url.searchParams.get("code_territoire").split(",").length, 5);
});
test("sums substance masses across products, never mixes years or postal zones implicitly", () => {
  const rows = parsePurchasePage(page([row(), row({ amm: "product2", quantite: 3 }), row({ libelle_substance: "Other", code_cas: "CAS2", quantite: 7 })])).rows;
  assert.equal(purchaseSummary(rows).quantity, 12);
  assert.deepEqual(substanceSummaries(rows).map(({ quantity }) => quantity), [7, 5]);
});
test("preserves zero, missing and confidential quantities; labels partial sums", () => {
  const rows = parsePurchasePage(page([row({ quantite: 0 }), row({ quantite: null }), row({ quantite: "" }), row({ quantite: -1 }), row({ quantite: 9, achat_etranger: "nc" })])).rows;
  assert.deepEqual(rows.map(({ quantity }) => quantity), [0, null, null, null, null]);
  assert.deepEqual(purchaseSummary(rows), { quantity: 0, missing: 4, records: 5 });
  assert.match(purchaseLabel(purchaseSummary(rows)), /partiel/);
  assert.equal(purchaseSummary([]).quantity, null);
  assert.equal(purchaseSummary(rows.slice(1)).quantity, null);
  assert.notEqual(pesticideColor(null), pesticideColor(0));
  assert.equal(purchaseLabel(purchaseSummary([])), "Aucun achat renseigné");
});
test("rejects schema drift, wrong scope and non-substance responses", () => {
  for (const value of [{}, page([row({ type_territoire: "Département" })]), page([row({ code_territoire: "74400" })]), page([row({ libelle_substance: null })]), page([row({ annee: null })])]) assert.throws(() => parsePurchasePage(value));
});
test("loads every page over HTTPS, rejects truncated responses, caches only complete data", async (t) => {
  const calls = [];
  const responses = [page([row()], true, 2), page([row({ quantite: 4 })], false, 2)];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(url); return Response.json(responses.shift()); });
  const result = await loadPesticidePurchases(new AbortController().signal, true);
  assert.equal(purchaseSummary(result.rows).quantity, 6);
  assert.deepEqual(result.years, [2024]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.startsWith("https://hubeau.eaufrance.fr/")));
  responses.push(page([row()], false, 2));
  await assert.rejects(loadPesticidePurchases(new AbortController().signal, true), /totalité/);
  assert.equal(await loadPesticidePurchases(new AbortController().signal), result);
});
