export const ATMO_RIGHTS = {
  license: { id: "ODbL-1.0", url: "https://opendatacommons.org/licenses/odbl/1-0/" },
  attribution: "Source ATMO Auvergne - Rhône-Alpes : Mesure de la pollution atmosphérique sur la région Auvergne - Rhône-Alpes",
  metadata: [
    "https://ids.craig.fr/geocat/srv/api/records/4e9c6cda-450c-4e19-a9ff-97095002df5d/formatters/xml",
    "https://ids.craig.fr/geocat/srv/api/records/1b30ec84-e656-466b-96a2-2c0161f3a4b8/formatters/xml",
  ],
  transformations: "Extrait local CCPMB normalisé par l’Institut écocitoyen. Base dérivée publiée sous ODbL 1.0. Dates, unités et statuts de validation conservés. Les mesures peuvent être corrigées ou invalidées ultérieurement par Atmo.",
};
export function rightsForDataset(key) { return key.startsWith("air-") ? ATMO_RIGHTS : {}; }
