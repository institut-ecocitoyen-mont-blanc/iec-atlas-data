import { rows, type Row } from "./environmental-layers.ts";
import { groundwaterAnalysisUrl, groundwaterCatalogueUrl, parseGroundwaterAnalyses, parseGroundwaterStations, type GroundwaterCatalogue, type GroundwaterStation } from "./groundwater.ts";

async function withAvailableAnalyses(stations: GroundwaterStation[], fetcher: typeof fetch): Promise<GroundwaterCatalogue> {
  const signal = AbortSignal.timeout(25000);
  const available = new Set<string>();
  let cursor = 0, unavailable = 0;
  // Check one real analysis per point at build time, never fan out from the visitor's browser.
  // Catalogue dates alone are unreliable: some dated points have no accessible analyses.
  await Promise.all(Array.from({ length: Math.min(4, stations.length) }, async () => {
    while (cursor < stations.length) {
      const station = stations[cursor++];
      try {
        signal.throwIfAborted();
        const url = new URL(groundwaterAnalysisUrl(station.id));
        url.searchParams.set("size", "1");
        const response = await fetcher(url.toString(), { signal, next: { revalidate: 3600 } });
        if (!response.ok) throw new Error(`Hub’Eau ${response.status}`);
        const body = await response.text();
        if (body.length > 20000) throw new Error("Réponse trop volumineuse.");
        const results = parseGroundwaterAnalyses(JSON.parse(body), station);
        if (results.analyses.length) available.add(station.id);
      } catch { unavailable++; }
    }
  }));
  return {
    stations: stations.filter((station) => available.has(station.id)),
    fetchedAt: new Date().toISOString(),
    ...(unavailable ? { error: `La disponibilité des analyses n’a pas pu être vérifiée pour ${unavailable} point(s), non affiché(s). Cela ne signifie pas une absence de données. Nouvelle vérification à la prochaine reconstruction du site.` } : {}),
  };
}

export async function loadGroundwaterCatalogue(fetcher: typeof fetch = fetch): Promise<GroundwaterCatalogue> {
  try {
    const signal = AbortSignal.timeout(25000);
    const records: Row[] = [];
    let expected: number | undefined;
    for (let page = 1; page <= 5; page++) {
      const response = await fetcher(groundwaterCatalogueUrl(page), { signal, next: { revalidate: 3600 } });
      if (!response.ok) throw new Error(`Hub’Eau ${response.status}`);
      const body = await response.text();
      if (body.length > 4_000_000) throw new Error("Catalogue trop volumineux.");
      const data = JSON.parse(body) as Row;
      const current = rows(data);
      if (!Number.isInteger(data.count) || Number(data.count) < 0 || (expected !== undefined && expected !== data.count)) throw new Error("Catalogue incomplet ou modifié.");
      expected = Number(data.count);
      records.push(...current);
      if (!data.next) {
        if (records.length !== expected) throw new Error("Catalogue tronqué.");
        return await withAvailableAnalyses(parseGroundwaterStations(records), fetcher);
      }
      if (!current.length) throw new Error("Pagination vide.");
    }
    throw new Error("Catalogue trop volumineux.");
  } catch { return { stations: [], fetchedAt: null, error: "Le catalogue des eaux souterraines est indisponible. Il sera rechargé à la prochaine reconstruction du site." }; }
}
