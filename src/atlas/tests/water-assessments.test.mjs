import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRiverCsv, loadRiverAssessments } from '../lib/river-assessments-source.ts';
import { riverQuality, riverChemicalLabel } from '../lib/river-assessments.ts';
import { groupNetworkCatalog, networkQuality, summarizeNetworks, loadDrinkingSummaries } from '../lib/drinking-networks.ts';

const header = 'numero_station;annee;nature_MDO;ECO;POTENTIEL_ECOLO;CHIM;DECLASS_CHIM';
test('river import preserves exact IDs, newest year, potential and chemical assessment separately', () => {
  const data = parseRiverCsv('\uFEFF' + header + '\r\n06061000;2025;MEFM;;BE;BE;\r\n06061000;2026;MEFM;;MOY;MAUV;"A; B"\r\n06000001;;;;;;\r\n', 2026);
  assert.deepEqual(Object.keys(data), ['06061000']);
  assert.equal(data['06061000'].chemicalDowngraders, 'A; B');
  const q = riverQuality(data['06061000']);
  assert.equal(q.level, 'moderate');
  assert.equal(q.period, '2026');
  assert.match(q.label, /Potentiel/);
  assert.equal(riverChemicalLabel(data['06061000']), 'Bon état chimique non atteint');
  assert.equal(riverQuality(data['6061000']).level, 'unknown', 'Never fuzzy-match a station ID');
});
test('river colour simplifies only ecological classes; never borrows chemical or older green', () => {
  for (const [ecological, level] of [['TBE','good'],['BE','good'],['MOY','moderate'],['MED','poor'],['MAUV','poor'],['Ind','unknown'],['?','unknown'],['','unknown']]) {
    assert.equal(riverQuality({ nature:'MEN', ecological, chemical:'BE', year:2026 }).level, level);
  }
  const data = parseRiverCsv(header + '\n06061000;2026;MEN;Ind;;BE;\n06061000;2025;MEN;BE;;BE;', 2026);
  assert.equal(riverQuality(data['06061000']).level, 'unknown');
  assert.equal(riverQuality({ nature:'MEFM', ecological:'BE', potential:'', year:2026 }).level, 'unknown');
});
test('invalid and unavailable river exports fail closed without invented classes', async () => {
  for (const csv of ['<html>error</html>', header + '\n6061000;2026;MEN;BE;;BE;', header + '\n06061000;2027;MEN;BE;;BE;', header + '\n06061000;2026;MEN;BE;', header + '\n06061000;2026;MEN;BE;;BE;"unfinished']) assert.throws(() => parseRiverCsv(csv, 2026));
  const data = await loadRiverAssessments(async () => new Response('bad', { status:503 }));
  assert.deepEqual(data.stations, {});
  assert.ok(data.error);
});

const id = '074002403', id2 = '074002404';
const catalogRow = (network = id, extra = {}) => ({ code_commune:'74208', code_reseau:network, nom_reseau:network, annee:2026, ...extra });
const now = Date.parse('2026-09-09T12:00:00Z');
const sample = (network = id, extra = {}) => ({ reseaux:[{code:network,nom:network}], date_prelevement:'2026-04-27T12:00:00Z', conformite_limites_bact_prelevement:'C', conformite_limites_pc_prelevement:'C', conformite_references_bact_prelevement:'C', conformite_references_pc_prelevement:'C', ...extra });
const summary = (level) => ({ id, name:id, quality:{level} });
test('network catalogue selects latest year per commune, deduplicates quarters, keeps shared networks', () => {
  const grouped = groupNetworkCatalog([catalogRow(id2, {annee:2025}), catalogRow(), catalogRow(), catalogRow(id2), catalogRow(id, {code_commune:'74256'})]);
  assert.equal(grouped['74208'].year, 2026);
  assert.deepEqual(grouped['74208'].networks.map((n) => n.id), [id,id2]);
  assert.deepEqual(grouped['74256'].networks.map((n) => n.id), [id]);
  assert.throws(() => groupNetworkCatalog([catalogRow('', {annee:null})]));
});
test('network flags retain historical assessment but reject foreign samples; partial coverage cannot be green', () => {
  assert.equal(networkQuality(sample(), id, now).level, 'good');
  assert.equal(networkQuality(sample(), id, now).historical, true);
  assert.equal(networkQuality(sample(), id2, now).level, 'unknown');
  assert.equal(summarizeNetworks([]).level, 'unknown');
  assert.equal(summarizeNetworks([summary('good'),summary('unknown')]).level, 'unknown');
  assert.equal(summarizeNetworks([summary('good'),summary('good')]).level, 'good');
  assert.equal(summarizeNetworks([summary('poor'),summary('unknown')]).level, 'poor');
  assert.equal(summarizeNetworks([summary('moderate'),summary('unknown')]).level, 'moderate');
  assert.match(summarizeNetworks([summary('poor'),summary('unknown')]).detail, /1\/2/);
});
test('network loader follows catalogue pagination, deduplicates shared requests and scopes by network', async () => {
  const published = {}, requests = [], controller = new AbortController();
  await loadDrinkingSummaries(['74208','74256'], controller.signal, (id, s) => { published[id] = s; }, async (raw) => {
    const url = new URL(raw); requests.push(url);
    if (url.pathname.endsWith('communes_udi')) return url.searchParams.get('page') === '1' ? { data:[catalogRow(),catalogRow(id, {code_commune:'74256'})],next:'ignored-provider-url' } : {data:[catalogRow(id2)],next:null};
    assert.equal(url.searchParams.has('code_commune'), false);
    return {data:[sample(url.searchParams.get('code_reseau'))]};
  });
  assert.equal(requests.length, 4);
  assert.equal(published['74208'].networks.length, 2);
  assert.equal(published['74256'].networks.length, 1);
  assert.equal(published['74208'].quality.level, 'good');
});
test('network loader bounds concurrency, aborts without publication and isolates unavailable samples', async () => {
  const data = Array.from({length:9}, (_, i) => catalogRow(`07400240${i}`));
  let active = 0, peak = 0;
  const result = {};
  await loadDrinkingSummaries(['74208'], new AbortController().signal, (id,s) => {result[id]=s;}, async (raw) => {
    const url = new URL(raw);
    if (url.pathname.endsWith('communes_udi')) return {data};
    active++; peak = Math.max(peak,active);
    await new Promise((r) => setTimeout(r,2)); active--;
    if (url.searchParams.get('code_reseau') === '074002400') throw new Error('offline');
    return {data:[sample(url.searchParams.get('code_reseau'))]};
  });
  assert.ok(peak <= 4 && peak > 1);
  assert.equal(result['74208'].quality.level, 'unknown');
  const abort = new AbortController(); let calls = 0;
  await loadDrinkingSummaries(['74208'], abort.signal, () => calls++, async () => {abort.abort();return {data};});
  assert.equal(calls, 0);
});
