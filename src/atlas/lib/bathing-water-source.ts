// Server/build-time adapter: the Ministry's legacy HTML is not a browser API.
import { BATHING_SITES, bathingSourceUrl, type BathingAssessment, type BathingData, type BathingPoint, type BathingSample, type BathingSite } from "./bathing-water.ts";
import { filterCcpmbPoints } from "./ccpmb-territory.ts";

const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[a-z][^>]*>/gi, "")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&lt;|&#60;/g, "<").replace(/&gt;|&#62;/g, ">")
  .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const cells = (html: string) => [...html.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => text(m[1]));
function isoDate(value: string, year: number) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match || Number(match[3]) !== year) throw new Error("Date de prélèvement inattendue.");
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error("Date de prélèvement invalide.");
  return iso;
}
function measurement(value: string): string | null {
  if (!value || value === "-") return null;
  if (!/^[<>≤≥]?\s*\d+(?:[.,]\d+)?$/.test(value)) throw new Error("Format de mesure inattendu.");
  return value;
}

export function parseBathingPage(html: string, site: BathingSite, year: number): BathingSample[] {
  const plain = text(html);
  if (!plain.includes(site.officialName) || !html.includes(`isite=${site.id}`)) throw new Error("Le fournisseur a renvoyé un autre site.");
  // Scope all extraction to the all-samples section, not the annual ranking or its legend.
  const section = html.split('name="details"')[1];
  if (!section) {
    if (/aucun pr[ée]l[èe]vement/i.test(plain)) return [];
    throw new Error("Le tableau des prélèvements est indisponible ou a changé de format.");
  }
  const header = section.match(/<tr>\s*<th\b[^>]*scope="Date"[^>]*>[\s\S]*?<\/tr>/i)?.[0];
  if (!header) throw new Error("Les dates des prélèvements sont indisponibles.");
  const dates = cells(header).filter((cell) => /^\d{2}\/\d{2}\/\d{4}$/.test(cell)).map((d) => isoDate(d, year));
  if (!dates.length || new Set(dates).size !== dates.length) throw new Error("Dates absentes ou dupliquées.");
  const resultRow = (label: RegExp) => {
    const row = [...section.matchAll(/<tr>\s*<td\b[^>]*class="cellule_(?:impaire|paire)"[^>]*>[\s\S]*?<\/tr>/gi)]
      .map((m) => cells(m[0])).find((c) => label.test(c[0]));
    // Two final columns are the source's thresholds, NEVER measurements.
    if (!row || row.length !== dates.length + 3) throw new Error("Nombre de mesures différent du nombre de dates.");
    return row.slice(1, -2).map(measurement);
  };
  const entero = resultRow(/Entérocoques intestinaux.*\/100mL/);
  const ecoli = resultRow(/Escherichia coli.*\/100mL/);
  const assessments = new Map<string, BathingAssessment>();
  for (const m of html.matchAll(/<td\b[^>]*class="cadre_dotted fond(Bon|Moyen|Mauvais)"[^>]*>([\s\S]*?)<\/td>/g)) {
    const date = text(m[2]).match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
    if (date) assessments.set(isoDate(date, year), m[1] as BathingAssessment);
  }
  return dates.map((date, i) => ({ date, ecoli: ecoli[i], enterococci: entero[i], assessment: assessments.get(date) ?? "Non renseigné" }));
}

export async function loadBathingWater(fetcher: typeof fetch = fetch, now = new Date()): Promise<BathingData> {
  const year = now.getUTCFullYear();
  // Six verified local sites; at most three simultaneous requests. A failed year/site
  // never fabricates values or prevents another site or the inventory from loading.
  const deadline = AbortSignal.timeout(25000);
  const loadSite = async (site: BathingSite): Promise<BathingPoint> => {
    const seasons = [];
    for (const seasonYear of [year, year - 1]) {
      const sourceUrl = bathingSourceUrl(site.id, seasonYear);
      try {
        const options = { signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)]), headers: { "Accept-Language": "fr" }, next: { revalidate: 3600 } };
        const response = await fetcher(sourceUrl, options);
        if (!response.ok) throw new Error(`Réponse du fournisseur : ${response.status}.`);
        const html = new TextDecoder("windows-1252").decode(await response.arrayBuffer());
        const samples = parseBathingPage(html, site, seasonYear);
        seasons.push({ year: seasonYear, sourceUrl, samples, fetchedAt: new Date().toISOString() });
      } catch {
        seasons.push({ year: seasonYear, sourceUrl, samples: [], fetchedAt: null, error: `Prélèvements ${seasonYear} indisponibles lors de la récupération. Consultez le portail officiel.` });
      }
    }
    return { ...site, seasons };
  };
  const points: BathingPoint[] = [];
  const sites = filterCcpmbPoints(BATHING_SITES);
  let index = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (index < sites.length) {
      const i = index++;
      points[i] = await loadSite(sites[i]);
    }
  }));
  return { points };
}
