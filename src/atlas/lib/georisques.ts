export const GEORISQUES_SOURCE = "https://www.georisques.gouv.fr/consulter-les-dossiers-thematiques/dossier-expert-sur-les-sites-et-sols-potentiellement-pollues";
export type GeoPosition = [number, number];
export type GeoPolygons = GeoPosition[][][];
export interface SoilRecord {
  id: string;
  kind: "instruction" | "sis";
  sisId: string;
  status: string;
  updatedAt: string;
  url: string;
}
export interface InstallationRecord {
  id: string;
  kind: "installation";
  status: string;
  regime: string;
  seveso: string;
  inspectionService: string;
  lastInspectionAt: string;
  updatedAt: string;
  url: string;
}
export interface GeorisquesSite {
  id: string;
  name: string;
  commune: string;
  communeCode: string;
  address: string;
  geometry: { type: "Point"; coordinates: GeoPosition } | { type: "MultiPolygon"; coordinates: GeoPolygons };
  records: (SoilRecord | InstallationRecord)[];
}
export interface GeorisquesData {
  sites: GeorisquesSite[];
  fetchedAt: string | null;
  errors: string[];
  transport?: "rest" | "wfs" | "wfs+rest";
  installations?: { total: number; mapped: number; missingCoordinates: number; outsideTerritory: number };
  sourceUrls?: string[];
}
export function soilRecordColor(site: GeorisquesSite) {
  // Categorical dossier colours, not pollution severity or health thresholds.
  return site.records.some((record) => record.kind === "sis") ? "#7c3aed" : site.records.some((record) => record.kind === "installation") ? "#247184" : "#925323";
}
