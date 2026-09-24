import { createHash } from "node:crypto";
import { clipPathsToCcpmb } from "./ccpmb-territory.ts";
import { AREA } from "./environmental-layers.ts";
import { TRAFFIC_ROADS, clipTrafficPaths, type RoadPosition, type RoadTrafficData, type RoadTrafficSegment, type TrafficRoad } from "./road-traffic.ts";

export function roadTrafficUrl() {
  const url = new URL("https://ogc.geo-ide.developpement-durable.gouv.fr/wxs");
  url.search = new URLSearchParams({ map: "/opt/data/stack/mapfiles/1.4/org_38090/7bc62133-b9b6-407a-b937-a75b120540ef.internet.map", SERVICE: "WFS", VERSION: "1.1.0", REQUEST: "GetFeature", TYPENAME: "ms:L_RESEAU_TRAFIC_ROUTIER_L_074", SRSNAME: "EPSG:4326", BBOX: `${AREA.south},${AREA.west},${AREA.north},${AREA.east},urn:ogc:def:crs:EPSG::4326`, MAXFEATURES: "1000" }).toString();
  return url.toString();
}

// Narrow parser for the verified MapServer WFS 1.1 GML3 schema, not a general
// XML interpreter. Refuse changed geometry/CRS, entities and partial exports.
function field(xml: string, name: string) {
  const value = xml.match(new RegExp(`<ms:${name}(?:\\s[^>]*?)?(?:\\s*\\/>|>([^<]*)<\\/ms:${name}>)`))?.[1]?.trim() ?? "";
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function positiveNumber(value: string) {
  // In this dataset 0 and -99 are missing/no-count sentinels, not zero traffic.
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
export function parseRoadTraffic(xml: string, currentYear = new Date().getUTCFullYear()): Pick<RoadTrafficData, "segments" | "year"> {
  if (xml.length > 4_000_000 || /<!DOCTYPE|<!ENTITY|ExceptionReport|ServiceException/i.test(xml) || !/<wfs:FeatureCollection\b/.test(xml) || !/<\/wfs:FeatureCollection>\s*$/.test(xml)) throw new Error("Réponse WFS invalide ou incomplète.");
  const members = [...xml.matchAll(/<gml:featureMember>\s*<ms:L_RESEAU_TRAFIC_ROUTIER_L_074>([\s\S]*?)<\/ms:L_RESEAU_TRAFIC_ROUTIER_L_074>\s*<\/gml:featureMember>/g)];
  if (!members.length || members.length >= 1000 || members.length !== [...xml.matchAll(/<gml:featureMember\b/g)].length) throw new Error("Catalogue routier vide, incomplet ou trop volumineux.");
  const years = [...xml.matchAll(/<ms:TMJA_(\d{2})(?:\s|>)/g)].map((m) => { const suffix = Number(m[1]); return suffix >= 70 ? 1900 + suffix : 2000 + suffix; });
  const year = Math.max(...years.filter((y) => y < currentYear));
  if (!Number.isFinite(year)) throw new Error("Année de comptage non identifiée.");
  const suffix = String(year).slice(-2);
  const segments: RoadTrafficSegment[] = [], ids = new Set<string>();
  for (const [, member] of members) {
    const road = field(member, "N_ROUTE").replace(/\s/g, "");
    if (!TRAFFIC_ROADS.includes(road as TrafficRoad)) continue;
    const geometry = member.match(/<ms:geometry>\s*<gml:MultiCurve srsName="EPSG:4326">([\s\S]*?)<\/gml:MultiCurve>\s*<\/ms:geometry>/)?.[1];
    if (!geometry) throw new Error("Géométrie ou projection WFS non reconnue.");
    const curves = [...geometry.matchAll(/<gml:curveMember>\s*<gml:LineString>\s*<gml:posList srsDimension="2">([^<]+)<\/gml:posList>\s*<\/gml:LineString>\s*<\/gml:curveMember>/g)];
    if (!curves.length || curves.length !== [...geometry.matchAll(/<gml:curveMember\b/g)].length) throw new Error("Tracé routier incomplet.");
    const originalPaths = curves.map(([, positions]) => {
      // EPSG:4326 in WFS 1.1 GML is latitude, longitude (unlike GeoJSON).
      const values = positions.trim().split(/\s+/).map(Number);
      if (values.length < 4 || values.length % 2 || values.some((v) => !Number.isFinite(v))) throw new Error("Coordonnées invalides.");
      const path: RoadPosition[] = [];
      for (let i = 0; i < values.length; i += 2) {
        const lat = values[i], lng = values[i + 1];
        if (lat < 40 || lat > 52 || lng < -6 || lng > 10) throw new Error("Ordre des axes ou projection incorrects.");
        path.push([lat, lng]);
      }
      return path;
    });
    const paths = clipPathsToCcpmb(clipTrafficPaths(originalPaths));
    if (!paths.length) continue;
    const officialId = field(member, "ID"), point = field(member, "N_COMPT"), countingType = field(member, "T_COMPT");
    const sourceId = officialId && officialId !== "X" ? officialId : null;
    // Some published IDs are empty/X; include geometry to avoid collisions and
    // remain stable if the provider changes the order of returned features.
    const id = `${road}-${sourceId ?? "sans-comptage"}-${createHash("sha256").update(JSON.stringify(originalPaths)).digest("hex").slice(0, 16)}`;
    if (ids.has(id)) throw new Error("Tronçon dupliqué.");
    ids.add(id);
    const vehicles = positiveNumber(field(member, `TMJA_${suffix}`));
    const percentRaw = field(member, `PCT_PL_${suffix}`);
    const percent = /^\d+(?:\.\d+)?$/.test(percentRaw) ? Number(percentRaw) : NaN;
    const heavyVehiclesPercent = vehicles !== null && percent >= 0 && percent <= 100 ? percent : null;
    segments.push({ id, sourceId, road: road as TrafficRoad, name: sourceId ? `Point de comptage ${point || sourceId}` : "Tronçon sans point de comptage", paths, vehicles, year, heavyVehiclesPercent, countingType });
  }
  if (!segments.length) throw new Error("Aucune des routes demandées n’est disponible.");
  return { segments, year };
}

export async function loadRoadTraffic(fetcher: typeof fetch = fetch): Promise<RoadTrafficData> {
  try {
    const response = await fetcher(roadTrafficUrl(), { signal: AbortSignal.timeout(25000), next: { revalidate: 3600 } });
    if (!response.ok) throw new Error(`WFS ${response.status}`);
    return { ...parseRoadTraffic(await response.text()), fetchedAt: new Date().toISOString() };
  } catch {
    return { segments: [], year: null, fetchedAt: null, error: "Les tracés et comptages officiels n’ont pas pu être récupérés lors de la reconstruction du site. Consultez la source ; aucune valeur de trafic n’est inventée." };
  }
}
