import type { PollutionSite } from "../../lib/google-sheets";

export const IREP_SOURCE_URL = "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles-rejetant-des-polluants";

export interface IndustrialEmission {
  pollutant: string;
  medium: string;
  quantity: number | "< seuil";
  unit: string;
}

export interface IndustrialFacility {
  id: string;
  name: string;
  siret: string;
  commune: string;
  communeCode: string;
  emissions: IndustrialEmission[];
}

export interface IndustrialEmissionsData {
  year: number | null;
  fetchedAt: string | null;
  downloadUrl: string | null;
  facilities: IndustrialFacility[];
  error?: string;
}

function normalizedCommune(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// A business-directory reference identifies a company, not necessarily a plant.
// Match only a unique establishment in the SAME commune. No fuzzy name or
// nearest-coordinate matching: historical sites may share an active site's pin.
export function inventoryFacility(site: PollutionSite, data: IndustrialEmissionsData): IndustrialFacility | null {
  let url: URL;
  try { url = new URL(site.link); } catch { return null; }
  if (url.hostname !== "annuaire-entreprises.data.gouv.fr") return null;
  const identity = url.pathname.match(/^\/entreprise\/[^/]*-(\d{9}|\d{14})\/?$/)?.[1];
  if (!identity) return null;
  const candidates = data.facilities.filter((facility) =>
    /^\d{14}$/.test(facility.siret) &&
    (identity.length === 14 ? facility.siret === identity : facility.siret.startsWith(identity)) &&
    normalizedCommune(facility.commune) === normalizedCommune(site.commune));
  return candidates.length === 1 ? candidates[0] : null;
}

export function formatEmissionQuantity(quantity: number) {
  // Significant digits preserve tiny declarations (e.g. dioxins); do not round
  // small positive releases to zero or add incomparable pollutants together.
  return new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 10 }).format(quantity);
}
