import type { Quality } from "./environmental-quality";

export const BATHING_CATALOGUE_URL = "https://www.data.gouv.fr/api/1/datasets/r/e659289d-fdc2-46c2-a025-d7e1264e4197";
export interface BathingSite {
  id: string; euId: string; name: string; officialName: string; commune: string; lat: number; lng: number;
}
// Published ETRS89 site coordinates, Ministry's 2026 catalogue (URL above).
// Portal IDs and EU reporting IDs are different: never derive one from the other.
export const BATHING_SITES: BathingSite[] = [
  { id: "074003360", euId: "FRK2874208D074540", name: "Lac de Passy · Îles", officialName: "PASSY ILES", commune: "Passy", lat: 45.92230788470, lng: 6.65418052185 },
  { id: "074003361", euId: "FRK2874208D074550", name: "Lac de la Cavettaz", officialName: "PASSY CAVETTAZ", commune: "Passy", lat: 45.92413442033, lng: 6.65484424778 },
  { id: "074003362", euId: "FRK2874256D074570", name: "Lacs des Ilettes", officialName: "SALLANCHES ILETTES", commune: "Sallanches", lat: 45.95580235931, lng: 6.63863328421 },
  { id: "074003363", euId: "FRK2874278D074530", name: "Thyez · Baignade municipale", officialName: "THYEZ MUNICIPALE", commune: "Thyez", lat: 46.07550025462, lng: 6.54576982046 },
  { id: "074003359", euId: "FRK2874190D074580", name: "Morillon · Baignade municipale", officialName: "MORILLON MUNICIPALE", commune: "Morillon", lat: 46.08658604261, lng: 6.68076430922 },
  { id: "074005813", euId: "FRK2874258D074650", name: "Samoëns · Lac des Dames", officialName: "SAMOENS LAC DES DAMES", commune: "Samoëns", lat: 46.07971280191, lng: 6.71185954180 },
];
export type BathingAssessment = "Bon" | "Moyen" | "Mauvais" | "Non renseigné";
export interface BathingSample {
  date: string; ecoli: string | null; enterococci: string | null; assessment: BathingAssessment;
}
export interface BathingSeason {
  year: number; sourceUrl: string; fetchedAt: string | null; samples: BathingSample[]; error?: string;
}
export interface BathingPoint extends BathingSite { seasons: BathingSeason[] }
export interface BathingData { points: BathingPoint[] }

export function bathingSourceUrl(id: string, year: number) {
  return `https://baignades.sante.gouv.fr/baignades/consultSite.do?annee=${year}&dptddass=074&isite=${id}&plv=all&site=${id}`;
}
export function bathingSamples(point: BathingPoint) {
  return point.seasons.flatMap((season) => season.samples).sort((a, b) => b.date.localeCompare(a.date));
}
export function bathingQuality(point: BathingPoint): Quality {
  const latest = bathingSamples(point)[0];
  const level = latest?.assessment === "Bon" ? "good" : latest?.assessment === "Moyen" ? "moderate" : latest?.assessment === "Mauvais" ? "poor" : "unknown";
  return {
    level, label: latest ? `Prélèvement : ${latest.assessment.toLowerCase()}` : "Aucun prélèvement disponible",
    detail: "Appréciation publiée pour ce prélèvement, pas un classement annuel ni une autorisation de baignade aujourd’hui.",
  };
}
