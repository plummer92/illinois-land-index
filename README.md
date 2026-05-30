# Illinois Land Index

Public marketing site for Illinois Land Index, a Central Illinois parcel intelligence project.

The repo also includes public market-kit dashboards at:

```text
consumer-debt-dashboard/index.html
knoxville-market-dashboard/index.html
```

This repository is intentionally public-safe:

- No parcel owner records
- No mailing-address exports
- No generated CSV/XLSX tax data
- No private dashboard watchlist data
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

To refresh the Knoxville parcel summary:

```powershell
node scripts\import_knoxville_parcel_summary.mjs
```

## Local Preview

Open `index.html` directly, or serve the folder with any static server.

```powershell
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Analytics

Sitewide analytics and click tracking live in `analytics.js`.

To enable Google Analytics 4, replace this placeholder in `analytics.js`:

```js
const GA_MEASUREMENT_ID = "G-REPLACE-WITH-YOUR-ID";
```

with the GA4 measurement ID for `illinoislandindex.com`, such as:

```js
const GA_MEASUREMENT_ID = "G-ABC123XYZ0";
```

The tracker records page views plus link-click events for the Illinois dashboard, debt context,
Knoxville dashboard, research pages, and market request form.

## Deploy

This site is ready for GitHub Pages, Netlify, Vercel, Firebase Hosting, or any static web host.

For GitHub Pages:

1. Push this folder as the root of a clean public repository.
2. Open repository settings.
3. Go to `Pages`.
4. Deploy from the `main` branch root.
