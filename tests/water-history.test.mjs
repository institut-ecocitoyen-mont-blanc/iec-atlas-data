import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWaterHistory } from '../src/atlas/lib/hubeau-history.ts';
import { archiveHistory } from '../scripts/history-archive.mjs';
import { openStore } from '../scripts/store.mjs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const signal = () => AbortSignal.timeout(5000);
function provider(records, mutate = x => x) {
  return async input => {
    const url = new URL(input), p = url.searchParams;
    const filtered = records.filter(r => (!p.has('date_debut_prelevement') || r.date_prelevement >= p.get('date_debut_prelevement')) && (!p.has('date_fin_prelevement') || r.date_prelevement <= p.get('date_fin_prelevement'))).sort((a,b) => p.get('sort') === 'asc' ? a.date_prelevement.localeCompare(b.date_prelevement) : b.date_prelevement.localeCompare(a.date_prelevement));
    const size = +p.get('size'), start = (+(p.get('page') || 1) - 1) * size;
    return mutate({ data: filtered.slice(start, start + size), count: filtered.length, next: start + size < filtered.length ? 'next' : null }, url);
  };
}
const data = Array.from({ length: 1201 }, (_, i) => ({ code_station: '06580009', date_prelevement: i < 600 ? '1991-02-19' : '2026-05-21', code_parametre: String(i), resultat: null, mnemo_remarque: 'Sous le seuil' }));
test('collects all pages and old dates, preserving nulls and qualifiers', async () => {
  const result = await loadWaterHistory('rivers', '06580009', signal(), provider(data));
  assert.equal(result.length, 1201); assert.equal(result.at(-1).date_prelevement, '1991-02-19');
  assert.equal(result[0].resultat, null); assert.equal(result[0].mnemo_remarque, 'Sous le seuil');
});
test('midnight-inclusive end filters preserve midday samples without duplicating partition boundaries', async () => {
  for (const kind of ['groundwater','drinking']) {
    const records=Array.from({length:12001},(_,i)=>({bss_id:'BSS001SGSB',reseaux:[{code:'074001943'}],date_debut_prelevement:i<4000?'2024-01-01T12:00:00Z':i<8000?'2024-01-02T00:00:00Z':'2024-01-03T11:00:00Z',code_param:String(i)}));
    for(const r of records) r.date_prelevement=r.date_debut_prelevement;
    const fetcher=async input=>{
      const p=new URL(input).searchParams;
      const min=p.get(kind==='drinking'?'date_min_prelevement':'date_debut_prelevement');
      const max=p.get(kind==='drinking'?'date_max_prelevement':'date_fin_prelevement');
      // Reproduce the real providers: ignore time components on query bounds.
      const filtered=records.filter(r=>(!min||Date.parse(r.date_prelevement)>=Date.parse(min.slice(0,10)))&&(!max||Date.parse(r.date_prelevement)<=Date.parse(max.slice(0,10)))).sort((a,b)=>p.get('sort')==='asc'?a.date_prelevement.localeCompare(b.date_prelevement):b.date_prelevement.localeCompare(a.date_prelevement));
      const size=+p.get('size'), start=(+(p.get('page')||1)-1)*size;
      return{data:filtered.slice(start,start+size),count:filtered.length,next:start+size<filtered.length?'next':null};
    };
    const result=await loadWaterHistory(kind,kind==='drinking'?'074001943':'BSS001SGSB',signal(),fetcher);
    assert.equal(result.length,12001); assert.equal(new Set(result.map(r=>r.code_param)).size,12001);
    assert.equal(result[0].date_prelevement,'2024-01-03T11:00:00Z');
  }
});
test('recursively partitions histories beyond deep pagination limits without losing same-day rows', async () => {
  const large = Array.from({length: 12001}, (_, i) => ({ ...data[i % data.length], code_parametre: String(i) }));
  const result = await loadWaterHistory('rivers', '06580009', signal(), provider(large));
  assert.equal(result.length, large.length); assert.equal(new Set(result.map(r => r.code_parametre)).size, large.length);
});
test('rejects wrong sites, truncated pages, repeated pages and changing totals', async () => {
  for (const mutate of [
    page => ({...page, data: page.data.map(r => ({...r, code_station: 'wrong'}))}),
    (page, url) => url.searchParams.get('size') === '1000' ? {...page, next: null} : page,
    (page, url) => url.searchParams.get('page') === '2' ? {...page, count: page.count + 1} : page,
    (page, url) => url.searchParams.get('page') === '2' ? {...page, data: []} : page,
  ]) await assert.rejects(loadWaterHistory('rivers', '06580009', signal(), provider(data, mutate)));
});
test('archives every result in immutable gzip chunks and leaves a compatible preview', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-history-test-'));
  const payload = await archiveHistory(dir, 'river-test', data, '$');
  assert.equal(payload.data.length, 10); assert.equal(payload.archive.count, data.length);
  const restored = (await Promise.all(payload.archive.parts.map(async p => JSON.parse(gunzipSync(await readFile(join(dir, p.path))))))).flat();
  assert.deepEqual(restored, data);
});
test('failed backfill cannot replace a published complete history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-history-store-'));
  const store = await openStore(dir);
  await store.update('river-test', 'source', 24, async () => data, () => {}, '$');
  const before = await readFile(join(dir, 'data/river-test.json'), 'utf8');
  await store.update('river-test', 'source', 24, async () => { throw new Error('page failed'); }, () => {}, '$');
  assert.equal(await readFile(join(dir, 'data/river-test.json'), 'utf8'), before);
  assert.equal(store.manifest.datasets['river-test'].status, 'error');
});
test('new current-year measurements do not rewrite older-year archive chunks', async () => {
  const dir=await mkdtemp(join(tmpdir(),'atlas-year-chunks-'));
  const old=[{date:'2026-01-01',value:1},...Array.from({length:1100},(_,i)=>({date:'2025-01-01',value:i}))];
  const before=await archiveHistory(dir,'river-test',old,'$');
  const after=await archiveHistory(dir,'river-test',[{date:'2026-02-01',value:2},...old],'$');
  assert.deepEqual(before.archive.parts.slice(1),after.archive.parts.slice(1));
});
