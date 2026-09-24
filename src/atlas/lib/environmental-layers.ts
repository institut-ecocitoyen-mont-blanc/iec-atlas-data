import { INSTITUTE_DEMO_SOURCE } from "./institute-demo.ts";
import { insideCcpmb } from "./ccpmb-territory.ts";
// Broad provider query envelope only; displayed data use the commune polygons.
export const AREA = { west: 6.45, south: 45.7, east: 7.1, north: 46.1 };
export type LayerId = "inventory" | "atmo" | "rivers" | "drinking" | "bathing" | "wood" | "traffic";
export type RemoteLayerId = Exclude<LayerId, "inventory" | "wood" | "atmo" | "bathing" | "traffic">;
export type Row = Record<string, unknown>;
export interface LayerPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  properties: Row;
}
export const LAYERS: { id: LayerId; title: string; source: string; url?: string; description: string; color: string }[] = [
  { id: "inventory", title: "Sources de pollution", source: "Inventaire écocitoyen", url: "/carte", description: "Les sites de l’inventaire participatif, avec leurs secteurs d’activité.", color: "#1d6ab2" },
  { id: "traffic", title: "Trafic routier annuel", source: "DDT de Haute-Savoie", url: "https://www.data.gouv.fr/datasets/trafic-routier-en-haute-savoie", description: "Tronçons des routes sélectionnées limités aux 10 communes de la CCPMB, colorés par le nombre moyen de véhicules par jour sur l’année.", color: "#ea580c" },
  { id: "wood", title: "Chauffage résidentiel", source: INSTITUTE_DEMO_SOURCE, description: "Préfiguration d’un suivi de l’Institut écocitoyen. Carte de chaleur entièrement simulée, pas des mesures de l’Institut. Les zones et intensités sont inventées : ni mesures, ni émissions estimées, ni seuils sanitaires.", color: "#f52222" },
  { id: "atmo", title: "Particules et gaz", source: "Atmo Auvergne-Rhône-Alpes", url: "https://www.atmo-auvergnerhonealpes.fr/dataviz/mesures-aux-stations", description: "Stations aux coordonnées publiées par Atmo : concentrations horaires par polluant, dates et historique.", color: "#8b5cf6" },
  { id: "rivers", title: "Qualité des cours d’eau", source: "Agence de l’eau · Hub’Eau · Naïades", url: "https://hubeau.eaufrance.fr/page/api-qualite-cours-deau", description: "État ou potentiel écologique officiel à la station, et analyses physico-chimiques disponibles.", color: "#0891b2" },
  { id: "bathing", title: "Eaux de baignade · ARS", source: "Ministère de la Santé", url: "https://baignades.sante.gouv.fr/baignades/", description: "Sites de baignade de Passy et Sallanches : E. coli, entérocoques et appréciations des prélèvements. Coordonnées officielles des sites, pas de chaque prélèvement.", color: "#0891b2" },
  { id: "drinking", title: "Eau potable · contrôle ARS", source: "Ministère de la Santé · Hub’Eau", url: "https://hubeau.eaufrance.fr/page/api-qualite-eau-potable", description: "Conclusions sanitaires par réseau de distribution. Les points sont des repères communaux, pas des captages ni des lieux de prélèvement.", color: "#2563eb" },
];

export const asText = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";
export function insideArea(lat: number, lng: number) {
  return insideCcpmb(lat, lng);
}
function retryDelay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function fetchJson(url: string, signal: AbortSignal, attempts = 1): Promise<unknown> {
  // One deadline for the whole sequence, including backoff, not 25 s per try.
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
  for (let attempt = 0; ; attempt++) {
    boundedSignal.throwIfAborted();
    let response: Response;
    try { response = await fetch(url, { signal: boundedSignal }); }
    catch (error) {
      if (!(error instanceof TypeError) || boundedSignal.aborted || attempt + 1 >= attempts) throw error;
      await retryDelay(500 * 2 ** attempt, boundedSignal);
      continue;
    }
    if (response.ok) return response.json();
    if (![500, 502, 503, 504].includes(response.status) || attempt + 1 >= attempts) throw new Error(`Le fournisseur répond avec une erreur (${response.status}).`);
    await response.body?.cancel();
    await retryDelay(500 * 2 ** attempt, boundedSignal);
  }
}
export function rows(value: unknown, key = "data"): Row[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Row)[key])) throw new Error("Le format de réponse du fournisseur a changé.");
  return ((value as Row)[key] as unknown[]).filter((row): row is Row => !!row && typeof row === "object");
}

export async function loadLayer(id: RemoteLayerId, signal: AbortSignal): Promise<LayerPoint[]> {
  if (id === "rivers") {
    const data = await fetchJson("https://hubeau.eaufrance.fr/api/v2/qualite_rivieres/station_pc?code_departement=74&size=1000&fields=code_station,libelle_station,latitude,longitude,libelle_commune,date_maj_information", signal, 3);
    if ((data as Row).next) throw new Error("Le catalogue dépasse la limite prévue. Les stations ne peuvent pas être affichées intégralement.");
    return rows(data).flatMap((p) => {
      const lat = Number(p.latitude), lng = Number(p.longitude);
      return insideArea(lat, lng) ? [{ id: asText(p.code_station), name: asText(p.libelle_station), lat, lng, properties: p }] : [];
    });
  }
  const data = await fetchJson("https://geo.api.gouv.fr/communes?codeDepartement=74&fields=nom,code,centre&format=json", signal);
  if (!Array.isArray(data)) throw new Error("Les centres communaux sont indisponibles.");
  return (data as Row[]).flatMap((p) => {
    const coordinates = (p.centre as { coordinates?: number[] } | undefined)?.coordinates;
    if (!coordinates) return [];
    const [lng, lat] = coordinates;
    return insideArea(lat, lng) ? [{ id: asText(p.code), name: asText(p.nom), lat, lng, properties: p }] : [];
  });
}

export function analysisUrl(kind: "rivers" | "drinking", id: string) {
  return kind === "rivers"
    ? `https://hubeau.eaufrance.fr/api/v2/qualite_rivieres/analyse_pc?code_station=${encodeURIComponent(id)}&size=10&sort=desc`
    : `https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/resultats_dis?code_reseau=${encodeURIComponent(id)}&size=10&sort=desc`;
}
