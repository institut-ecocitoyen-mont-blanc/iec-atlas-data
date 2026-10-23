import { openStore, readJson, writeJson, isDue } from './store.mjs';
import { loadIrepCatalogue, loadIrepYear, IREP_CATALOGUE_URL } from '../src/atlas/lib/industrial-emissions-source.ts';
import { loadGeodairArchive } from '../src/atlas/lib/geodair-source.ts';
import { GEODAIR_SOURCE } from '../src/atlas/lib/geodair.ts';
import { ATMO_INDEX_WFS } from '../src/atlas/lib/atmo-index-source.ts';
import { regionalAirCatalogue, regionalAirHistory, atmoIndexHistory } from './history-sources.mjs';
import { loadModelCatalogue, loadHistoricalModel, MODEL_CATALOGUE } from './atmo-model-export.mjs';
import { createHash } from 'node:crypto';
import { acquireImportLock } from './import-lock.mjs';

// A job budget limits work per CI run, not the history retained. The durable
// catalogue lists all pending partitions; subsequent runs resume the oldest work.
export function geodairTasks(now = new Date()) {
  const tasks = [], end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  for (let year = 2013; year <= now.getUTCFullYear(); year++) {
    for (let month = 0; month < 12; month++) {
      const from = Date.UTC(year, month, 1), to = Date.UTC(year, month + 1, 1);
      if (to > end) continue;
      tasks.push({ key: `geodair-hourly-${year}-${String(month + 1).padStart(2, '0')}`, from, to, statistic: 'a1' });
    }
    if (year < now.getUTCFullYear()) for (const [label, statistic] of [['annual','a7'], ['samples','01']]) tasks.push({ key: `geodair-${label}-${year}`, from: Date.UTC(year,0,1), to: Date.UTC(year+1,0,1), statistic });
  }
  // The current month/year are distinct refreshable partitions, never pretend
  // they are complete future periods. Use the last complete UTC hour.
  const to = Math.floor(now.getTime() / 3600000) * 3600000;
  if (to > end) tasks.push({ key: `geodair-hourly-${now.toISOString().slice(0,7)}`, from: end, to, statistic: 'a1' });
  tasks.push({ key: `geodair-samples-${now.getUTCFullYear()}`, from: Date.UTC(now.getUTCFullYear(),0,1), to, statistic: '01' });
  return tasks;
}

export function pendingHistoryTasks(tasks, datasets, now, hasGeodairKey) {
  return tasks.filter(t => (!t.key.startsWith('geodair-') || hasGeodairKey) && isDue(datasets[t.key], t.hours, now)).sort((a,b) => {
    const aa = datasets[a.key], bb = datasets[b.key];
    return Number(!!aa?.lastSuccessAt) - Number(!!bb?.lastSuccessAt) || (aa?.lastAttemptAt || '').localeCompare(bb?.lastAttemptAt || '');
  });
}

export async function backfill({ directory = 'public', budget = Number(process.env.HISTORY_TASK_BUDGET || 8), now = new Date() } = {}) {
  if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Invalid backfill budget');
  const store = await openStore(directory), tasks = [], discoveries = [];
  const add = (key, source, loader, field, hours = 720) => tasks.push({ key, source, loader, field, hours });
  add('atmo-index-history', ATMO_INDEX_WFS, () => atmoIndexHistory(), 'records');
  for (const t of geodairTasks(now)) add(t.key, GEODAIR_SOURCE, () => loadGeodairArchive(process.env.GEODAIR_API_KEY, t.from, t.to, t.statistic), 'records', t.to >= Date.UTC(now.getUTCFullYear(),0,1) ? 24 : 720);

  // Cache discovery separately: an unavailable catalogue never hides old jobs.
  const cachePath = `${directory}/history-catalogue.json`;
  const old = await readJson(cachePath, { discoveries: [], tasks: [] });
  let air = old.discoveries.find(d => d.source === 'regional-air')?.items ?? [];
  try { air = await regionalAirCatalogue(); discoveries.push({source:'regional-air',status:'ok',checkedAt:now.toISOString(),items:air}); }
  catch { discoveries.push({source:'regional-air',status:'error',checkedAt:now.toISOString(),items:air}); }
  for (const t of air) add(`air-${t.pollutant.replaceAll('_','-')}-${t.period}-history`, t.service, () => regionalAirHistory(t.pollutant,t.period,t.layer), 'records');
  let irep = old.discoveries.find(d => d.source === 'irep')?.items ?? [];
  try { irep = await loadIrepCatalogue(); discoveries.push({ source: 'irep', status: 'ok', checkedAt: now.toISOString(), items: irep }); }
  catch { discoveries.push({ source: 'irep', status: 'error', checkedAt: now.toISOString(), items: irep }); }
  for (const { year, url } of irep) add(`emissions-${year}`, url, () => loadIrepYear(year));
  let models = old.discoveries.find(d => d.source === 'atmo-models')?.items ?? [];
  try { models = await loadModelCatalogue(); discoveries.push({ source:'atmo-models', status:'ok', checkedAt:now.toISOString(), items:models }); }
  catch { discoveries.push({ source:'atmo-models', status:'error', checkedAt:now.toISOString(), items:models }); }
  for (const model of models) add(`atmo-model-history-${model.year}-${createHash('sha256').update(model.layer).digest('hex').slice(0,12)}`, MODEL_CATALOGUE, () => loadHistoricalModel(model));

  const eligible = pendingHistoryTasks(tasks, store.manifest.datasets, now.getTime(), !!process.env.GEODAIR_API_KEY);
  for (const t of eligible.slice(0, budget)) await store.update(t.key, t.source, t.hours, t.loader, data => {
    if (!data || data.error) throw new Error('Incomplete history');
    if (t.field && !Array.isArray(data[t.field])) throw new Error('Invalid history');
  }, t.field);
  const coverage = tasks.map(({ key, source }) => ({ key, source, status: !process.env.GEODAIR_API_KEY && key.startsWith('geodair-') ? 'credentials-required' : store.manifest.datasets[key]?.status ?? 'pending', lastSuccessAt: store.manifest.datasets[key]?.lastSuccessAt ?? null }));
  await writeJson(cachePath, { checkedAt: now.toISOString(), discoveries, tasks: coverage, pending: coverage.filter(t => !t.lastSuccessAt).length, failed: coverage.filter(t => t.status === 'error').length });
  console.log(`History: ${coverage.filter(t => t.lastSuccessAt).length}/${coverage.length} partitions available; pending partitions will resume next run.`);
  return (await store.save()) + discoveries.filter(d => d.status === 'error').length;
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  acquireImportLock();
  const upstream = globalThis.fetch, deadline = AbortSignal.timeout(20 * 60000);
  globalThis.fetch = (url, init = {}) => upstream(url, {...init,signal:AbortSignal.any([deadline,...(init.signal?[init.signal]:[])])});
  process.exitCode = await backfill() ? 1 : 0;
}
