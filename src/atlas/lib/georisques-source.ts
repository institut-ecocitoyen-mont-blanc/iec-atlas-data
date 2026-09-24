import polygonClipping from "polygon-clipping";
import { CCPMB_COMMUNES, CCPMB_POLYGONS, CCPMB_BOUNDS, insideCcpmb } from "./ccpmb-territory.ts";
import type { GeorisquesData, GeorisquesSite, GeoPolygons, GeoPosition, SoilRecord } from "./georisques.ts";

type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Format Géorisques inattendu.");
  return value as Row;
};
const communes = new Set(CCPMB_COMMUNES.map((commune) => commune.code));
const boundary = CCPMB_POLYGONS as GeoPolygons;
export function georisquesUrl(kind: SoilRecord["kind"], page = 1) {
  const url = new URL(`https://www.georisques.gouv.fr/api/v1/ssp/${kind === "sis" ? "conclusions_sis" : "instructions"}`);
  url.search = new URLSearchParams({ code_insee: [...communes].join(","), page: String(page), page_size: "100" }).toString();
  return url.toString();
}
function position(value: unknown): GeoPosition {
  if (!Array.isArray(value) || value.length !== 2 || value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate)) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error("Coordonnées Géorisques invalides.");
  return [value[0], value[1]];
}
export function clipSoilGeometry(value: unknown, polygons = boundary): GeorisquesSite["geometry"] | null {
  const geom = record(value);
  if (geom.type === "Point") {
    const coordinates = position(geom.coordinates);
    return insideCcpmb(coordinates[1], coordinates[0], polygons) ? { type: "Point", coordinates } : null;
  }
  if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") throw new Error("Géométrie Géorisques non prise en charge.");
  const raw = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  if (!Array.isArray(raw) || !raw.length) throw new Error("Polygone Géorisques absent.");
  let vertices = 0;
  const coordinates: GeoPolygons = raw.map((poly) => {
    if (!Array.isArray(poly) || !poly.length) throw new Error("Polygone Géorisques invalide.");
    return poly.map((ring) => {
      if (!Array.isArray(ring) || ring.length < 4 || (vertices += ring.length) > 20000) throw new Error("Anneau Géorisques invalide.");
      const points = ring.map(position);
      if (points[0][0] !== points.at(-1)![0] || points[0][1] !== points.at(-1)![1]) throw new Error("Anneau Géorisques non fermé.");
      return points;
    });
  });
  const clipped = polygonClipping.intersection(coordinates, polygons);
  return clipped.length ? { type: "MultiPolygon", coordinates: clipped } : null;
}
function sourceUrl(value: unknown) {
  const url = new URL(text(value));
  if (url.protocol !== "https:" || url.hostname !== "fiches-risques.brgm.fr" || !url.pathname.startsWith("/georisques/infosols/")) throw new Error("Fiche Géorisques inattendue.");
  return url.toString();
}
export function parseSoilRecords(values: unknown[], kind: SoilRecord["kind"]): GeorisquesSite[] {
  const sites: GeorisquesSite[] = [];
  const ids = new Set<string>();
  for (const value of values) {
    const row = record(value);
    if (!communes.has(text(row.code_insee))) continue;
    const id = text(row.identifiant_ssp);
    if (!/^SSP\d+$/.test(id) || ids.has(id)) throw new Error("Identifiant Géorisques absent ou dupliqué.");
    ids.add(id);
    const geometry = clipSoilGeometry(row.geom);
    if (!geometry) continue;
    const name = text(kind === "sis" ? row.nom : row.nom_etablissement);
    if (!name) throw new Error("Nom Géorisques absent.");
    sites.push({ id, name, commune: text(row.nom_commune), communeCode: text(row.code_insee), address: [text(row.adresse), text(row.adresse_lieudit)].filter(Boolean).join(" · "), geometry,
      records: [{ id, kind, sisId: text(row.id_sis), status: text(kind === "sis" ? row.statut_classification : row.statut), updatedAt: text(row.date_maj), url: sourceUrl(row.fiche_risque) }],
    });
  }
  return sites;
}
export function groupSoilRecords(sites: GeorisquesSite[]): GeorisquesSite[] {
  const grouped = new Map<string, GeorisquesSite>();
  for (const site of sites) {
    // Merge only exact same named footprint in the same commune, retaining both
    // source records. Similar names or nearby points are never enough.
    const key = JSON.stringify([site.name, site.communeCode, site.geometry]);
    const previous = grouped.get(key);
    if (previous) previous.records.push(...site.records);
    else grouped.set(key, { ...site, records: [...site.records] });
  }
  return [...grouped.values()];
}
async function loadGeorisquesRest(fetcher: typeof fetch): Promise<GeorisquesData> {
  const signal = AbortSignal.timeout(30000);
  const parts = await Promise.all((["instruction", "sis"] as const).map(async (kind) => {
    try {
      const values: unknown[] = [];
      let expected: number | undefined;
      for (let page = 1; page <= 10; page++) {
        const response = await fetcher(georisquesUrl(kind, page), { signal });
        if (!response.ok) throw new Error(`Géorisques ${response.status}`);
        const body = await response.text();
        if (body.length > 4_000_000) throw new Error("Réponse Géorisques trop volumineuse.");
        const data = record(JSON.parse(body));
        if (!Array.isArray(data.data) || data.page !== page || !Number.isInteger(data.results) || Number(data.results) < 0 || !Number.isInteger(data.total_pages) || Number(data.total_pages) > 10) throw new Error("Pagination Géorisques inattendue.");
        if (expected !== undefined && expected !== data.results) throw new Error("Catalogue Géorisques modifié pendant la lecture.");
        expected = Number(data.results);
        values.push(...data.data);
        if (!data.next) {
          if (values.length !== expected) throw new Error("Catalogue Géorisques incomplet.");
          return { sites: parseSoilRecords(values, kind), error: null };
        }
      }
      throw new Error("Catalogue Géorisques incomplet.");
    } catch {
      return { sites: [], error: `${kind === "sis" ? "Les secteurs SIS" : "Les dossiers de pollution des sols"} n’ont pas pu être récupérés. Nouvelle tentative lors du prochain import automatique.` };
    }
  }));
  return { sites: groupSoilRecords(parts.flatMap((part) => part.sites)), fetchedAt: parts.some((part) => !part.error) ? new Date().toISOString() : null, errors: parts.flatMap((part) => part.error ? [part.error] : []), transport: "rest", sourceUrls: [georisquesUrl("instruction"), georisquesUrl("sis")] };
}

const WFS_LAYERS = ["SSP_INSTR_GE_POLYGONE", "SSP_INSTR_GE_POINT", "SSP_CLASSIF_SIS_GE"] as const;
type WfsLayer = typeof WFS_LAYERS[number];
export function georisquesWfsUrl(layer: WfsLayer, hits = false) {
  const b = CCPMB_BOUNDS;
  const query = new URLSearchParams({ SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAMES: `ms:${layer}`, SRSNAME: "urn:ogc:def:crs:EPSG::4326",
    // WFS 2.0 EPSG:4326 query axes are latitude, longitude. Returned GeoJSON
    // explicitly declares CRS84 (longitude, latitude); verify before parsing.
    BBOX: [b.south, b.west, b.north, b.east, "urn:ogc:def:crs:EPSG::4326"].join(","),
  });
  if (hits) query.set("RESULTTYPE", "hits");
  else { query.set("COUNT", "1000"); query.set("OUTPUTFORMAT", "application/json; subtype=geojson; charset=utf-8"); }
  return `https://www.georisques.gouv.fr/services?${query}`;
}
async function wfsText(url: string, fetcher: typeof fetch, signal: AbortSignal) {
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`Géorisques WFS ${response.status}`);
  // Bound streamed bytes too, not only the final decoded text.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Réponse WFS absente.");
  const decoder = new TextDecoder(); let bytes = 0, body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 4_000_000) throw new Error("Réponse WFS trop volumineuse.");
      body += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel(); }
}
export async function loadGeorisquesWfs(fetcher: typeof fetch = fetch): Promise<GeorisquesData> {
  const signal = AbortSignal.timeout(60000);
  const parts = await Promise.all(WFS_LAYERS.map(async layer => {
    const hits = await wfsText(georisquesWfsUrl(layer, true), fetcher, signal);
    const match = hits.match(/<wfs:FeatureCollection\b[^>]*\bnumberMatched="(\d+)"/);
    if (!match || Number(match[1]) > 1000) throw new Error("Décompte WFS absent ou trop volumineux.");
    const data = record(JSON.parse(await wfsText(georisquesWfsUrl(layer), fetcher, signal)));
    if (data.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length !== Number(match[1])) throw new Error("Catalogue WFS incomplet.");
    if (record(record(data.crs).properties).name !== "urn:ogc:def:crs:OGC:1.3:CRS84") throw new Error("CRS WFS inattendu.");
    const kind = layer === "SSP_CLASSIF_SIS_GE" ? "sis" : "instruction";
    const rows = data.features.map(value => {
      const feature = record(value), p = record(feature.properties);
      if (feature.type !== "Feature") throw new Error("Objet WFS inattendu.");
      const id = text(p.code_metier);
      if (!/^SSP\d+$/.test(id)) throw new Error("Identifiant WFS absent.");
      return { identifiant_ssp: id, code_insee: p.code_insee, nom_commune: p.nom_commune, nom_etablissement: p.nom_etablissement, nom: p.nom_etablissement, adresse: p.adresse,
        geom: feature.geometry, id_sis: kind === "sis" ? p.id_inventaire_classification : "",
        statut: p.statut_instruction, date_maj: p.date_maj,
        // SIS WFS does not publish the dossier update date/status. Do not use
        // date_saisie_commune or date_ap as an invented dossier update date.
        fiche_risque: `https://fiches-risques.brgm.fr/georisques/infosols/${kind === "sis" ? "classification" : "instruction"}/${id}`,
      };
    });
    return { kind, rows };
  }));
  // Validate IDs across both instruction geometry layers, not just within each.
  const sites = (["instruction", "sis"] as const).flatMap(kind => parseSoilRecords(parts.filter(p => p.kind === kind).flatMap(p => p.rows), kind));
  return { sites: groupSoilRecords(sites), errors: [], fetchedAt: new Date().toISOString(), transport: "wfs", sourceUrls: WFS_LAYERS.map(layer => georisquesWfsUrl(layer)) };
}
export async function loadGeorisques(fetcher: typeof fetch = fetch): Promise<GeorisquesData> {
  // The published WFS is available while REST's gateway is failing. Prefer
  // the working official source; do not make a failing REST call a prerequisite.
  try { return await loadGeorisquesWfs(fetcher); }
  catch { return loadGeorisquesRest(fetcher); } // Preserve last complete snapshot if both fail.
}
