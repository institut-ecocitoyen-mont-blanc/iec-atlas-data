export const ATMO_RIGHTS = {
  license: { id: "ODbL-1.0", url: "https://opendatacommons.org/licenses/odbl/1-0/" },
  attribution: "Source ATMO Auvergne - Rhône-Alpes : Mesure de la pollution atmosphérique sur la région Auvergne - Rhône-Alpes",
  metadata: [
    "https://ids.craig.fr/geocat/srv/api/records/4e9c6cda-450c-4e19-a9ff-97095002df5d/formatters/xml",
    "https://ids.craig.fr/geocat/srv/api/records/1b30ec84-e656-466b-96a2-2c0161f3a4b8/formatters/xml",
  ],
  transformations: "Extrait local CCPMB normalisé par l’Institut écocitoyen. Base dérivée publiée sous ODbL 1.0. Dates, unités et statuts de validation conservés. Les mesures peuvent être corrigées ou invalidées ultérieurement par Atmo.",
};
export const GEORISQUES_RIGHTS = {
  license: { id: "etalab-2.0", url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/" },
  attribution: "Géorisques · Ministère de la Transition écologique / BRGM",
  metadata: ["https://www.georisques.gouv.fr/mentions-legales"],
  transformations: "Dossiers d’instruction SSP et secteurs SIS limités aux dix communes de la CCPMB. Emprises découpées aux limites communales, dossiers de même nom et emprise regroupés. Aucune classe sanitaire calculée.",
};
const OPEN_LICENSE = { id: "etalab-2.0", url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/" };
export function rightsForDataset(key) {
  if (key.startsWith("air-")) return ATMO_RIGHTS;
  if (key === "georisques") return GEORISQUES_RIGHTS;
  if (key.startsWith("atmo-model-")) return {
    license: ATMO_RIGHTS.license,
    attribution: "Source ATMO Auvergne - Rhône-Alpes : Cartes annuelles 2025",
    metadata: ["https://www.data.gouv.fr/datasets/cartes-annuelles-2025", "https://depot.atmo-aura.fr/modelisation/opendata_geotiff/2025/"],
    transformations: "Rendu WMS EPSG:3857 à la palette officielle, limité à 4096 pixels sur le grand côté et masqué aux dix communes CCPMB. Image de présentation, pas une grille de concentrations numériques. Code et paramètres de transformation publiés ; base source sous ODbL 1.0.",
  };
  if (key === "cerema-light") return {
    license: OPEN_LICENSE, attribution: "Cerema · OFB · DarkSkyLab — Cartographie nationale des pratiques d’éclairage nocturne, édition communale 2026",
    metadata: ["https://www.data.gouv.fr/datasets/cartographie-nationale-des-pratiques-declairage-nocturne"],
    transformations: "Extraction des dix communes CCPMB, radiance mensuelle et dates estimées de changement. Pas de données infracommunales.",
  };
  if (key === "pesticide-purchases") return {
    license: OPEN_LICENSE, attribution: "OFB · BNV-D · Agences de l’eau / Hub’Eau — achats de substances actives",
    metadata: ["https://www.data.gouv.fr/dataservices/hubeau-vente-et-achat-de-produits-phytopharmaceutiques"],
    transformations: "Achats depuis 2013 pour les zones postales 74190, 74700, 74120, 74170 et 74920. Masses en kg ; quantités absentes ou confidentielles conservées à null. Pas de répartition entre communes ni de mesure de contamination.",
  };
  return {};
}
