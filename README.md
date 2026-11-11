# Illinois Land Index

Public website for the Illinois Land Index. Its parcel dashboard, water map and county signals are served from this repository at `illinoislandindex.com`.

The repo also includes public market-kit dashboards at:

```text
consumer-debt-dashboard/index.html
knoxville-market-dashboard/index.html
indianapolis-market-dashboard/index.html
```

This repository is intentionally public-safe:

- No parcel owner records
- No mailing-address exports
- No generated CSV/XLSX tax data
- No saved account or watchlist records
- No individual consumer debt records

The Illinois consumer-debt dashboard uses aggregate public datasets and Census context only.
It also includes CFPB consumer credit trend context for Illinois and national markets.

The Knoxville-East Tennessee market kit covers the I-75 / Knoxville / Maryville land search corridor
and currently includes FDIC credit-access locations for Anderson, Blount, Campbell, Knox, Loudon,
Roane, Sevier, and Union counties. It defines the next import stack for Tennessee parcel assessment,
high-cost credit, housing distress, flood, slope, soil, and access layers.

The Knoxville kit also includes a parcel and assessment source registry at:

```text
knoxville-market-dashboard/data/processed/parcel_assessment_sources.json
knoxville-market-dashboard/data/processed/parcel_summary.json
```

The registry tracks county assessor, assessment, and GIS source links plus the parcel scoring model.
The parcel summary is a public-safe aggregate import from Tennessee ArcGIS parcel services. It excludes
owner names, mailing addresses, parcel IDs, and individual parcel geometry.

The Indianapolis-area kit covers Marion, Hamilton, Hendricks, Boone, Johnson, Hancock, Morgan, and Shelby
counties using the Indiana Geographic Information Office's current statewide parcel service. Source URLs,
field mappings, terms notes, and known limitations for both markets are recorded in `DATA_SOURCES.md`.

The latest public Illinois/Sangamon signal counts live at:

```text
data/public-signal-summary.json
data/public-signal-delta.json
```

The summary is generated from the Chatham/Sangamon data-processing repository by `export_public_signal_summary.js`.
It includes aggregate score bands, tax timing counts, owner-rollup counts, acreage buckets, terrain readiness,
township summaries, and property-class summaries. It intentionally excludes owner names, mailing addresses,
site addresses, legal descriptions, and parcel IDs. The delta file compares the newest public summary to the previous
public summary and powers the "what changed" panel on the Latest Land Signals page.

To refresh the Knoxville parcel summary:

```powershell
node scripts\import_knoxville_parcel_summary.mjs
```

To refresh every public land source locally:

```powershell
node scripts\refresh_public_land_data.mjs
```

GitHub Actions also runs `.github/workflows/refresh-public-land-data.yml` every morning and commits refreshed public-safe
Knoxville, Indianapolis, Gilpin, and Colorado tax files when source data changes. Sources run independently and a failed
source's last-good files are restored. The final workflow check is red only when every source failed or when any source
has no successful refresh within `PUBLIC_DATA_STALE_DAYS` (default 7); otherwise partial recent outages remain green.
The workflow can also be started manually from the repository's **Actions** tab.

## Infrastructure research map

The Central Illinois map is at `infrastructure-map/index.html`, linked from the home page,
Sangamon guide and Chatham page. It combines public water-source geometry, a union of the proposed
CyrusOne project footprint, county/municipal context and ten institutional/project site records.
The map distinguishes documented facilities, proposed/development projects and historical or reported
references; ten records do not mean ten verified operating data centers.

`infrastructure-map/data/research-map.json` is a November 10, 2026 research snapshot with source links.
It contains public institutional/project locations, not private parcel-owner records, tax exports,
watchlists, emails or correspondence. Its project footprint is not an ownership layer. Dashed water
links are schematic relationships, not surveyed pipes or proof of a signed or operating connection.
The existing aggregate land signals remain separate; the map does not infer parcel value or utility capacity.

The page is buildless: edit `map.js`, `map.css`, `site.css`, the page markup or the JSON directly.
D3 7.9.0 and its license are vendored in `infrastructure-map/vendor/` so map rendering does not
depend on a CDN. Map preferences are saved in browser-local storage only. The sitewide analytics
script is retained; no map coordinates or selections are sent to it by the map code.

### Water and parcel layers

The map now also includes USGS NHD waterbodies, flowlines and water areas for Sangamon,
Morgan and Macoupin counties. The compressed snapshot is `infrastructure-map/data/three-county-water.json.gz`;
the adjacent manifest records counts, source layers, download time and precision. Refresh with
`python scripts/import_three_county_water.py` (requires Shapely). The import verifies source pagination,
clips features to the three map county boundaries and retains a last-good snapshot on source-query failure.
It is not a complete inventory of floodplains, wetlands, groundwater or utility connections.

Parcel boundaries load on demand from the counties' published GIS services. Requests use acreage
fields only; returned geometry is reduced to county, acreage and source URL. The map does not fetch
owner names, mailing addresses, tax records or watchlists. Broad/dense views ask users to zoom in;
an incomplete response is never presented as complete. County services require network access.

Parcel water screening uses Turf 7.2.0, vendored with its license. Polygon intersections are unioned
before calculating acreage to avoid double-counting. Stream/canal intersections exclude artificial
flow paths. Measurements are approximate and do not establish water rights, service, flood risk,
year-round flow or buildable acreage. No ranking or opportunity-score change is made.

The public parcel dashboard at `parcel-dashboard/` accepts a Sangamon PIN or street address and city. It queries the county GIS directly and links to county tax and GIS records. The water-map link passes an interior coordinate. The map removes those parameters before analytics loads and selects the containing county boundary within the three-county extent.

Run `node scripts/test_parcel_water.mjs` for geometry checks covering intersections, holes,
duplicate areas and artificial flow paths.

To check interactions, install Python Playwright with Chromium, then run
`python scripts/test_infrastructure_map.py`. The check starts and stops its own local server.

## Local Preview

Serve the repository root with a static server to use the home page, parcel dashboard and map together.

```powershell
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Analytics

Sitewide analytics and click tracking live in `analytics.js`.

Google Analytics 4 is configured for `illinoislandindex.com` with measurement ID:

```js
const GA_MEASUREMENT_ID = "G-8JFK3CZ7LE";
```

The tracker records page views plus link-click events for the Illinois dashboard, debt context,
Knoxville dashboard and research pages. The parcel lookup page omits analytics.

## Deploy

GitHub Pages publishes the root of the `main` branch at `https://illinoislandindex.com/`.
The home page, parcel dashboard, water map and public signals deploy together.
