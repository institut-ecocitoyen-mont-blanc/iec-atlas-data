import type { Quality } from "./environmental-quality";

export interface RiverAssessment {
  stationId: string; year: number; nature: string; ecological: string; potential: string; chemical: string; chemicalDowngraders: string;
}
export interface RiverAssessments { stations: Record<string, RiverAssessment>; fetchedAt: string | null; error?: string }
export const riverAssessmentUrl = (id: string) => `https://www.rhone-mediterranee.eaufrance.fr/station-${encodeURIComponent(id)}`;
const labels: Record<string, string> = { TBE: "Très bon", BE: "Bon", MOY: "Moyen", MED: "Médiocre", MAUV: "Mauvais" };
export function riverQuality(assessment?: RiverAssessment): Quality {
  if (!assessment) return { level: "unknown", label: "État non déterminé", detail: "Aucune évaluation AERMC disponible pour cet identifiant de station. Aucune note n’est déduite des analyses brutes." };
  const potential = assessment.nature === "MEFM" || assessment.nature === "MEA" || (!assessment.ecological && !!assessment.potential);
  const code = potential ? assessment.potential : assessment.ecological;
  const label = `${potential ? "Potentiel" : "État"} écologique : ${labels[code]?.toLowerCase() ?? "indéterminé"}`;
  const level = code === "BE" || code === "TBE" ? "good" : code === "MOY" ? "moderate" : code === "MED" || code === "MAUV" ? "poor" : "unknown";
  return { level, label, period: String(assessment.year), detail: "Évaluation à la station publiée par l’Agence de l’eau. Couleurs simplifiées en trois groupes ; classe officielle conservée. L’état chimique est présenté séparément." };
}
export function riverChemicalLabel(assessment: RiverAssessment) {
  return assessment.chemical === "BE" ? "Bon état chimique" : assessment.chemical === "MAUV" ? "Bon état chimique non atteint" : "État chimique indéterminé";
}
