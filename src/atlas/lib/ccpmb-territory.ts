import boundaries from "./data/ccpmb-boundaries.json" with { type: "json" };
import type { RoadPosition } from "./road-traffic.ts";

// Official geo.api.gouv.fr commune contours, pinned for reproducible exports.
// GeoJSON is longitude/latitude; Leaflet road paths are latitude/longitude.
type Point = number[];
type Polygon = Point[][];
export const CCPMB_COMMUNES = boundaries.features.map((feature) => feature.properties);
export const CCPMB_POLYGONS: Polygon[] = boundaries.features.flatMap((feature) =>
  feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates as Polygon]
    : feature.geometry.coordinates as unknown as Polygon[],
);
export const CCPMB_BOUNDS = CCPMB_POLYGONS.flat(2).reduce((bounds, [lng, lat]) => ({
  west: Math.min(bounds.west, lng), east: Math.max(bounds.east, lng),
  south: Math.min(bounds.south, lat), north: Math.max(bounds.north, lat),
}), { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity });
export function filterCcpmbPoints<T extends { lat: number; lng: number }>(points: readonly T[]): T[] {
  return points.filter(({ lat, lng }) => insideCcpmb(lat, lng));
}
const EPS = 1e-10;
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
function inRing([x, y]: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    if (Math.abs(cross(x - ax, y - ay, bx - ax, by - ay)) < EPS &&
      x >= Math.min(ax, bx) - EPS && x <= Math.max(ax, bx) + EPS &&
      y >= Math.min(ay, by) - EPS && y <= Math.max(ay, by) + EPS) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export function insideCcpmb(lat: number, lng: number, polygons = CCPMB_POLYGONS) {
  return Number.isFinite(lat) && Number.isFinite(lng) && polygons.some(([outer, ...holes]) =>
    inRing([lng, lat], outer) && !holes.some((hole) => inRing([lng, lat], hole)),
  );
}

// Scanline intersections for raster masking. Pair crossings within each
// polygon (including holes), then union the commune spans. This avoids a full
// point-in-polygon test for every heatmap pixel and leaves no internal seams.
export function ccpmbLongitudeSpans(lat: number, polygons = CCPMB_POLYGONS): [number, number][] {
  const spans: [number, number][] = [];
  for (const polygon of polygons) {
    const crossings: number[] = [];
    for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
      if ((ay > lat) !== (by > lat)) crossings.push(ax + (lat - ay) / (by - ay) * (bx - ax));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 1; i < crossings.length; i += 2) spans.push([crossings[i - 1], crossings[i]]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const union: [number, number][] = [];
  for (const span of spans) {
    const previous = union.at(-1);
    if (previous && span[0] <= previous[1]) previous[1] = Math.max(previous[1], span[1]);
    else union.push([...span]);
  }
  return union;
}

// Split at every polygon-edge intersection, then retain only intervals within
// the union of communes. This handles crossings with both endpoints outside,
// holes, shared borders, and multiple entries without inventing connecting lines.
export function clipPathsToCcpmb(paths: RoadPosition[][], polygons = CCPMB_POLYGONS): RoadPosition[][] {
  const edges = polygons.flatMap((polygon) => polygon.flatMap((ring) =>
    ring.slice(1).map((point, i) => [ring[i], point]),
  ));
  const result: RoadPosition[][] = [];
  for (const path of paths) {
    let current: RoadPosition[] = [];
    const finish = () => { if (current.length > 1) result.push(current); current = []; };
    for (let i = 1; i < path.length; i++) {
      const [ay, ax] = path[i - 1], [by, bx] = path[i];
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      if (length2 === 0) continue;
      const cuts = [0, 1];
      for (const [[cx, cy], [ex, ey]] of edges) {
        if (Math.max(ax, bx) < Math.min(cx, ex) || Math.min(ax, bx) > Math.max(cx, ex) ||
          Math.max(ay, by) < Math.min(cy, ey) || Math.min(ay, by) > Math.max(cy, ey)) continue;
        const sx = ex - cx, sy = ey - cy, denominator = cross(dx, dy, sx, sy);
        if (Math.abs(denominator) < 1e-16) {
          if (Math.abs(cross(cx - ax, cy - ay, dx, dy)) < 1e-16) {
            for (const [x, y] of [[cx, cy], [ex, ey]]) cuts.push(Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)));
          }
          continue;
        }
        const t = cross(cx - ax, cy - ay, sx, sy) / denominator;
        const u = cross(cx - ax, cy - ay, dx, dy) / denominator;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) cuts.push(t);
      }
      cuts.sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        const start = cuts[j - 1], end = cuts[j];
        if (end - start < EPS) continue;
        const mid = (start + end) / 2;
        if (!insideCcpmb(ay + mid * dy, ax + mid * dx, polygons)) { finish(); continue; }
        const from: RoadPosition = [ay + start * dy, ax + start * dx];
        const to: RoadPosition = [ay + end * dy, ax + end * dx];
        const last = current.at(-1);
        if (!last || Math.abs(last[0] - from[0]) > EPS || Math.abs(last[1] - from[1]) > EPS) { finish(); current.push(from); }
        current.push(to);
      }
    }
    finish();
  }
  return result;
}
