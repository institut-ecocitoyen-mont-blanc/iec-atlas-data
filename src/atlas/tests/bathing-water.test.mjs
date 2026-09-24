import assert from "node:assert/strict";
import test from "node:test";
import { BATHING_SITES, bathingQuality, bathingSamples } from "../lib/bathing-water.ts";
import { parseBathingPage, loadBathingWater } from "../lib/bathing-water-source.ts";

// Small fixtures mirror the source's table classes, including literal '<15'.
function page(site = BATHING_SITES[0], year = 2026) {
  return `${site.officialName} <a href="consultSite.do?isite=${site.id}">Source</a>
    <a name="details"></a><table>
    <tr><th scope="Date">Paramètres obligatoires</th><th>30/06/${year}</th><th>16/07/${year}</th><th>Bon/moyen</th><th>Moyen/mauvais</th></tr>
    <tr><td class="cellule_paire">Ent&eacute;rocoques intestinaux (/100mL)</td><td><15</td><td>&nbsp;</td><td>100</td><td>660</td></tr>
    <tr><td class="cellule_impaire">Escherichia coli (E.coli) (/100mL)</td><td>0</td><td>110</td><td>100</td><td>1800</td></tr>
    </table><td class="cadre_dotted fondBon"><strong>30/06/${year}</strong>Bon</td><td class="cadre_dotted fondMoyen"><strong>16/07/${year}</strong>Moyen</td>`;
}

test("keeps dates, zero, missing values and less-than qualifiers; excludes threshold columns", () => {
  assert.deepEqual(parseBathingPage(page(), BATHING_SITES[0], 2026), [
    { date: "2026-06-30", ecoli: "0", enterococci: "<15", assessment: "Bon" },
    { date: "2026-07-16", ecoli: "110", enterococci: null, assessment: "Moyen" },
  ]);
});
test("rejects different sites, wrong seasons, invalid dates, units and shifted columns", () => {
  for (const html of [
    page(BATHING_SITES[1]), page(undefined, 2025), page().replaceAll("30/06/2026", "31/06/2026"),
    page().replaceAll("/100mL", "/mL"), page().replace("<td>110</td>", ""),
    page().replace("<td>110</td>", "<td>unexpected</td>"), "<html>Service unavailable</html>",
  ]) assert.throws(() => parseBathingPage(html, BATHING_SITES[0], 2026));
});
test("never invents sample assessments or deduces them from thresholds", () => {
  const samples = parseBathingPage(page().replaceAll("cadre_dotted", "other"), BATHING_SITES[0], 2026);
  const point = { ...BATHING_SITES[0], seasons: [{ samples }] };
  assert.equal(bathingQuality(point).level, "unknown");
  assert.equal(samples[0].assessment, "Non renseigné");
});
test("uses latest dated sample across seasons and maps only published verdicts", () => {
  for (const [assessment, level] of [["Bon", "good"], ["Moyen", "moderate"], ["Mauvais", "poor"]]) {
    const point = { ...BATHING_SITES[0], seasons: [{ samples: [{ date: "2025-01-01", assessment: "Mauvais" }] }, { samples: [{ date: "2026-07-01", assessment }] }] };
    assert.equal(bathingSamples(point)[0].date, "2026-07-01");
    assert.equal(bathingQuality(point).level, level);
  }
  assert.equal(bathingQuality({ ...BATHING_SITES[0], seasons: [] }).level, "unknown");
});
test("Passy Îles and Cavettaz have distinct verified IDs and locations", () => {
  assert.equal(BATHING_SITES[0].id, "074003360");
  assert.equal(BATHING_SITES[1].id, "074003361");
  assert.notEqual(BATHING_SITES[0].lat, BATHING_SITES[1].lat);
  assert.equal(new Set(BATHING_SITES.map((s) => s.euId)).size, 6);
});
test("bounds concurrency, keeps partial successes and does not timestamp failed retrievals", async () => {
  let pending = 0, maximum = 0, calls = 0;
  const data = await loadBathingWater(async (url, options) => {
    calls++; maximum = Math.max(maximum, ++pending);
    const params = new URL(url).searchParams;
    const site = BATHING_SITES.find((s) => s.id === params.get("isite"));
    const year = Number(params.get("annee"));
    assert.ok(options.signal);
    await new Promise((resolve) => setTimeout(resolve, 1)); pending--;
    if (site.id === "074003361" && year === 2026) throw new Error("timeout");
    return new Response(page(site, year));
  }, new Date("2026-09-08"));
  assert.equal(calls, 6);
  assert.deepEqual(data.points.map(p=>p.id), ['074003360','074003361','074003362']);
  assert.equal(maximum, 3);
  assert.equal(data.points[0].seasons[0].samples.length, 2);
  assert.ok(data.points[1].seasons[0].error);
  assert.equal(data.points[1].seasons[0].fetchedAt, null);
  assert.equal(data.points[1].seasons[1].samples.length, 2);
});

test("accepts a slow valid page beyond the old 15-second request budget", async (t) => {
  t.mock.method(AbortSignal, "timeout", (ms) => {
    const controller = new AbortController();
    // Model the observed 18-second response without making the test sleep.
    if (ms < 18000) queueMicrotask(() => controller.abort(new DOMException("Request timeout", "TimeoutError")));
    return controller.signal;
  });
  const data = await loadBathingWater(async (url, { signal }) => {
    await Promise.resolve(); signal.throwIfAborted();
    const params = new URL(url).searchParams;
    return new Response(page(BATHING_SITES.find(s => s.id === params.get("isite")), Number(params.get("annee"))));
  }, new Date("2026-09-24"));
  assert.ok(data.points.every(p => p.seasons.every(s => !s.error && s.samples.length === 2)));
});

test("retries transient HTTP failures but never retries invalid site identity", async () => {
  const attempts = new Map();
  const data = await loadBathingWater(async (url) => {
    const count = (attempts.get(url) ?? 0) + 1; attempts.set(url, count);
    if (count === 1) return new Response("Temporary failure", { status: 503 });
    const params = new URL(url).searchParams;
    return new Response(page(BATHING_SITES.find(s => s.id === params.get("isite")), Number(params.get("annee"))));
  }, new Date("2026-09-24"));
  assert.ok(data.points.every(p => p.seasons.every(s => !s.error && s.samples.length === 2)));
  assert.ok([...attempts.values()].every(n => n === 2));
  let calls = 0;
  const invalid = await loadBathingWater(async () => { calls++; return new Response("Wrong site"); }, new Date("2026-09-24"));
  assert.equal(calls, 6);
  assert.ok(invalid.points.every(p => p.seasons.every(s => s.error)));
});
