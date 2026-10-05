# Daily commune Atmo index — verified 5 October 2026

## Source and reuse

The Atmo Auvergne-Rhône-Alpes-owned [CRAIG metadata record](https://ids.craig.fr/geocat/srv/api/records/b3e869c1-82f7-4345-80d6-c80dba21c0ae/formatters/xml) explicitly grants **ODbL**, links [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), and requests this attribution: “Source ATMO Auvergne - Rhône-Alpes : Indice communal de la qualité de l'air sur la région Auvergne - Rhône-Alpes”. It identifies the WFS dataset below, daily updates around 14:00 local time, and forecasts based on corrected CHIMERE modelling. The commune index reflects population exposure, not the reading at a station coordinate.

Keep this export under ODbL with its attribution and source/update dates. Keep it distinct from the Geod'air measurements and their licence.

## Current feed and contract

Use the [official regional WFS](https://sig.atmo-auvergnerhonealpes.fr/geoserver/ind_aura/wfs?service=WFS&request=GetCapabilities), **not the old ArcGIS `Indice_ATMO` service**. The latter's newest Passy/Sallanches records observed by the implementation agent stopped in January 2024.

Verified read-only query:

```text
GET https://sig.atmo-auvergnerhonealpes.fr/geoserver/ind_aura/wfs
service=WFS
version=2.0.0
request=GetFeature
typeNames=ind_aura:vuemat_agol_indices_2021
outputFormat=application/json
CQL_FILTER=code_zone='74208'
sortBy=date_ech D
count=6
```

Response is GeoJSON. Properties include `code_zone` (INSEE string), `lib_zone`, `type_zone`, `date_ech` (day represented as midnight UTC), `date_dif` (publication timestamp), `code_qual`, `lib_qual`, `coul_qual`, five pollutant sub-index codes, and `source`. Default geometry is EPSG:2154; commune coordinates must **not** replace station coordinates.

Observed at 08:43 UTC on 5 October 2026: Passy (`74208`) had an index for **2026-10-05**, code **2**, **Moyen**, **#50ccaa**, published **2026-10-04T11:09:50Z**. A 6 October forecast was also present. A prior publication date does not make today's forecast stale: select by `date_ech`, not the newest row or publication date. If no row applies to today's Europe/Paris calendar date, use an unavailable/neutral state. Keep the source publication timestamp separate.

## Official colours and labels

The [official communication kit](https://www.atmo-auvergnerhonealpes.fr/sites/aura/files/content/migrated/atoms/files/atmo_ppt-kit-com-nouvel-indice-v2_0.pdf) prohibits altering index colours and qualifiers. The [updated usage charter](https://www.atmo-auvergnerhonealpes.fr/sites/aura/files/medias/documents/2024-12/Charte%20d%27utilisation%20de%20l%27indice%20Atmo.pdf) states that colours and qualifiers are mandatory, while smileys are optional.

| Code | Qualifier | Colour |
| --- | --- | --- |
| 1 | Bon | `#50f0e6` |
| 2 | Moyen | `#50ccaa` |
| 3 | Dégradé | `#f0e641` |
| 4 | Mauvais | `#ff5050` |
| 5 | Très mauvais | `#960032` |
| 6 | Extrêmement mauvais | `#872181` |

The older kit has an inconsistent duplicate extreme-colour swatch (`#7D2181`); the live WFS confirms **#872181** for code 6 (queried `CQL_FILTER=code_qual=6`, `count=1`, Désertines, 25 July 2026). Prefer validated provider codes/colours and retain the qualifier in the legend, tooltip, and station detail. Do not collapse the six official classes into generic green/orange/red categories.

The display should say **“Indice Atmo · commune de Passy · [date]”**, clearly distinguish the daily commune forecast from hourly station measurements, and leave all station measurement cards/history intact.
