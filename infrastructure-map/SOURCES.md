# Three-county water and parcel layers

Water snapshot downloaded November 10, 2026 local time (UTC timestamp in the manifest).

## Surface water

Publisher: USGS National Map, National Hydrography Dataset (NHD).
Service: <https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer>

| Layer | Included features within the county map boundaries | Use |
| --- | ---: | --- |
| 12 — Waterbody, large scale | 7,130 | Waterbody polygons, including lakes, reservoirs and marshes |
| 6 — Flowline, large scale | 36,395 | Flow network snapshot; map and stream test use Stream/River (460) and Canal/Ditch (336) |
| 9 — Area, large scale | 86 | Other water-area polygons, including river areas |

The downloader first checks counts, then retrieves every result page from a three-county
bounding envelope, clips to the county boundaries and removes empty clips. Counts in the
source envelope are larger than the county totals and are preserved in the manifest.
Coordinates are rounded to six decimals by the source request and simplified with a
0.00001-degree, topology-preserving tolerance. These are approximate screening boundaries.
Small features are omitted from rendering at broad zoom levels, not from parcel calculations.

NHD does not establish present-day flow, potable supply, water rights, public access, utility
service or flood status. This layer is not a comprehensive wetlands inventory or flood map.

## Parcel boundaries

Boundaries are queried in the current map view, not exported from the private tax index.
Each source is count-checked before geometry is requested. Views exceeding 900 parcels
ask the user to zoom; truncated/failed responses produce a status message, not a dry-parcel conclusion.

| County | Published query layer | Requested attribute |
| --- | --- | --- |
| Sangamon | <https://sangis.co.sangamon.il.us/server/rest/services/TyleratENTParcels/MapServer/0> | `TOTACRES` |
| Morgan | <https://services3.arcgis.com/95PFahBF8eyGEfuc/arcgis/rest/services/TaxParcels/FeatureServer/0> | `gross_acre` |
| Macoupin | <https://services.arcgis.com/LYDdxoqTV7fw9teL/arcgis/rest/services/Reach_Parcels/FeatureServer/0> | `GrossAcres` |

Morgan's service was traced through its official GIS department's open-data portal:
<https://morgancounty-il.com/wp/departments/gis-geographic-information-systems/>.
Macoupin's service was traced through the GIS map linked by its assessment office:
<https://macoupincountyil.gov/ova_dep/assessment-office/embed/>.

Only geometry, acreage and county/source context are used. Source-generated IDs and other
attributes are discarded. These GIS boundaries are not surveys. County acreage and mapped
geometric acreage can differ; the overlap percentage uses geometric area consistently.
Water intersections are unioned before acreage is calculated, so duplicate source polygons
do not inflate overlap. The stream test includes boundary touches as intersections.

The existing featured lake, project and facility records retain their own source links in
`data/research-map.json`. Their November 10 research snapshot remains separate from live
parcel geometry and the refreshable NHD snapshot.
