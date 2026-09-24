import { analysisUrl, asText, fetchJson, rows, type Row } from "./environmental-layers.ts";
import { drinkingQuality, unknownQuality, type Quality } from "./environmental-quality.ts";

export interface DrinkingNetwork { id: string; name: string }
export interface NetworkCatalog { year: number; networks: DrinkingNetwork[] }
export interface NetworkSummary extends DrinkingNetwork { quality: Quality; sample?: Row }
export interface DrinkingSummary { quality: Quality; year?: number; networks: NetworkSummary[] }

// Only the newest published catalogue year per commune: do not mix former
// networks into today's coverage. Preserve shared network IDs across communes.
export function groupNetworkCatalog(data: Row[]): Record<string, NetworkCatalog> {
  const result: Record<string, NetworkCatalog> = {};
  for (const row of data) {
    const commune = asText(row.code_commune), id = asText(row.code_reseau), year = Number(row.annee);
    if (!/^\d{5}$/.test(commune) || !/^\d{9}$/.test(id) || !Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear()) throw new Error("Catalogue de réseaux invalide.");
    if (!result[commune] || result[commune].year < year) result[commune] = { year, networks: [] };
    if (result[commune].year !== year || result[commune].networks.some((network) => network.id === id)) continue;
    result[commune].networks.push({ id, name: asText(row.nom_reseau) || id });
  }
  return result;
}

export function networkQuality(sample: Row | undefined, id: string, now = Date.now()): Quality {
  if (sample && (!Array.isArray(sample.reseaux) || !sample.reseaux.some((network: Row) => asText(network.code) === id))) return unknownQuality("Le prélèvement retourné ne correspond pas au réseau demandé.");
  return drinkingQuality(sample, now);
}

export function summarizeNetworks(networks: NetworkSummary[]): Quality {
  if (!networks.length) return unknownQuality("Aucun réseau disponible dans le catalogue pour cette commune.");
  const classified = networks.filter((network) => network.quality.level !== "unknown");
  const poor = classified.some((n) => n.quality.level === "poor"), moderate = classified.some((n) => n.quality.level === "moderate");
  const complete = classified.length === networks.length;
  const level = poor ? "poor" : moderate ? "moderate" : complete ? "good" : "unknown";
  const label = poor ? "Limite non respectée sur au moins un réseau" : moderate ? "Dérogation ou référence non respectée sur au moins un réseau" : complete ? "Derniers prélèvements conformes sur les réseaux recensés" : "Couverture insuffisante pour conclure";
  return { level, label, historical: networks.some((n) => n.quality.historical), detail: `${classified.length}/${networks.length} réseaux avec une conclusion exploitable. Synthèse des derniers prélèvements par réseau, à des dates différentes : consultez chaque fiche. Ce repère communal n’est ni un lieu de prélèvement ni une garantie de potabilité actuelle.` };
}

type JsonFetcher = (url: string, signal: AbortSignal) => Promise<unknown>;
export async function loadDrinkingSummaries(communeIds: string[], signal: AbortSignal, publish: (id: string, summary: DrinkingSummary) => void, getJson: JsonFetcher = fetchJson) {
  const catalogs: Record<string, NetworkCatalog> = {};
  for (let offset = 0; offset < communeIds.length && !signal.aborted; offset += 20) {
    const batch = communeIds.slice(offset, offset + 20);
    try {
      const data: Row[] = [];
      for (let page = 1; ; page++) {
        if (page > 20) throw new Error("Catalogue incomplet.");
        const url = new URL("https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/communes_udi");
        url.search = new URLSearchParams({ code_commune: batch.join(","), size: "1000", sort: "desc", page: String(page) }).toString();
        const response = await getJson(url.toString(), signal);
        data.push(...rows(response));
        if (!(response as Row).next) break;
      }
      const grouped = groupNetworkCatalog(data);
      for (const id of batch) if (grouped[id]) catalogs[id] = grouped[id];
    } catch {
      if (!signal.aborted) for (const id of batch) publish(id, { quality: unknownQuality("Catalogue des réseaux indisponible ou incomplet. Actualisez la couche pour réessayer."), networks: [] });
      continue;
    }
    if (!signal.aborted) for (const id of batch) publish(id, { year: catalogs[id]?.year, networks: (catalogs[id]?.networks ?? []).map((n) => ({ ...n, quality: unknownQuality("Chargement du dernier prélèvement…") })), quality: unknownQuality(catalogs[id] ? "Chargement des conclusions par réseau…" : "Aucun réseau recensé pour cette commune.") });
  }
  const unique = [...new Map(Object.values(catalogs).flatMap((c) => c.networks).map((n) => [n.id, n])).values()];
  const summaries = new Map<string, NetworkSummary>();
  let cursor = 0;
  const worker = async () => {
    while (!signal.aborted && cursor < unique.length) {
      const network = unique[cursor++];
      let summary: NetworkSummary;
      try {
        const url = new URL(analysisUrl("drinking", network.id));
        url.searchParams.set("size", "1");
        const [sample] = rows(await getJson(url.toString(), signal));
        const quality = networkQuality(sample, network.id);
        summary = { ...network, quality, sample: Array.isArray(sample?.reseaux) && sample.reseaux.some((n: Row) => asText(n.code) === network.id) ? sample : undefined };
      } catch { summary = { ...network, quality: unknownQuality("Conclusion indisponible. Actualisez la couche pour réessayer.") }; }
      if (signal.aborted) return;
      summaries.set(network.id, summary);
      for (const [id, catalog] of Object.entries(catalogs)) {
        if (!catalog.networks.some((n) => n.id === network.id)) continue;
        const networks = catalog.networks.map((n) => summaries.get(n.id) ?? { ...n, quality: unknownQuality("Chargement du dernier prélèvement…") });
        publish(id, { year: catalog.year, networks, quality: summarizeNetworks(networks) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
}
