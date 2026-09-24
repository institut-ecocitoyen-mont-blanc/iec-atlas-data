# Données de l’atlas IEC

Imports publics pour l’atlas environnemental du Pays du Mont-Blanc, limités aux dix communes de la CCPMB.

- [Manifest et état des imports](https://institut-ecocitoyen-mont-blanc.github.io/iec-atlas-data/manifest.json)
- [Exécutions GitHub Actions](https://github.com/institut-ecocitoyen-mont-blanc/iec-atlas-data/actions)
- [Site consommateur](https://github.com/institut-ecocitoyen-mont-blanc/website)

## Fonctionnement

GitHub Actions démarre à la minute 27 de chaque heure (UTC, sans garantie de ponctualité). Le script utilise des créneaux UTC pour ne charger que les sources dues : inventaire et air chaque heure, eau et Géorisques chaque jour, trafic et IREP chaque mois. Une exécution manuelle peut forcer un groupe ou toutes les sources. Il faut réactiver un workflow public si GitHub le désactive après une longue période d’inactivité.

Chaque import valide et réduit la réponse du fournisseur avant publication. Un échec conserve le dernier fichier valide et sa date de réussite. Un échec initial ne crée pas de faux tableau vide. Pour la baignade, les saisons valides sont publiées indépendamment des saisons indisponibles ; les résultats antérieurs des saisons en échec sont conservés, avec un avertissement. Aucun résultat n’est inventé. Les checkpoints préservent les sources déjà validées en cas d’interruption.

Le workflow commit les données normalisées uniquement lorsqu’elles changent ; le manifest d’exploitation est mis à jour à chaque exécution. Il publie ensuite l’ensemble via GitHub Pages, puis signale les erreurs fournisseur dans un job en échec. Activer les notifications d’échec Actions dans les préférences GitHub des mainteneurs. L’atlas signale aussi les imports en retard ; il ne peut pas réveiller un ordonnanceur GitHub arrêté.

La publication Pages est indépendante du site principal. L’atlas charge ces fichiers directement : aucun jeton dans le navigateur, aucun appel des visiteurs aux fournisseurs. Les fonds de carte restent gérés séparément.

## Contrat v1

`manifest.json` contient `schemaVersion`, `checkedAt` et `datasets`. Chaque entrée renseigne la source, l’intervalle, la dernière tentative, la dernière réussite complète, le statut et le chemin du dernier fichier disponible. Un import partiel a un chemin mais un statut d’erreur ; `lastPublishedAt` n’est pas une réussite complète. Un import initial en échec n’a pas de chemin.

`data/<identifiant>.json` contient `{ schemaVersion: 1, key, data }`. `hash` représente les observations normalisées, hors dates d’import. Le consommateur peut l’utiliser comme paramètre de cache. Les dates de prélèvement, périodes horaires/journalières, unités, qualifications, limites de résultats et précision des coordonnées sont conservées. Une réussite de téléchargement ne signifie jamais que la mesure est récente.

Les fichiers de détail sont chargés à la demande : `river-<id>` et `drinking-<réseau>` (10 résultats maximum), `groundwater-<id>` (200 résultats maximum). Ce ne sont pas des historiques exhaustifs. Les résultats nuls/non quantifiés ne sont pas convertis en zéros. Les captages publics volontairement géolocalisés au chef-lieu restent approximatifs.

## Sources et limites

`georisques` réunit les dossiers SSP d’instruction et les secteurs SIS de l’API publique v1. Les points et emprises sont limités aux dix communes, les dossiers de même nom et emprise regroupés en conservant leurs identifiants, dates et liens. Ni CASIAS ni ICPE ne sont inclus. Si l’une des deux sources échoue, le dernier catalogue complet est conservé. Réutilisation sous [Licence Ouverte](https://www.georisques.gouv.fr/mentions-legales), attribution Ministère de la Transition écologique / BRGM jointe au JSON. Les couleurs distinguent des catégories administratives, pas un niveau de gravité sanitaire. Le groupe manuel `georisques` force uniquement cet import.

| Jeu | Fournisseur / format |
|---|---|
| Inventaire | Google Sheet validé par l’Institut |
| Air | Atmo AURA ArcGIS horaire, complément journalier Sallanches Régie / Passy Chedde |
| Cours d’eau | Hub’Eau / Naïades ; évaluations officielles AERMC via export CSV |
| Eau potable | Hub’Eau, réseaux de distribution et contrôles ARS |
| Baignade | Portail du ministère de la Santé, deux dernières saisons |
| Eaux souterraines | Hub’Eau / ADES, catalogue et analyses vérifiées |
| Trafic | DDT74 / GeoIDE, géométrie et moyenne annuelle |
| Rejets industriels | Archives annuelles IREP, établissements locaux |

Le flux Atmo existant peut être historique : cette migration automatise le transport sans prétendre réparer la fraîcheur des observations. Évaluer le flux national LCSQA séparément. Les fichiers IREP nationaux sont téléchargés temporairement, pas archivés ici. Les résultats Institut fictifs ne font pas partie de ce dépôt.

Les fournisseurs conservent leurs droits et conditions de réutilisation ; les liens de provenance sont dans le manifest. Ne pas appliquer une licence globale aux données de tiers. Ne pas ajouter de données Institut non publiques, de coordonnées confidentielles ou de secrets. Les éventuelles clés futures appartiennent aux secrets Actions.

### Données Atmo : ODbL 1.0

Les bases dérivées `public/data/air-*.json` sont mises à disposition sous [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/), conformément aux métadonnées officielles [horaires](https://ids.craig.fr/geocat/srv/api/records/4e9c6cda-450c-4e19-a9ff-97095002df5d/formatters/xml) et [journalières](https://ids.craig.fr/geocat/srv/api/records/1b30ec84-e656-466b-96a2-2c0161f3a4b8/formatters/xml). Mention : **Source ATMO Auvergne - Rhône-Alpes : Mesure de la pollution atmosphérique sur la région Auvergne - Rhône-Alpes**.

L’Institut a sélectionné le périmètre CCPMB et normalisé les champs sans modifier les mesures. Les fichiers complets de cet extrait dérivé sont téléchargeables librement depuis le manifest. Conserver cette attribution et la licence, et distribuer les bases adaptées sous ODbL conformément à ses conditions. Atmo ne garantit pas les usages de mesures ultérieurement invalidées : les dates et statuts de validation sont préservés. Les autres bases indépendantes et le logiciel ne sont pas placés sous ODbL par cette notice.

Le dépôt conserve seulement des fenêtres locales bornées, pas une archive nationale. Surveiller la taille de l’historique Git ; pour un historique scientifique étendu, utiliser un stockage d’objets plutôt que d’accumuler de gros exports dans Git.

## Développement

Node 22.18+ et npm :

```sh
npm ci
npm test
npm run import                   # seulement les sources dues
IMPORT_MODE=water npm run import # forcer les imports quotidiens
npm run check
```

Ne pas lancer plusieurs imports locaux simultanément. En CI, un groupe de concurrence sérialise import/commit/publication. Le workflow dispose uniquement de `contents: write` pour le commit et de `pages: write` / `id-token: write` pour la publication ; aucun PAT inter-dépôts nécessaire.

Les parseurs et tests de départ proviennent de `institut-ecocitoyen-mont-blanc/website` au commit `8114d37021ea242eba32bc68653a40b5e060625a`, sous `src/atlas`. Ce dépôt est maintenant propriétaire des imports opérationnels. Les types et quelques helpers existent encore côté site : garder le contrat compatible et répercuter explicitement les changements pertinents en attendant un éventuel module partagé.
