import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Immutable, compressed chunks keep complete local histories below GitHub's
// per-file limit. Small .data previews remain compatible with older websites.
export async function archiveHistory(directory, key, data, field) {
  const records = field === '$' ? data : data[field];
  if (!Array.isArray(records)) throw new Error('Invalid history records');
  const parts = [];
  await mkdir(join(directory, 'history', key), { recursive: true });
  const yearOf = row => {
    const date = row.date_prelevement ?? row.date_debut_prelevement ?? row.date ?? row.date_debut ?? row['Date de début'] ?? row.properties?.date_ech;
    return typeof date === 'number' && Number.isFinite(date) ? new Date(date).getUTCFullYear() : String(date ?? '').match(/^\d{4}/)?.[0] ?? 'undated';
  };
  for (let offset = 0; offset < records.length;) {
    const year = yearOf(records[offset]);
    let end = offset + 1;
    while (end < records.length && end - offset < 1000 && yearOf(records[end]) === year) end++;
    const rows = records.slice(offset, end); offset = end;
    const bytes = gzipSync(JSON.stringify(rows), { level: 9 });
    const hash = createHash('sha256').update(bytes).digest('hex');
    const path = `history/${key}/${hash}.json.gz`;
    try { await writeFile(join(directory, path), bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    parts.push({ path, hash, count: rows.length });
  }
  const previewSize = key.startsWith('groundwater-') ? 200 : /^(river|drinking)-/.test(key) ? 10 : 100;
  const preview = records.slice(0, previewSize);
  return {
    data: field === '$' ? preview : { ...data, [field]: preview, ...('more' in data ? { more: records.length > preview.length } : {}) },
    archive: { version: 1, complete: true, field, count: records.length, parts },
  };
}

export async function retainRevision(directory, key, hash, snapshot) {
  const { readFile, rename } = await import('node:fs/promises');
  const dir = join(directory, 'revisions', key);
  await mkdir(dir, { recursive: true });
  const path = `revisions/${key}/${hash}.json.gz`;
  try { await writeFile(join(directory, path), gzipSync(JSON.stringify(snapshot), {level: 9}), {flag: 'wx'}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const indexPath = join(dir, 'index.json');
  let versions = [];
  try { versions = JSON.parse(await readFile(indexPath, 'utf8')).versions; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!versions.some(v => v.hash === hash)) {
    versions.push({ hash, path, archivedAt: new Date().toISOString() });
    await writeFile(`${indexPath}.tmp`, JSON.stringify({key, versions}));
    await rename(`${indexPath}.tmp`, indexPath);
  }
}
