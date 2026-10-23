import type { Row } from "./environmental-layers.ts";

type JsonFetcher = (url: string, signal: AbortSignal) => Promise<unknown>;
export type WaterKind = "rivers" | "drinking" | "groundwater";
const endpoints = {
  rivers: ["v2/qualite_rivieres/analyse_pc", "code_station", "date_prelevement", "date_debut_prelevement", "date_fin_prelevement"],
  drinking: ["v1/qualite_eau_potable/resultats_dis", "code_reseau", "date_prelevement", "date_min_prelevement", "date_max_prelevement"],
  groundwater: ["v1/qualite_nappes/analyses", "bss_id", "date_debut_prelevement", "date_debut_prelevement", "date_fin_prelevement"],
} as const;
const DAY = 86400000;
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);

async function historyJson(url: string, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
      if (response.ok) return response.json();
      await response.body?.cancel();
      if (response.status !== 429 && response.status < 500) throw new Error(`Hub’Eau HTTP ${response.status}`);
      if (attempt >= 2) throw new Error(`Hub’Eau HTTP ${response.status}`);
    } catch (error) {
      if (signal.aborted || attempt >= 2 || !(error instanceof TypeError || error instanceof Error && error.name === "TimeoutError")) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 1000 * 2 ** attempt);
      signal.addEventListener('abort', stop, { once: true });
    });
  }
}

function envelope(value: unknown) {
  const v = value as { data?: Row[]; count?: number; next?: unknown } | null;
  if (!v || !Array.isArray(v.data) || !Number.isSafeInteger(v.count) || v.count! < v.data.length || v.data.some(r => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("Invalid Hub’Eau page");
  return { data: v.data, count: v.count!, next: v.next };
}

// The size is a transport page size, never a retention limit. Rebuild a complete
// extract so upstream corrections/deletions are reflected, not append-only duplicates.
// Date partitions avoid Hub’Eau's deep-pagination ceilings. A failed partition
// rejects the whole extract; the publisher retains its last complete version.
export async function loadWaterHistory(kind: WaterKind, id: string, signal: AbortSignal, getJson: JsonFetcher = historyJson) {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid water identifier");
  const [endpoint, identity, dateField, minField, maxField] = endpoints[kind];
  const base = new URL(`https://hubeau.eaufrance.fr/api/${endpoint}`);
  base.search = new URLSearchParams({ [identity]: id, sort: "desc", size: "1000" }).toString();
  function validate(records: Row[], from?: number, to?: number) {
    for (const row of records) {
      const matches = kind === "drinking" ? Array.isArray(row.reseaux) && row.reseaux.some((n: Row) => String(n.code) === id) : String(row[identity]) === id;
      const time = Date.parse(String(row[dateField]));
      if (!matches || !Number.isFinite(time) || from !== undefined && (time < from || time > to! + DAY)) throw new Error("Les analyses ne correspondent pas au point sélectionné ou à la période demandée.");
    }
  }
  async function request(url: URL) { signal.throwIfAborted(); return envelope(await getJson(url.toString(), signal)); }
  const probe = new URL(base); probe.searchParams.set("size", "1");
  const newest = await request(probe); validate(newest.data);
  if (newest.count === 0) { if (newest.next) throw new Error("Invalid empty result"); return []; }
  if (newest.data.length !== 1) throw new Error("Missing newest result");
  probe.searchParams.set("sort", "asc");
  const oldest = await request(probe); validate(oldest.data);
  if (oldest.count !== newest.count || oldest.data.length !== 1) throw new Error("Hub’Eau changed during import");
  const first = Date.parse(String(oldest.data[0][dateField]).slice(0, 10));
  const last = Date.parse(String(newest.data[0][dateField]).slice(0, 10));
  if (last < first) throw new Error("Invalid history bounds");

  async function partition(from: number, to: number): Promise<Row[]> {
    const url = new URL(base);
    url.searchParams.set(minField, isoDay(from));
    // ADES and drinking water truncate times and include midnight on the end date.
    // Request the following day, then exclude that boundary after counting pages.
    url.searchParams.set(maxField, isoDay(to + DAY));
    const firstPage = await request(url);
    if (firstPage.count > 10000) {
      if (from === to) throw new Error("One sampling day exceeds the provider pagination window; refusing truncation");
      const middle = from + Math.floor((to - from) / DAY / 2) * DAY;
      const recent = await partition(middle + DAY, to), earlier = await partition(from, middle);
      return [...recent, ...earlier];
    }
    const all: Row[] = [], seenPages = new Set<string>();
    let page = firstPage, number = 1;
    for (;;) {
      validate(page.data, from, to);
      if (page.count !== firstPage.count || !page.data.length && (page.next || all.length !== page.count)) throw new Error("Changed or empty pagination");
      const fingerprint = JSON.stringify(page.data);
      if (seenPages.has(fingerprint)) throw new Error("Repeated Hub’Eau page");
      seenPages.add(fingerprint); all.push(...page.data);
      if (all.length > page.count) throw new Error("Too many Hub’Eau results");
      if (!page.next) {
        if (all.length !== page.count) throw new Error("Truncated Hub’Eau results");
        return all.filter(row => Date.parse(String(row[dateField])) < to + DAY);
      }
      if (all.length >= page.count) throw new Error("Unexpected next page");
      // Build the next request ourselves, retaining the exact scope and filters.
      url.searchParams.set("page", String(++number));
      page = await request(url);
    }
  }
  const all = await partition(first, last);
  // Check the unbounded count again: new samples during pagination require retry.
  const final = await request(probe);
  if (all.length !== newest.count || final.count !== newest.count) throw new Error("Incomplete or changing history");
  return all.sort((a, b) => Date.parse(String(b[dateField])) - Date.parse(String(a[dateField])) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export async function loadHubeauCatalogue(input: string, signal: AbortSignal, getJson: JsonFetcher = historyJson) {
  const url = new URL(input), records: Row[] = [], seen = new Set<string>();
  let expected: number | undefined;
  for (let number = 1; ; number++) {
    url.searchParams.set('page', String(number));
    const page = envelope(await getJson(url.toString(), signal));
    expected ??= page.count;
    const fingerprint = JSON.stringify(page.data);
    if (page.count !== expected || seen.has(fingerprint)) throw new Error('Unstable catalogue pagination');
    seen.add(fingerprint); records.push(...page.data);
    if (records.length > expected || page.next && (!page.data.length || records.length >= expected)) throw new Error('Invalid catalogue pagination');
    if (!page.next) {
      if (records.length !== expected) throw new Error('Incomplete catalogue');
      return records;
    }
  }
}
