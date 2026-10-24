# Public parcel data sources

Checked 2026-10-24. Importers send an identifying `IllinoisLandIndex/1.0` user agent, use bounded retries, and request only aggregate results or small candidate samples.

## Knoxville / East Tennessee

### Seven state-system counties

- URL: <https://services.arcgis.com/rD2ylXRs80UroD90/arcgis/rest/services/TN_County_Parcel_Map/FeatureServer>
- Owner: Tennessee Comptroller of the Treasury, Division of Property Assessments / TNMap.
- Counties: Anderson, Blount, Campbell, Loudon, Roane, Sevier, and Union.
- Fields mapped: `Parcels_CALC_ACRE` or `Assessment_Data_*_DEEDAC` (acres), `*_CLASS`, `*_LANDUSE`, `*_BLDGS`, `*_LANDMKTVAL`, `*_APPRAISAL`, and `OBJECTID`.
- Terms/disclaimer: “information is presented for graphical reference only.”
- Terms page: <https://www.comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html>
- Why chosen: it is the existing official, public, no-login state parcel service and supports server-side counts and statistics.

### Knox County — no acceptable replacement found

- Retired URL: <https://geoviewer.cot.tn.gov/arcgis/rest/services/GeoViewer/NonImpact_Parcels/MapServer/3>
- State public-use candidate: <https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0>
- State candidate result: its official item description says “Knox ... not included.”
- KGIS candidate: <https://www.kgis.org/arcgis/rest/services/Maps/GlobalSearch/MapServer/0>
- KGIS result: the layer now returns HTTP 401 without authorization. KGIS’s data page says, “Digital data for Knox County can be licensed from KGIS.”
- KGIS terms/data page: <https://www.kgis.org/portal/Products/DigitalData/PurchaseInformation.aspx?portalid=0>
- Fields needed but unavailable from an acceptable source: acreage or square feet, class/type, land use, building count, land value, appraisal, object ID, and polygon geometry.
- Decision: no login, paid license, scraping, or protection bypass is used. The import preserves the 2026-10-15 Knox summary and candidate geometries and marks them stale.

## Indianapolis area

- URL: <https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0>
- Owner: Indiana Geographic Information Office (IGIO), compiled through the Indiana GIS Data Harvest with Indiana local governments.
- Counties: Marion, Hamilton, Hendricks, Boone, Johnson, Hancock, Morgan, and Shelby. These are exactly the requested core and surrounding counties; no adjustment was needed.
- Fields mapped: `county_fips` (county filter), `objectid` (aggregate/group counts only), `dlgf_prop_class_code` (property class), `tax_township` (candidate context), `source_originator` (provenance), `loaddate` (source date), and polygon geometry / `SHAPE__Area` (ordering). Candidate acreage is calculated geodesically from returned public polygon coordinates.
- Availability statement: “provide public access to GIS data and framework data in locations throughout Indiana.”
- Policy page: <https://www.in.gov/gis/indiana-gis-law/>
- Why chosen: it is the IGIO’s documented current service, is public without login, covers all eight counties in one stable schema, supports server-side counts/grouping, and is updated annually.
- Limitation: the layer has no acreage, assessed-value, building-count, or market-value attribute. Aggregate acreage totals/buckets and valuation statistics are therefore shown as unavailable, not estimated. The small candidate sample reports geometry-derived acreage for screening only.
