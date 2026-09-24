// Fetch and parse pollution source data from the validated Google Sheet.

const SPREADSHEET_ID = "1diIR2EXPf2QfkxUw-T0r3CRjinhcJVnnNH5azd0QxZg";

interface GoogleSheetsCell {
  v?: string | number | null;
  f?: string;
}

interface GoogleSheetsRow {
  c: (GoogleSheetsCell | null)[];
}

interface GoogleSheetsResponse {
  table: {
    rows: GoogleSheetsRow[];
  };
}

export interface PollutionEntry {
  process: string;
  chemicalFamilies: string;
  chemicalForm: string;
  environmentalCompartment: string;
  transferPathway: string;
  receivingEnvironments: string;
}

export interface PollutionSiteBase {
  id: string;
  name: string;
  commune: string;
  activity: string;
  sector: string;
  activityStatus: string;
  activityPeriod: string;
  emissionTiming: string;
  localizationType: string;
  localizationDetail: string;
  knowledgeLevel: string;
  pollutions: PollutionEntry[];
  risk: string;
  link: string;
}

export interface PollutionSite extends PollutionSiteBase {
  coordinates: { lat: number; lng: number };
}

export interface UnmappedPollutionSite extends PollutionSiteBase {
  coordinates: null;
}

interface SheetColumns {
  source: number;
  identification: number;
  commune: number;
  latitude: number;
  longitude: number;
  activity: number;
  sector: number;
  activityPeriod: number;
  emissionTiming: number;
  localization: number;
  knowledgeLevel: number;
  process: number;
  chemicalFamilies: number;
  chemicalForm: number;
  environmentalCompartment: number;
  transferPathway: number;
  receivingEnvironments: number;
  risk: number;
  link: number;
}

export interface PollutionSitesResult {
  sites: PollutionSite[];
  unmappedSites: UnmappedPollutionSite[];
  lastUpdated: string;
}

function getCellValue(row: GoogleSheetsRow, index: number): string {
  if (index < 0) return "";

  const cell = row.c?.[index];
  if (!cell) return "";

  return String(cell.f ?? cell.v ?? "").trim();
}

function getMeaningfulCellValue(row: GoogleSheetsRow, index: number): string {
  const value = getCellValue(row, index);
  return value === "/" ? "" : value;
}

function getCellNumber(row: GoogleSheetsRow, index: number): number | null {
  const value = getMeaningfulCellValue(row, index).replace(",", ".");
  if (!value) return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findColumn(headers: string[], expectedHeader: string): number {
  const normalizedExpectedHeader = normalizeHeader(expectedHeader);
  const index = headers.findIndex(
    (header) => normalizeHeader(header) === normalizedExpectedHeader,
  );

  if (index === -1) {
    throw new Error(`Missing Google Sheets column: ${expectedHeader}`);
  }

  return index;
}

function getColumns(headerRow: GoogleSheetsRow): SheetColumns {
  const headers = headerRow.c.map((_, index) => getCellValue(headerRow, index));

  return {
    source: findColumn(headers, "Source"),
    identification: findColumn(headers, "Identification"),
    commune: findColumn(headers, "Commune"),
    latitude: findColumn(headers, "Latitude"),
    longitude: findColumn(headers, "Longitude"),
    activity: findColumn(headers, "Activité"),
    sector: findColumn(headers, "Secteur d'activité"),
    activityPeriod: findColumn(headers, "Activité actuelle/passée"),
    emissionTiming: findColumn(headers, "Temporalité de l'émission"),
    localization: findColumn(headers, "Source localisée ou diffuse"),
    knowledgeLevel: findColumn(headers, "Niveau de connaissance"),
    process: findColumn(headers, "Processus d'émission"),
    chemicalFamilies: findColumn(
      headers,
      "Famille(s) chimique(s) de/des polluant(s) identifié(s)",
    ),
    chemicalForm: findColumn(headers, "Forme physico-chimique"),
    environmentalCompartment: findColumn(
      headers,
      "Compartiment environnemental d'émission (eau,air,sol) et nuisance",
    ),
    transferPathway: findColumn(headers, "Voie de transfert"),
    receivingEnvironments: findColumn(headers, "Milieu(x) récepteur(s)"),
    risk: findColumn(headers, "Risque associé"),
    link: findColumn(headers, "Lien du site ou référence de l'ouvrage"),
  };
}

function normalizeActivityStatus(activityPeriod: string): string {
  const normalizedValue = normalizeHeader(activityPeriod);

  if (normalizedValue.startsWith("actuelle")) return "Actuelle";
  if (normalizedValue.startsWith("passee")) return "Passée";

  return activityPeriod || "Non renseignée";
}

function normalizeLocalizationType(
  localizationDetail: string,
  hasCoordinates: boolean,
): string {
  const normalizedValue = normalizeHeader(localizationDetail);

  if (normalizedValue.includes("diffuse")) return "Diffuse";
  if (normalizedValue.includes("localisee")) return "Localisée";

  // Some validated rows currently contain “Ponctuelle” in this spatial column.
  // Their coordinates make them localizable on the map, so they belong with
  // localized sources for filtering purposes.
  if (hasCoordinates) return "Localisée";

  return localizationDetail || "Non renseignée";
}

function getPollutionEntry(
  row: GoogleSheetsRow,
  columns: SheetColumns,
): PollutionEntry | null {
  const entry: PollutionEntry = {
    process: getMeaningfulCellValue(row, columns.process),
    chemicalFamilies: getMeaningfulCellValue(row, columns.chemicalFamilies),
    chemicalForm: getMeaningfulCellValue(row, columns.chemicalForm),
    environmentalCompartment: getMeaningfulCellValue(
      row,
      columns.environmentalCompartment,
    ),
    transferPathway: getMeaningfulCellValue(row, columns.transferPathway),
    receivingEnvironments: getMeaningfulCellValue(
      row,
      columns.receivingEnvironments,
    ),
  };

  return Object.values(entry).some(Boolean) ? entry : null;
}

export async function fetchPollutionSites(): Promise<PollutionSite[]> {
  const result = await fetchAllPollutionSites();
  return result.sites;
}

export async function fetchAllPollutionSites(): Promise<PollutionSitesResult> {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json`;

  const response = await fetch(url, {
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch spreadsheet: ${response.status}`);
  }

  const responseDate = response.headers.get("date");
  const parsedResponseDate = responseDate ? new Date(responseDate) : null;
  const responseTimestamp =
    parsedResponseDate && !Number.isNaN(parsedResponseDate.getTime())
      ? parsedResponseDate.toISOString()
      : new Date().toISOString();
  const text = await response.text();
  const jsonMatch = text.match(
    /google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/,
  );

  if (!jsonMatch) {
    throw new Error("Failed to parse Google Sheets response");
  }

  const data: GoogleSheetsResponse = JSON.parse(jsonMatch[1]);
  const rows = data.table.rows;
  const headerRowIndex = rows.findIndex((row) => {
    const values = row.c.map((_, index) =>
      normalizeHeader(getCellValue(row, index)),
    );
    return values.includes("source") && values.includes("identification");
  });

  if (headerRowIndex === -1) {
    throw new Error("Failed to locate the Google Sheets header row");
  }

  const columns = getColumns(rows[headerRowIndex]);
  const sites: PollutionSite[] = [];
  const unmappedSites: UnmappedPollutionSite[] = [];
  let currentSite: PollutionSiteBase | null = null;

  for (const row of rows.slice(headerRowIndex + 1)) {
    const sourceId = getMeaningfulCellValue(row, columns.source);
    const pollutionEntry = getPollutionEntry(row, columns);

    if (sourceId) {
      const latitude = getCellNumber(row, columns.latitude);
      const longitude = getCellNumber(row, columns.longitude);
      const hasValidCoordinates =
        latitude !== null &&
        longitude !== null &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;
      const activityPeriod = getMeaningfulCellValue(
        row,
        columns.activityPeriod,
      );
      const localizationDetail = getMeaningfulCellValue(
        row,
        columns.localization,
      );

      currentSite = {
        id: sourceId,
        name:
          getMeaningfulCellValue(row, columns.identification) ||
          "Source inconnue",
        commune: getMeaningfulCellValue(row, columns.commune),
        activity: getMeaningfulCellValue(row, columns.activity),
        sector:
          getMeaningfulCellValue(row, columns.sector) || "Non spécifié",
        activityStatus: normalizeActivityStatus(activityPeriod),
        activityPeriod,
        emissionTiming: getMeaningfulCellValue(row, columns.emissionTiming),
        localizationType: normalizeLocalizationType(
          localizationDetail,
          hasValidCoordinates,
        ),
        localizationDetail,
        knowledgeLevel: getMeaningfulCellValue(row, columns.knowledgeLevel),
        pollutions: pollutionEntry ? [pollutionEntry] : [],
        risk: getMeaningfulCellValue(row, columns.risk),
        link: getMeaningfulCellValue(row, columns.link),
      };

      if (hasValidCoordinates) {
        sites.push({
          ...currentSite,
          coordinates: { lat: latitude, lng: longitude },
        });
      } else {
        unmappedSites.push({ ...currentSite, coordinates: null });
      }
    } else if (currentSite && pollutionEntry) {
      currentSite.pollutions.push(pollutionEntry);
    }
  }

  return { sites, unmappedSites, lastUpdated: responseTimestamp };
}

// Sector color mapping for markers and filter chips.
export const sectorColors: Record<string, string> = {
  "Gestion des déchets et effluents": "#8B4513",
  "Carrière et extraction": "#708090",
  "Service secteur routier": "#FF6B35",
  "Traffic routier (tunnel, autoroute..)": "#2F4F4F",
  "Traffic routier": "#2F4F4F",
  "Secteur du décolletage": "#4169E1",
  Industrie: "#9932CC",
  "Production de chaleur": "#DC143C",
  "Production d'énergie électrique": "#C59A00",
  "Tourisme / Activité de loisir": "#2E8B57",
  "Non spécifié": "#999999",
};

export function getSectorColor(sector: string): string {
  if (sectorColors[sector]) return sectorColors[sector];

  const sectorLower = sector.toLowerCase();
  for (const [key, color] of Object.entries(sectorColors)) {
    if (
      sectorLower.includes(key.toLowerCase()) ||
      key.toLowerCase().includes(sectorLower)
    ) {
      return color;
    }
  }

  return "#1d6ab2";
}

export const compartmentColors: Record<string, string> = {
  Air: "#87CEEB",
  Eau: "#1E90FF",
  Sol: "#8B4513",
  Sols: "#8B4513",
  "Sous-sol": "#654321",
  "Nappe phréatique": "#4169E1",
};

export function getCompartmentColor(compartment: string): string {
  if (compartmentColors[compartment]) return compartmentColors[compartment];

  const compartmentLower = compartment.toLowerCase();
  for (const [key, color] of Object.entries(compartmentColors)) {
    if (
      compartmentLower.includes(key.toLowerCase()) ||
      key.toLowerCase().includes(compartmentLower)
    ) {
      return color;
    }
  }

  return "#999999";
}
