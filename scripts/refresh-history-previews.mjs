// Migration/maintenance: repackage already downloaded histories without querying
// providers. Leaves archive records, semantic hashes and success dates untouched.
import {readJson, writeJson} from './store.mjs';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {acquireImportLock} from './import-lock.mjs';
acquireImportLock();
const manifest=await readJson('public/manifest.json',null);
for(const [key,entry] of Object.entries(manifest.datasets)) {
  if(!entry.path || !/^(river|drinking|groundwater)-/.test(key)) continue;
  const snapshot=await readJson(`public/${entry.path}`,null);
  if(!snapshot?.archive) continue;
  const size=key.startsWith('groundwater-')?200:10, records=[];
  for(const part of snapshot.archive.parts) {
    records.push(...JSON.parse(gunzipSync(await readFile(`public/${part.path}`))));
    if(records.length>=size) break;
  }
  const preview=records.slice(0,size);
  snapshot.data=snapshot.archive.field==='$'?preview:{...snapshot.data,[snapshot.archive.field]:preview,more:snapshot.archive.count>preview.length};
  await writeJson(`public/${entry.path}`,snapshot);
}
