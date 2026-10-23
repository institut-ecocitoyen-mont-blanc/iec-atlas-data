import { atmoIndexUrl } from '../src/atlas/lib/atmo-index-source.ts';
import { ATMO_SERVICE, ATMO_DAILY_SERVICE } from '../src/atlas/lib/atmo-stations.ts';
import { AREA } from '../src/atlas/lib/environmental-layers.ts';
import { insideCcpmb } from '../src/atlas/lib/ccpmb-territory.ts';

export async function regionalAirCatalogue(fetcher = fetch) {
  const tasks = [];
  for (const [period, service] of [['hourly', ATMO_SERVICE], ['daily', ATMO_DAILY_SERVICE]]) {
    const response = await fetcher(`${service}?f=json`, {signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error('Air catalogue unavailable');
    const json = await response.json();
    if (!Array.isArray(json.layers) || !json.layers.length) throw new Error('Air catalogue incomplete');
    for (const layer of json.layers) {
      const match = /^mes_aura_(?:horaire|journalier)_([a-z0-9_]+)$/.exec(layer.name);
      if (!match || !Number.isSafeInteger(layer.id)) throw new Error('Unknown air layer');
      tasks.push({period, service, pollutant:match[1], layer:layer.id});
    }
  }
  return tasks;
}

export async function regionalAirHistory(pollutant, period, layer, fetcher = fetch) {
  if (!Number.isSafeInteger(layer) || layer < 0) throw new Error('Invalid air layer');
  const makeUrl = offset => {
    const url = new URL(`${period === 'hourly' ? ATMO_SERVICE : ATMO_DAILY_SERVICE}/${layer}/query`);
    url.search = new URLSearchParams({ f:'json', where:`x_wgs84>=${AREA.west} AND x_wgs84<=${AREA.east} AND y_wgs84>=${AREA.south} AND y_wgs84<=${AREA.north}`, outFields:'*', orderByFields:'date_debut DESC,OBJECTID ASC', resultRecordCount:'2000', resultOffset:String(offset), returnGeometry:'false' }).toString();
    return url;
  };
  const seen = new Set(), records = [];
  const signal = AbortSignal.timeout(600000);
  const countUrl = makeUrl(0); countUrl.searchParams.set('returnCountOnly','true');
  const countResponse = await fetcher(countUrl, {signal});
  if (!countResponse.ok) throw new Error('Air history count unavailable');
  const {count} = await countResponse.json();
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid air history count');
  for (let offset = 0; ; ) {
    const url = makeUrl(offset); url.searchParams.set('outFields', '*');
    const response = await fetcher(url, { signal });
    if (!response.ok) throw new Error('Atmo history unavailable');
    const data = await response.json();
    if (data.error || !Array.isArray(data.features)) throw new Error('Invalid Atmo history');
    for (const feature of data.features) {
      const r = feature.attributes;
      if (!r || r.OBJECTID == null || seen.has(r.OBJECTID)) throw new Error('Repeated or invalid Atmo page');
      seen.add(r.OBJECTID);
      if (insideCcpmb(r.y_wgs84, r.x_wgs84)) records.push(r);
    }
    offset += data.features.length;
    if (!data.exceededTransferLimit) {
      if (offset !== count) throw new Error('Incomplete air history');
      return { records, period, pollutant };
    }
    if (!data.features.length) throw new Error('Empty Atmo history page');
  }
}

export async function atmoIndexHistory(fetcher = fetch) {
  const base = new URL(atmoIndexUrl());
  base.searchParams.set('CQL_FILTER', base.searchParams.get('CQL_FILTER').split(' AND date_ech')[0]);
  base.searchParams.delete('propertyName');
  const records = [], seen = new Set(); let expected;
  const signal = AbortSignal.timeout(600000);
  for (let start = 0; ; ) {
    base.searchParams.set('startIndex', String(start));
    const response = await fetcher(base, { signal });
    if (!response.ok) throw new Error('Atmo index history unavailable');
    const value = await response.json();
    if (!Array.isArray(value.features) || !Number.isSafeInteger(value.numberMatched) || value.numberReturned !== value.features.length) throw new Error('Invalid Atmo index history');
    expected ??= value.numberMatched;
    if (value.numberMatched !== expected) throw new Error('Atmo index history changed');
    for (const f of value.features) {
      if (!f.id || seen.has(f.id)) throw new Error('Repeated Atmo index page');
      seen.add(f.id); records.push(f);
    }
    start += value.features.length;
    if (start === expected) return { records };
    if (start > expected || !value.features.length) throw new Error('Truncated Atmo index history');
  }
}
