import { AREA } from "./environmental-layers.ts";

export const TRAFFIC_ROADS = ["A40", "D1205", "D909", "D1212", "D13", "D39", "D902", "D339", "N205"] as const;
export type TrafficRoad = typeof TRAFFIC_ROADS[number];
export type RoadPosition = [number, number]; // Latitude, longitude for Leaflet.
export interface RoadTrafficSegment {
  id: string; road: TrafficRoad; name: string; paths: RoadPosition[][];
  vehicles: number | null; year: number; heavyVehiclesPercent: number | null; countingType: string; sourceId: string | null;
}
export interface RoadTrafficData { segments: RoadTrafficSegment[]; year: number | null; fetchedAt: string | null; error?: string }
export const TRAFFIC_SOURCE_URL = "https://www.data.gouv.fr/datasets/trafic-routier-en-haute-savoie";
// Display classes, not pollution, safety, or congestion thresholds.
export const TRAFFIC_BANDS = [
  { max: 2500, label: "Moins de 2 500", color: "#15803d" },
  { max: 5000, label: "2 500 à 4 999", color: "#65a30d" },
  { max: 10000, label: "5 000 à 9 999", color: "#d97706" },
  { max: 20000, label: "10 000 à 19 999", color: "#ea580c" },
  { max: Infinity, label: "20 000 et plus", color: "#b91c1c" },
] as const;
export function trafficColor(vehicles: number | null) {
  if (vehicles === null || !Number.isFinite(vehicles) || vehicles < 0) return "#64748b";
  return TRAFFIC_BANDS.find((band) => vehicles < band.max)?.color ?? "#64748b";
}
export const trafficValue = (vehicles: number | null) => vehicles === null ? "Comptage non disponible" : `${vehicles.toLocaleString("fr-FR")} véhicules / jour`;

// Clip actual line segments, not just their vertices: a road may cross the
// atlas with both endpoints outside. Never connect disjoint clipped pieces.
export function clipTrafficPaths(paths: RoadPosition[][], bounds = AREA): RoadPosition[][] {
  const result: RoadPosition[][] = [];
  for (const path of paths) {
    let current: RoadPosition[] = [];
    const finish = () => { if (current.length > 1) result.push(current); current = []; };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], dx = b[1] - a[1], dy = b[0] - a[0];
      let low = 0, high = 1, outside = false;
      const edges = [[-dx, a[1] - bounds.west], [dx, bounds.east - a[1]], [-dy, a[0] - bounds.south], [dy, bounds.north - a[0]]];
      for (const [p, q] of edges) {
        if (p === 0) { if (q < 0) outside = true; continue; }
        const t = q / p;
        if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
      }
      if (outside || low >= high || (dx === 0 && dy === 0)) { finish(); continue; }
      const from: RoadPosition = [a[0] + low * dy, a[1] + low * dx], to: RoadPosition = [a[0] + high * dy, a[1] + high * dx];
      const last = current.at(-1);
      if (!last || Math.abs(last[0] - from[0]) > 1e-8 || Math.abs(last[1] - from[1]) > 1e-8) { finish(); current.push(from); }
      current.push(to);
      if (high < 1) finish();
    }
    finish();
  }
  return result;
}
