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

## Parcel score meaning and information gaps

The property result distinguishes a land-research priority from a homeowner rating. Its
expandable information panel identifies recorded scoring inputs, missing acreage, GIS
outlines versus point locations, lookup failures and checks that the score does not perform.
Live GIS acreage never silently changes a stored score; differences are disclosed. The
scoring date is not presented as the GIS boundary retrieval date.

`parcel-dashboard/score-context.js` supplies the interpretation and record-status logic.
Point explanations must match the score date and reconstruct its components; unavailable
or mismatched explanations show an explicit message. See `PARCEL_SCORE_REVIEW.md` for the
November 14 review and the correction described below. Missing inputs remain disclosed.
Run `node --test scripts/test_score_context.mjs` when changing this logic or replacing a
score snapshot. Also run the existing analytics, search-metrics and property-share checks
when modifying the property-result flow.

### Reproducing the November scoring correction

`scripts/recalculate_sangamon_scores.py` first reproduces every original county score,
every public row and every published explanation from the private November 8 archive.
It then requires a complete, error-free GIS check of the original missing-acreage PINs.
Only positive, agreed recorded acreage that passes the separate parcel-footprint
quality screen is accepted. Polygon area is used to reject suspect parent-tract
totals; it is never used as a replacement acreage. Unscreened GIS candidates fail
closed. The residential deduction now matches the normalized class
`IMPROVED RESIDENTIAL` exactly. Countywide owner-acreage totals are recomputed so a
verified acreage addition also updates holdings points on related parcels.

Keep the source and evidence directories **outside this public checkout**. For the
reviewed release, preserve the November 8 ZIP and matching full CSV in `private-source`,
the original score and explanation JSON in `baseline`, and the verified GIS result in
`gis/acreage-check.json`. All locations are explicit command-line arguments:

```powershell
python -B scripts/recalculate_sangamon_scores.py --source-dir ../parcel-acreage-correction-evidence/private-source --baseline-dir ../parcel-acreage-correction-evidence/baseline --gis ../parcel-acreage-correction-evidence/gis/acreage-check.json --output-root . --evidence-dir ../parcel-acreage-correction-evidence
python -B scripts/test_recalculate_sangamon_scores.py
```

The script writes only the public rankings, grouped explanations and compact acreage
check into this checkout. Its before/after report, corrected full CSV and raw-value
calculation context remain in the external evidence directory. Source date remains
November 8; `model_version`, `calculated_at` and `gis_checked_at` distinguish the rule
correction and GIS retrieval. Reason hashes use LF-normalized ranking bytes. Rebuild
derived summaries and top-ten records before publishing a changed snapshot.

### Representatives by parcel location

`scripts/import_parcel_representatives.py` imports official office-holder directories
and joins all 166 county GIS precinct codes to the county's August 2023 district
chart. Run it with `--evidence-dir` pointing outside this checkout; `--cached` repeats
the import from preserved source responses. It exports only officials' names,
offices, terms and public contact/meeting links, never residential addresses or
voter registration records. School board names are checked against the district's
own current Contact the Board page as well as the county directory.

The dashboard queries county municipal, school, county-board and precinct boundaries
at the selected parcel point. Split precincts preserve multiple possible state or
federal districts; the county voter lookup remains the source for official voter
assignment. Municipality and school district come from boundaries, not ZIP code or
township. Meeting/roll-call links are records portals, not claims that an official
cast a particular vote. Recheck office holders after new terms or appointments begin.

The county card additionally shows the recorded April 7, 2026 CyrusOne final
conditional-use zoning vote. `parcel-dashboard/data/cyrusone-county-vote.json`
preserves the 29 historical seat holders and cites the official minutes, page 31.
It is separate from the March tabling motion and April procedural votes. The chair's
non-vote is kept separate from an abstention or absence. Only a verified name/alias
match attaches the historical vote to today's officeholder; replacement members
show an explicit predecessor notice. An unresolved map match or failed ledger load
never becomes an inferred vote. `scripts/test_representatives.mjs` checks the full
roll call, four changed officeholders, historical aliases and failure states.

Expandable member comments summarize the March 23 and April 7, 2026 written
minutes, with dated page links. `comment_review` records the scope and
`comment_sources` holds the official records. Each historical member's
`commentary` distinguishes explicit final-vote reasons, substantive comments,
questions/procedure and no explanation found in the reviewed minutes. Forecasts
and project assurances remain attributed statements, not verified outcomes.
Earlier remarks never become an inferred reason for the April 7 vote. Invalid
comment data displays an unavailable notice while preserving the verified vote;
comments are never assigned to a successor or used to change a parcel score.

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

The tracker records page views and link-click categories on public pages, including direct
visits to the parcel dashboard and property rankings. `property_search_success` counts one
resolved parcel result per submitted search (including the homepage search handoff). Direct
parcel links, map clicks, street-only results, unsuccessful searches and stale/cancelled
requests do not count as successful searches. The event takes no caller-supplied data.

Addresses, query text, parcel numbers, coordinates and owner information are not sent in
these events. Page URLs omit query strings and fragments, page titles are fixed, referrers
are reduced to their origin, and link events contain categories instead of destination URLs
or visible text. In GA4 Admin > Data streams > Illinois Land Index, keep **Enhanced
measurement OFF** (confirmed November 14, 2026). Google's automatic search, form, link and
history events otherwise operate outside this custom sanitization. Standard page views
and the explicit events still work.

### Keep owner and test visits out

Open `https://illinoislandindex.com/analytics-preferences/#exclude` in each browser/device
used by the owner or a tester. This untracked page saves an exclusion in localStorage with
a first-party cookie fallback and confirms whether it was saved. The shared tracker sets
Google's `ga-disable-G-8JFK3CZ7LE` flag before any analytics call and does not load Google's
script for excluded visits. Use the same page to restore counting.

Only the canonical HTTPS domain and its www host can load analytics. Local development,
preview hosts and `navigator.webdriver` automation are excluded. For ordinary-browser QA
that does not identify itself as WebDriver, use the persistent exclusion link first or append
`?analytics_test=1` to the page being tested. The query flag applies to that page load only;
use the persistent exclusion for tests that navigate between pages.

Exclusion starts when enabled; it does not clean historical reports. Each separate browser,
phone and private-browsing session needs its own setting, and clearing site data can remove it.
Keep all HTML references to `analytics.js` on the same version to avoid cached older trackers.
Run `node --test scripts/test_analytics.mjs scripts/test_search_metrics.mjs scripts/test_property_share.mjs`
before changing tracking, lookup outcomes or sharing. These tests use mocks without sending
Google Analytics traffic.

### Property sharing and previews

The property result includes native sharing where supported, a Copy link action and a
selectable-link fallback if clipboard access fails. Shared URLs are rebuilt from the
canonical dashboard URL and only the selected public PIN; search text and test flags are
excluded. Both scored and unscored parcel links reopen through the existing finder.

The homepage, parcel dashboard and rankings page include Open Graph and large-image card
metadata. `assets/social/property-preview-outline.png` is a 1200 x 630 general illustration,
without real parcel geometry, addresses or owner details. The static host serves the same
general preview for all shared parcels; the actual link opens the selected parcel. Apps
choose how to display and cache previews.

### Site logo

All 25 public HTML pages use the approved Illinois-outline ILI logo. Shared header
styling lives in `assets/brand/brand.css`; the header image is the 19 KB
`assets/brand/ili-state-profile-160.png`. Keep its explicit dimensions and empty
alt text when the linked site name already supplies the accessible label.
Browser icons and the social preview use the same artwork. Keep the full-size
source for future exports, but use small derivatives in page headers.

The listing-export tool allows only self-hosted images through its content security
policy. Its `connect-src 'none'` and `form-action 'none'` restrictions remain intact.

## Deploy

GitHub Pages publishes the root of the `main` branch at `https://illinoislandindex.com/`.
The home page, parcel dashboard, water map and public signals deploy together.

### Optional research support

The homepage and parcel dashboard link to `/support/`. Contributions are optional;
property lookup and published research remain free, without an Illinois Land Index
account. Support does not affect parcel scores or research conclusions.

The support page uses an ordinary outbound Ko-fi link, with no payment widget or
third-party checkout script on this site. Do not add addresses, parcel identifiers,
search terms or analytics IDs to payment links. Existing owner/test exclusions and
sanitized analytics remain in force; an outbound click is not a completed payment.

Before publishing the support page or changing its destination:

- Keep the verified destination `https://ko-fi.com/illinoislandindex` unless the
  owner changes it. Never deploy a placeholder or guessed payment URL.
- Confirm that account is connected to its intended payment recipient and that
  both one-time support and simple monthly support are available.
- Check the public checkout identifies the correct recipient and clearly shows
  the amount, frequency and recurring-payment cancellation information.
- Check the support page and free property lookup on mobile and desktop, without
  submitting a payment during testing. Keep owner and test visits excluded.
