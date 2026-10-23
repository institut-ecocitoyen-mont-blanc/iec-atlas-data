# Données de l’atlas IEC

Imports publics pour l’atlas environnemental du Pays du Mont-Blanc, limités aux dix communes de la CCPMB.

- [Manifest et état des imports](https://institut-ecocitoyen-mont-blanc.github.io/iec-atlas-data/manifest.json)
- [Exécutions GitHub Actions](https://github.com/institut-ecocitoyen-mont-blanc/iec-atlas-data/actions)
- [Site consommateur](https://github.com/institut-ecocitoyen-mont-blanc/website)

## Fonctionnement

GitHub Actions est programmé aux minutes 27 et 57 de chaque heure (UTC, sans garantie de ponctualité). Ces deux opportunités réduisent la dépendance à un déclenchement unique ; les créneaux UTC de l’importeur évitent les requêtes en double. Inventaire et air sont chargés chaque heure, eau et Géorisques chaque jour, trafic et IREP chaque mois. Après un échec, une nouvelle tentative est permise au prochain créneau horaire, sans attendre le lendemain ou le mois suivant. Une exécution manuelle peut forcer un groupe ou toutes les sources. Il faut réactiver un workflow public si GitHub le désactive après une longue période d’inactivité.

Diagnostic du 10 octobre 2026 : les runs programmés étaient créés à plusieurs heures d’intervalle, alors que le job du run `38011667624` démarrait quatre secondes après sa création et terminait en moins de deux minutes. Le retard observé précède donc les jobs d’import, et non leur groupe de concurrence. [GitHub documente les retards et suppressions possibles des déclenchements programmés](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows). Le second déclenchement est une atténuation, pas une garantie. Une cadence horaire fiable nécessiterait un ordonnanceur externe déclenchant `workflow_dispatch` ; aucun nouveau service ni secret n’est configuré ici.

Chaque import valide la réponse du fournisseur avant publication. Un échec conserve le dernier fichier valide et sa date de réussite. Un échec initial ne crée pas de faux tableau vide. Pour la baignade historique, toutes les saisons découvertes doivent être récupérées avant remplacement de l’export précédent. Aucun résultat n’est inventé. Les checkpoints préservent les sources déjà validées en cas d’interruption.

Le workflow commit les données normalisées uniquement lorsqu’elles changent ; le manifest d’exploitation est mis à jour à chaque exécution. Il publie ensuite l’ensemble via GitHub Pages, puis signale les erreurs fournisseur dans un job en échec. Activer les notifications d’échec Actions dans les préférences GitHub des mainteneurs. L’atlas signale aussi les imports en retard ; il ne peut pas réveiller un ordonnanceur GitHub arrêté.

La publication Pages est indépendante du site principal. L’atlas charge ces fichiers directement : aucun jeton dans le navigateur, aucun appel des visiteurs aux fournisseurs. Seules les tuiles du fond OpenStreetMap restent gérées séparément. Le diagnostic global des imports est disponible dans la console du navigateur, sans bannière technique ; les dates et limites des mesures restent dans les fiches.

### Indice Atmo communal

`atmo-index` est un export indépendant sous ODbL 1.0, vérifié chaque heure pour récupérer la publication quotidienne et ses corrections. Le WFS officiel `ind_aura:vuemat_agol_indices_2021` est limité aux dix communes et aux échéances de la veille au lendemain. Le groupe manuel `atmo-index` ne recharge que cet export, sans clé nécessaire. La date d’échéance est distincte de la date de diffusion : un indice publié hier peut qualifier aujourd’hui. Le site utilise uniquement l’échéance correspondant à la date du jour en Europe/Paris, avec les six couleurs et qualificatifs officiels ; aucun repli sur hier, demain ou une mesure de station. Les pins gardent les coordonnées des stations. En cas d’échec, le dernier snapshot est conservé, mais seul un indice applicable au jour courant peut colorer le pin. Source et licence vérifiées dans `src/atlas/docs/atmo-index-2026-10-05.md`.

### Geod’air : station Passy

Le secret Actions `GEODAIR_API_KEY` est transmis uniquement aux étapes d’import et de reprise historique, dans l’en-tête `apikey` du domaine officiel Geod’air. Il n’est jamais publié ni transmis au navigateur. Le groupe manuel `geodair` charge les deux exports ; même les modes forcés respectent une tentative par créneau UTC d’une heure. Ne pas lancer des imports locaux et CI avec la même clé dans le même créneau.

- `geodair-hourly` : station FR33220, fenêtre glissante de sept jours, PM₂.₅, PM₁₀, NO₂, O₃, NO et NOₓ, chaque heure.
- `geodair-history` : moyennes annuelles depuis 2013 jusqu’à la dernière année complète et prélèvements de benzo[a]pyrène depuis le début de l’année précédente, chaque mois.

Les exportations sont asynchrones : une génération, puis téléchargement du même identifiant en cas de réponse 412. Les dates du fournisseur sont UTC. Type de valeur, validité et code qualité restent distincts ; validité inférieure à 1 donne une valeur affichable null, sans supprimer les champs source. Pas de fusion avec les séries régionales. Les codes NO/NOₓ et les statistiques historiques n’entrent pas dans le repère horaire de couleur des pins. Les mesures peuvent être révisées. Toute erreur conserve le dernier export valide.

Ces deux jeux indépendants portent l’attribution Atmo Auvergne-Rhône-Alpes · Geod’air / LCSQA-Ineris et la Licence Ouverte indiquée dans les [CGU](https://www.geodair.fr/donnees/api#block-useragreementsblockforgeodairgp), sans version explicitement annoncée. Ne pas leur appliquer la notice ODbL du flux régional. L’accès standard ne couvre pas les stations complémentaires Sallanches Régie et Passy Chedde : les exports régionaux `air-*` restent nécessaires.

### Nouvelles couches : groupe `overlays`

Six nouveaux exports sont vérifiés mensuellement par le planificateur existant. `IMPORT_MODE=overlays npm run import` ou le choix manuel `overlays` force uniquement ces sources :

| Identifiant | Contenu | Licence |
|---|---|---|
| `pesticide-purchases` | Achats annuels de substances actives depuis 2013, zones postales 74190, 74700, 74120, 74170, 74920 | Licence Ouverte 2.0 |
| `cerema-light` | Séries mensuelles de radiance des dix communes, édition communale 2026 | Licence Ouverte 2.0 |
| `atmo-model-pm25`, `atmo-model-pm10`, `atmo-model-no2`, `atmo-model-o3` | Rendus cartographiques Atmo 2025, O₃ sur 2023–2025 | ODbL 1.0 |

Pesticides : `quantite` de l’API est en kg de substance active, jamais en litres de produit commercial. Les pages sont toutes chargées avant validation du décompte. Les valeurs confidentielles, absentes ou invalides restent null ; elles ne sont pas remplacées par zéro. Les totaux portent sur les zones postales entières, pas sur des parcelles ou communes individuelles. La géométrie d’affichage rassemble nos communes par code postal : ce n’est pas un découpage postal officiel, ni une répartition des achats dans le territoire. Source : [Hub’Eau BNV-D](https://www.data.gouv.fr/dataservices/hubeau-vente-et-achat-de-produits-phytopharmaceutiques).

Cerema : seuls les dix enregistrements communaux sont conservés, pas la couche infracommunale. La moyenne concerne l’empreinte lumineuse retenue, pas une radiance uniforme dans chaque quartier. Source et licence : [catalogue Cerema](https://www.data.gouv.fr/datasets/cartographie-nationale-des-pratiques-declairage-nocturne).

Atmo : `scripts/atmo-model-export.mjs` demande quatre images PNG au WMS officiel, vérifie format/dimensions et les masque aux dix communes avant publication. Chaque JSON contient une image PNG base64, son emprise `bbox` en EPSG:3857, largeur/hauteur, période, indicateur et URL de reproduction. Maximum 4096 pixels sur le grand côté (environ 8 m au sol au centre du territoire) : image de présentation, pas grille de concentrations interrogeable. Les couleurs d’origine ne sont pas reclassées. La transformation et ses paramètres sont ouverts ; [la base originale](https://depot.atmo-aura.fr/modelisation/opendata_geotiff/2025/) reste sous [ODbL 1.0](https://www.data.gouv.fr/datasets/cartes-annuelles-2025). La période 2025 est épinglée intentionnellement : passer à une nouvelle édition nécessite aussi de vérifier et mettre à jour les légendes du site.

Les six imports réutilisent les checkpoints, licences par jeu, hash des observations, et conservation du dernier résultat valide. Un échec fournisseur n’efface jamais un export utilisable. Les parseurs opérationnels sont dans ce dépôt ; leurs homologues côté site ne pilotent pas GitHub Actions.

## Contrat v1

`manifest.json` contient `schemaVersion`, `checkedAt` et `datasets`. Chaque entrée renseigne la source, l’intervalle, la dernière tentative, la dernière réussite complète, le statut et le chemin du dernier fichier disponible. Un import partiel a un chemin mais un statut d’erreur ; `lastPublishedAt` n’est pas une réussite complète. Un import initial en échec n’a pas de chemin.

Les détails d’eaux souterraines absents du dernier catalogue validé portent `retiredAt`. Leurs snapshots et dates restent conservés et consultables, mais ils sont exclus des imports planifiés et du suivi des retards. Une réapparition dans un catalogue valide réactive le détail. Un échec de catalogue, une réponse partielle ou vide ne peut pas retirer de stations.

`data/<identifiant>.json` contient `{ schemaVersion: 1, key, data }`. `hash` représente les observations normalisées, hors dates d’import. Le consommateur peut l’utiliser comme paramètre de cache. Les dates de prélèvement, périodes horaires/journalières, unités, qualifications, limites de résultats et précision des coordonnées sont conservées. Une réussite de téléchargement ne signifie jamais que la mesure est récente.

Les analyses `river-<id>`, `drinking-<réseau>` et `groundwater-<id>` sont importées sur toute la période accessible, sans limite de rétention de 10/200 résultats. La taille de page n’est plus une limite de collecte. Les dates extrêmes et le décompte global sont vérifiés ; les plages volumineuses sont divisées par dates avant pagination. Les bornes de fin Hub’Eau, tronquées à minuit pour les nappes et l’eau potable, sont demandées au jour suivant puis filtrées sans recouvrement. Chaque page doit être complète et rester dans le périmètre. Une erreur de page, une pagination répétée ou un décompte modifié rejette la mise à jour entière et conserve l’export précédent. Les réseaux historiques, même absents de la desserte actuelle, sont identifiés dans `drinking-network-catalogue` et archivés sans les ajouter à la desserte actuelle des communes.

Les fichiers gardent une petite propriété `data` compatible avec les anciennes versions du site. **Cette propriété est un aperçu, pas l’export complet** : l’enveloppe `archive` donne la liste ordonnée des fragments gzip immuables `history/<clé>/<sha256>.json.gz`, leur SHA-256 et leur décompte. `field: "$"` remplace le tableau `data`, `field: "analyses"` ou `"records"` remplace cette propriété de `data`. Le consommateur doit lire tous les fragments et vérifier leurs totaux. Le site charge les fragments à l’ouverture d’une fiche ; la pagination de présentation ne supprime aucun résultat. Les enregistrements source des nappes sont conservés dans `source`, y compris méthodes, seuils et qualifications. Valeurs nulles/non quantifiées jamais converties en zéros ; coordonnées protégées jamais précisées artificiellement.

### Reprise de tout l’historique (octobre 2026)

`npm run backfill` maintient `history-catalogue.json`, avec **toutes les partitions découvertes** et leurs états pending/ok/error/credentials-required. Le workflow exécute jusqu’à huit partitions par passage (`HISTORY_TASK_BUDGET`), puis reprend les travaux les moins récemment tentés. Il s’agit d’un budget d’exécution, pas d’une coupure historique. Les dates de réussite, erreurs et partitions non encore importées restent explicites. Une première migration n’est complète que lorsque le catalogue ne signale plus de partitions manquantes/échouées ni d’échecs de découverte.

- **Eaux** : toutes les analyses disponibles des stations et réseaux locaux ; les dix communes restent la limite géographique, pas une limite de dates. Relecture complète quotidienne pour prendre en compte corrections et retraits source.
- **Air régional** : toutes les espèces et lignes horaires/journalières exposées par les deux catalogues ArcGIS, sur les stations locales. Périodes et données brutes archivées séparément de la synthèse utilisée par la carte. Un fournisseur peut lui-même ne publier qu’une fenêtre ; l’import ne prétend pas récupérer une période absente.
- **Geod’air** : partitions horaires mensuelles depuis le début documenté (2013), statistiques annuelles et analyses différées par année, avec lignes et colonnes source conservées même pour les polluants anciens/valeurs invalides. Clé serveur uniquement ; pas de répétition d’une même partition dans le créneau horaire. Sans secret local, les partitions restent explicitement en attente de credentials, pas faussement vides.
- **Indices Atmo** : toute la table communale accessible, indépendamment de la fenêtre veille/aujourd’hui/demain utilisée pour colorer les pins.
- **Baignade** : toutes les saisons du sélecteur officiel de chaque site (2022–2026 lors du contrôle), pas seulement deux saisons. Les saisons déjà archivées restent conservées si elles disparaissent du sélecteur. Une découverte ou une saison indisponible ne remplace pas le dernier export complet.
- **IREP** : toutes les archives annuelles annoncées depuis 2003, conservées sous `emissions-<année>` ; le résumé courant garde sa clé `emissions`.
- **Trafic** : toutes les colonnes annuelles TMJA/poids lourds du WFS sont conservées dans `segments[].history` ; le résumé et la géométrie continuent de représenter l’édition actuelle du fournisseur, pas une reconstitution des tracés historiques.
- **Évaluations AERMC** : toutes les lignes/années de l’export courant sont conservées dans `history`, distinctes du dernier état par station.
- **Modèles Atmo** : découverte des éditions WMS disponibles pour les indicateurs annuels PM₂.₅/PM₁₀/NO₂ et dépassements O₃ ; archive du rendu local et de sa propre légende. Ni assimilation des périodes O₃ ni réutilisation de la légende 2025 pour une autre édition. Ce sont toujours des rendus, pas des grilles numériques GeoTIFF.
- **Cerema et achats de pesticides** : tous les mois/années exposés par leurs sources, sans restriction de période côté achats.
- **Inventaire et Géorisques** : les services utilisés fournissent un état courant, pas un historique reconstituable. Chaque version désormais observée est conservée, sans inventer les versions antérieures.

Chaque changement de contenu garde aussi une révision immuable sous `revisions/<clé>/`, indexée par `index.json`. Cela protège l’historique local des changements de fenêtre ou suppressions source ; une révision archivée n’est pas pour autant une donnée encore validée par le fournisseur. Les contrôles de publication vérifient les fragments et leurs hashes. Les extractions ne sont publiées qu’après validation ; un échec n’est jamais assimilé à l’absence de pollution.

## Sources et limites

`georisques` réunit les dossiers SSP d’instruction et les secteurs SIS du [WFS officiel](https://www.georisques.gouv.fr/services?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities), avec repli sur l’API publique v1, ainsi que les installations et autres sites inspectés de `/api/v1/installations_classees`. Les points et emprises sont limités aux dix communes, les dossiers sols de même nom et emprise regroupés en conservant leurs identifiants, dates et liens. Les installations restent séparées par code AIOT, y compris les régimes « Non ICPE » ; leurs dates d’inspection et de mise à jour ne sont pas confondues. CASIAS n’est pas inclus. Tous les décomptes et pages doivent être complets, installations comprises ; sinon le dernier catalogue complet est conservé. Les coordonnées manquantes ne sont pas remplacées par des centres de communes : les exclusions sont comptées dans `installations`. Le WFS ne publie pas certaines dates et certains statuts SIS : ils restent non renseignés. Le JSON renseigne `transport` (`wfs+rest` pour le mode mixte) et `sourceUrls`. Réutilisation sous [Licence Ouverte](https://www.georisques.gouv.fr/mentions-legales), attribution Ministère de la Transition écologique / BRGM jointe au JSON. Les couleurs distinguent des catégories administratives, pas un niveau de gravité sanitaire. Le groupe manuel `georisques` force uniquement cet import.

Le groupe manuel `bathing` force uniquement les pages de baignade. Le portail peut répondre lentement : chaque requête dispose de 30 secondes et d’une relance bornée pour les erreurs temporaires, avec trois requêtes simultanées au maximum. Les identifiants, années et colonnes restent strictement vérifiés ; les échecs de parsing ne sont pas convertis en résultats vides valides.

| Jeu | Fournisseur / format |
|---|---|
| Inventaire | Google Sheet validé par l’Institut |
| Air | Atmo AURA ArcGIS horaire, complément journalier Sallanches Régie / Passy Chedde |
| Cours d’eau | Hub’Eau / Naïades ; évaluations officielles AERMC via export CSV |
| Eau potable | Hub’Eau, réseaux de distribution et contrôles ARS |
| Baignade | Portail du ministère de la Santé, toutes les saisons disponibles |
| Eaux souterraines | Hub’Eau / ADES, catalogue et analyses vérifiées |
| Trafic | DDT74 / GeoIDE, géométrie et moyenne annuelle |
| Rejets industriels | Archives annuelles IREP, établissements locaux |

Le flux Atmo existant peut être historique : cette migration automatise le transport sans prétendre réparer la fraîcheur des observations. Évaluer le flux national LCSQA séparément. Les fichiers IREP nationaux sont téléchargés temporairement, pas archivés ici. Les résultats Institut fictifs ne font pas partie de ce dépôt.

Les fournisseurs conservent leurs droits et conditions de réutilisation ; les liens de provenance sont dans le manifest. Ne pas appliquer une licence globale aux données de tiers. Ne pas ajouter de données Institut non publiques, de coordonnées confidentielles ou de secrets. Les éventuelles clés futures appartiennent aux secrets Actions.

### Données Atmo : ODbL 1.0

Les bases dérivées `public/data/air-*.json` sont mises à disposition sous [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/), conformément aux métadonnées officielles [horaires](https://ids.craig.fr/geocat/srv/api/records/4e9c6cda-450c-4e19-a9ff-97095002df5d/formatters/xml) et [journalières](https://ids.craig.fr/geocat/srv/api/records/1b30ec84-e656-466b-96a2-2c0161f3a4b8/formatters/xml). Mention : **Source ATMO Auvergne - Rhône-Alpes : Mesure de la pollution atmosphérique sur la région Auvergne - Rhône-Alpes**.

L’Institut a sélectionné le périmètre CCPMB et normalisé les champs sans modifier les mesures. Les fichiers complets de cet extrait dérivé sont téléchargeables librement depuis le manifest. Conserver cette attribution et la licence, et distribuer les bases adaptées sous ODbL conformément à ses conditions. Atmo ne garantit pas les usages de mesures ultérieurement invalidées : les dates et statuts de validation sont préservés. Les autres bases indépendantes et le logiciel ne sont pas placés sous ODbL par cette notice.

Le dépôt conserve des historiques locaux compressés, pas une archive nationale. Surveiller leur croissance et celle des révisions Git ; migrer vers du stockage objet si les limites de GitHub Pages/Git deviennent contraignantes. Ne jamais résoudre un problème de taille en tronquant silencieusement les mesures.

## Développement

Node 22.18+ et npm :

```sh
npm ci
npm test
npm run import                   # seulement les sources dues
IMPORT_MODE=water npm run import # forcer les imports quotidiens
npm run backfill                # reprendre le prochain lot historique
npm run check
```

Ne pas lancer plusieurs imports locaux simultanément. En CI, un groupe de concurrence sérialise import/commit/publication. Le workflow dispose uniquement de `contents: write` pour le commit et de `pages: write` / `id-token: write` pour la publication ; aucun PAT inter-dépôts nécessaire.

Les parseurs et tests de départ proviennent de `institut-ecocitoyen-mont-blanc/website` au commit `8114d37021ea242eba32bc68653a40b5e060625a`, sous `src/atlas`. Ce dépôt est maintenant propriétaire des imports opérationnels. Les types et quelques helpers existent encore côté site : garder le contrat compatible et répercuter explicitement les changements pertinents en attendant un éventuel module partagé.
