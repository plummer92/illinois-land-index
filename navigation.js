// The public site and its parcel dashboard run on separate servers in the local preview.
(() => {
  const previewHosts = ["127.0.0.1", "localhost", "[::1]"];
  if (location.port !== "4187" || !previewHosts.includes(location.hostname)) return;

  for (const link of document.querySelectorAll('a[href]')) {
    const destination = new URL(link.href, location.href);
    if (destination.origin !== location.origin || destination.pathname !== "/parcel-dashboard/") continue;
    const preview = new URL("/land-dashboard/index.html", location.origin);
    preview.port = "4188";
    preview.search = destination.search;
    preview.hash = destination.hash;
    link.href = preview.href;
  }
})();
