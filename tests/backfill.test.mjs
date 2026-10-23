import {test} from 'node:test';
import assert from 'node:assert/strict';
import {geodairTasks, pendingHistoryTasks} from '../scripts/backfill.mjs';
import {parseModelCatalogue} from '../scripts/atmo-model-export.mjs';
import {bathingYears} from '../src/atlas/lib/bathing-water-source.ts';
import {irepArchives} from '../src/atlas/lib/industrial-emissions-source.ts';
import {regionalAirHistory} from '../scripts/history-sources.mjs';
import {pesticideUrl, parsePurchasePage} from '../src/atlas/lib/pesticide-purchases.ts';

test('pesticide history has no 2013 cutoff in the request or parser', () => {
  assert.equal(new URL(pesticideUrl()).searchParams.has('annee_min'), false);
  const result = parsePurchasePage({count:1,next:null,data:[{type_territoire:'Zone postale',code_territoire:'74190',annee:2010,libelle_substance:'Example',quantite:1}]});
  assert.equal(result.rows[0].year,2010);
});

test('Geodair partitions cover every month since documented start, including current month', () => {
  const now = new Date('2026-10-23T12:45:00Z'), tasks = geodairTasks(now);
  const hourly = tasks.filter(t=>t.statistic==='a1');
  assert.equal(hourly.length, 166);
  assert.equal(hourly[0].from, Date.UTC(2013,0,1));
  assert.equal(hourly.at(-1).to, Date.UTC(2026,9,23,12));
  for(let i=1;i<hourly.length;i++) assert.equal(hourly[i].from,hourly[i-1].to);
  assert.equal(new Set(tasks.map(t=>t.key)).size,tasks.length);
  assert.equal(tasks.filter(t=>t.statistic==='01').length,14);
});
test('backfill resumes pending work, does not retry the same hour or let failed jobs block the queue', () => {
  const tasks = ['old','failed','new','geodair-hourly-2013-01'].map(key=>({key,hours:720}));
  const now = Date.parse('2026-10-23T12:45:00Z');
  const datasets={old:{status:'ok',lastAttemptAt:'2026-09-01T00:00:00Z',lastSuccessAt:'2026-09-01T00:00:00Z'},failed:{status:'error',lastAttemptAt:'2026-10-23T12:00:00Z'}};
  assert.deepEqual(pendingHistoryTasks(tasks,datasets,now,false).map(t=>t.key),['new','old']);
  datasets.failed.lastAttemptAt='2026-10-22T12:00:00Z';
  assert.deepEqual(pendingHistoryTasks(tasks,datasets,now,true).map(t=>t.key),['new','geodair-hourly-2013-01','failed','old']);
});
test('discovers all advertised bathing seasons and IREP annual archives', () => {
  assert.deepEqual(bathingYears('<select name="annee"><option value="2026">2026</option><option value="2022">2022</option></select>',2026),[2026,2022]);
  assert.throws(()=>bathingYears('maintenance'));
  const annuel=Object.fromEntries([2003,2024,2025].map(year=>[year,{formatFichier:'zip',lien:`https://files.georisques.fr/irep/${year}.zip`}]));
  assert.deepEqual(irepArchives({annuel},2026).map(x=>x.year),[2025,2024,2003]);
});
test('model catalogue preserves older annual and ozone-period editions without mixing display variants', () => {
  const xml='<WMS_Capabilities><Name>mod_aura_region_2016:mod_aura_2016_no2_moyan</Name><Name>mod_aura_region_2025:mod_aura_2025_o3_nbjdep120_2023_2025</Name><Name>mod_aura_region_2025:mod_aura_2025_pm10_moyan_terristory</Name></WMS_Capabilities>';
  assert.deepEqual(parseModelCatalogue(xml).map(m=>m.year),[2016,2025]);
  assert.throws(()=>parseModelCatalogue('<WMS_Capabilities>'));
});
test('regional air archive preserves all raw rows and refuses truncated pages', async () => {
  const records=[{OBJECTID:1,x_wgs84:6.713611,y_wgs84:45.92361,valeur:null,validite:0},{OBJECTID:2,x_wgs84:6.713611,y_wgs84:45.92361,valeur:0,validite:1}];
  const fetcher=async url=>Response.json(new URL(url).searchParams.has('returnCountOnly')?{count:2}:{features:records.map(attributes=>({attributes})),exceededTransferLimit:false});
  assert.deepEqual((await regionalAirHistory('pm10','daily',4,fetcher)).records,records);
  await assert.rejects(regionalAirHistory('pm10','daily',4,async url=>Response.json(new URL(url).searchParams.has('returnCountOnly')?{count:3}:{features:records.map(attributes=>({attributes})),exceededTransferLimit:false})),/Incomplete/);
});
