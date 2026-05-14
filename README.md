# Chatham Land Index

Public marketing site for Chatham Land Index, a Central Illinois parcel intelligence project.

This repository is intentionally public-safe:

- No parcel owner records
- No mailing-address exports
- No generated CSV/XLSX tax data
- No private dashboard watchlist data

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
