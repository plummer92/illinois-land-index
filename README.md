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

## Local Preview

Open `index.html` directly, or serve the folder with any static server.

```powershell
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Deploy

This site is ready for GitHub Pages, Netlify, Vercel, Firebase Hosting, or any static web host.

For GitHub Pages:

1. Push this folder as the root of a clean public repository.
2. Open repository settings.
3. Go to `Pages`.
4. Deploy from the `main` branch root.
