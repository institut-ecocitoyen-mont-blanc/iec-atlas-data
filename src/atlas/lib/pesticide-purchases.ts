export const PESTICIDE_SOURCE = "https://www.data.gouv.fr/dataservices/hubeau-vente-et-achat-de-produits-phytopharmaceutiques";
export const PESTICIDE_API = "https://hubeau.eaufrance.fr/api/v1/vente_achat_phyto/achats/substances";
export const PESTICIDE_LICENSE = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/";

// Postal correspondence verified against geo.api.gouv.fr on 2026-09-25.
// Commune contours are geographic guides, NOT official postal boundaries.
export const PESTICIDE_ZONES = [
  { code: "74190", communes: ["74208"], name: "Passy" },
  { code: "74700", communes: ["74256", "74089", "74103"], name: "Sallanches · Cordon · Domancy" },
  { code: "74120", communes: ["74173", "74099", "74215"], name: "Megève · Demi-Quartier · Praz-sur-Arly" },
  { code: "74170", communes: ["74236", "74085"], name: "Saint-Gervais · Les Contamines-Montjoie" },
  { code: "74920", communes: ["74083"], name: "Combloux" },
] as const;

export interface PurchaseRow {
  zone: string; year: number; substance: string; substanceId: string;
  quantity: number | null; function: string;
}
export interface PurchaseData { rows: PurchaseRow[]; years: number[]; fetchedAt: string }
export interface PurchaseSummary { quantity: number | null; missing: number; records: number }
export function purchaseSummary(rows: readonly PurchaseRow[]): PurchaseSummary {
  const known = rows.filter((row) => row.quantity !== null);
  return { quantity: known.length ? known.reduce((sum, row) => sum + row.quantity!, 0) : null, missing: rows.length - known.length, records: rows.length };
}
export function substanceSummaries(rows: readonly PurchaseRow[]) {
  const groups = new Map<string, PurchaseRow[]>();
  for (const row of rows) groups.set(row.substanceId, [...(groups.get(row.substanceId) ?? []), row]);
  return [...groups].map(([id, rows]) => ({ id, name: rows[0].substance, functions: [...new Set(rows.map((row) => row.function))].join(", "), ...purchaseSummary(rows) }))
    .sort((a, b) => (b.quantity ?? -1) - (a.quantity ?? -1) || a.name.localeCompare(b.name, "fr"));
}
export function pesticideUrl(page = 1) {
  return `${PESTICIDE_API}?${new URLSearchParams({ type_territoire: "Zone postale", code_territoire: PESTICIDE_ZONES.map(({ code }) => code).join(","), annee_min: "2013", size: "1000", page: String(page), sort: "desc" })}`;
}
export function parsePurchasePage(value: unknown): { rows: PurchaseRow[]; count: number; more: boolean } {
  const page = value as { data?: Record<string, unknown>[]; count?: number; next?: unknown } | null;
  if (!page || !Array.isArray(page.data) || !Number.isSafeInteger(page.count) || page.count! < 0 || !(page.next === null || typeof page.next === "string")) throw new Error("Réponse Hub’Eau incomplète ou incompatible.");
  const text = (value: unknown) => typeof value === "string" && value.trim() && value !== "-" ? value.trim() : "";
  const rows = page.data.map((row): PurchaseRow => {
    if (!row || row.type_territoire !== "Zone postale" || !PESTICIDE_ZONES.some(({ code }) => code === row.code_territoire) || !Number.isInteger(row.annee) || Number(row.annee) < 2013 || Number(row.annee) > new Date().getFullYear()) throw new Error("Périmètre ou année inattendus dans les achats Hub’Eau.");
    const substance = text(row.libelle_substance);
    if (!substance) throw new Error("Substance manquante dans les achats Hub’Eau.");
    // Never turn confidential, absent or invalid quantities into zero.
    const quantity = row.achat_etranger !== "nc" && typeof row.quantite === "number" && Number.isFinite(row.quantite) && row.quantite >= 0 ? row.quantite : null;
    return { zone: String(row.code_territoire), year: Number(row.annee), substance, substanceId: text(row.code_cas) || text(row.code_substance) || substance.toLowerCase(), quantity, function: text(row.fonction) || "Non renseignée" };
  });
  return { rows, count: page.count!, more: typeof page.next === "string" };
}
let cached: PurchaseData | undefined;
export async function loadPesticidePurchases(signal: AbortSignal, refresh = false): Promise<PurchaseData> {
  if (!refresh && cached && Date.now() - Date.parse(cached.fetchedAt) < 3600000) return cached;
  const rows: PurchaseRow[] = [];
  let expected: number | undefined;
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  for (let page = 1; page <= 100; page++) {
    // Build HTTPS paging URLs ourselves: the provider's next links use HTTP.
    const response = await fetch(pesticideUrl(page), { signal: boundedSignal });
    if (!response.ok) throw new Error(`Hub’Eau est indisponible (${response.status}).`);
    const result = parsePurchasePage(await response.json());
    expected ??= result.count;
    if (expected !== result.count) throw new Error("Les achats ont changé pendant le chargement. Réessayez.");
    rows.push(...result.rows);
    if (rows.length > expected || (result.more && (!result.rows.length || rows.length >= expected))) throw new Error("Pagination des achats incohérente.");
    if (!result.more) {
      if (rows.length !== expected) throw new Error("Les achats n’ont pas été chargés en totalité. Réessayez.");
      boundedSignal.throwIfAborted();
      cached = { rows, years: [...new Set(rows.map((row) => row.year))].sort((a, b) => b - a), fetchedAt: new Date().toISOString() };
      return cached;
    }
  }
  throw new Error("Trop de pages d’achats. Chargement interrompu pour éviter un total incomplet.");
}

// Descriptive mass bands, not exposure, toxicity or health thresholds.
export const PESTICIDE_BANDS = [
  { max: 10, color: "#dbeafe", label: "0 – < 10 kg" },
  { max: 50, color: "#93c5fd", label: "10 – < 50 kg" },
  { max: 200, color: "#3b82f6", label: "50 – < 200 kg" },
  { max: 500, color: "#1d4ed8", label: "200 – < 500 kg" },
  { max: Infinity, color: "#1e3a8a", label: "≥ 500 kg" },
] as const;
export function pesticideColor(quantity: number | null) {
  return quantity === null ? "#94a3b8" : PESTICIDE_BANDS.find(({ max }) => quantity < max)!.color;
}
export function purchaseLabel(summary: PurchaseSummary) {
  if (!summary.records) return "Aucun achat renseigné";
  if (summary.quantity === null) return "Quantité non disponible";
  const amount = summary.quantity > 0 && summary.quantity < 0.001 ? "< 0,001" : summary.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
  return `${amount} kg${summary.missing ? " · partiel" : ""}`;
}
