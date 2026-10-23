import { openSync, readFileSync, writeFileSync, closeSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';

// The CI concurrency group covers remote runs; this covers local imports too.
export function acquireImportLock(path = '.import.lock') {
  try {
    const old = JSON.parse(readFileSync(path, 'utf8'));
    if (old.host !== hostname()) throw new Error('Another host owns the import lock');
    try { process.kill(old.pid, 0); throw new Error('Another atlas importer is running'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    unlinkSync(path);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const fd = openSync(path, 'wx');
  writeFileSync(fd, JSON.stringify({pid:process.pid,host:hostname()})); closeSync(fd);
  const release = () => { try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
  process.once('exit', release);
  process.once('SIGTERM', () => process.exit(143));
  process.once('SIGINT', () => process.exit(130));
}
