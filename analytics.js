(function () {
  if (window.landIndexAnalytics) return;
  const GA_MEASUREMENT_ID = "G-8JFK3CZ7LE";
  const STORAGE_KEY = "ili.analytics.excluded";
  const COOKIE_NAME = "ili_analytics_excluded";
  const location = new URL(window.location.href);
  const production = location.protocol === "https:" && ["illinoislandindex.com", "www.illinoislandindex.com"].includes(location.hostname);
  const preferencesPage = /^\/analytics-preferences\/(?:index\.html)?$/.test(location.pathname);
  const automated = navigator.webdriver === true || location.searchParams.get("analytics_test") === "1";
  const externallyDisabled = window[`ga-disable-${GA_MEASUREMENT_ID}`] === true;
  const isConfigured = /^G-[A-Z0-9]+$/i.test(GA_MEASUREMENT_ID) && !GA_MEASUREMENT_ID.includes("REPLACE");

  function readExcluded() {
    let stored = false;
    let cookie = false;
    try { stored = window.localStorage.getItem(STORAGE_KEY) === "1"; } catch (_) { /* Storage may be blocked. */ }
    try { cookie = document.cookie.split(";").some(value => value.trim() === `${COOKIE_NAME}=1`); } catch (_) { /* Cookies may be blocked. */ }
    return stored || cookie;
  }

  let excluded = readExcluded();
  let remembered = excluded;

  function getStatus() {
    const reason = excluded ? "browser" : !production ? "preview" : automated ? "test" : preferencesPage ? "preferences" : externallyDisabled ? "external" : "public";
    const trackingAllowed = isConfigured && production && !automated && !preferencesPage && !excluded && !externallyDisabled;
    window[`ga-disable-${GA_MEASUREMENT_ID}`] = !trackingAllowed;
    return { excluded, remembered, reason, trackingAllowed };
  }

  function setExcluded(value) {
    excluded = Boolean(value);
    // Disable immediately, even when this browser refuses to save preferences.
    getStatus();
    try {
      if (excluded) window.localStorage.setItem(STORAGE_KEY, "1");
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* Cookie storage below provides a fallback. */ }
    try {
      const domain = production ? "; Domain=illinoislandindex.com" : "";
      document.cookie = `${COOKIE_NAME}=${excluded ? "1" : ""}; Path=/; Max-Age=${excluded ? "31536000" : "0"}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}${domain}`;
    } catch (_) { /* The current visit stays excluded without persistent storage. */ }
    const saved = readExcluded();
    remembered = saved === excluded;
    // A preference that could not be cleared must not be presented as enabled.
    if (!excluded && saved) excluded = true;
    return getStatus();
  }

  window.landIndexAnalytics = { getStatus, setExcluded };
  if (preferencesPage && location.hash === "#exclude") setExcluded(true);
  getStatus();

  function publicUrl(value) {
    try {
      const url = new URL(value, location.href);
      return /^https?:$/.test(url.protocol) ? `${url.origin}${url.pathname}` : "";
    } catch (_) { return ""; }
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };

  function loadGtag() {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    document.head.appendChild(script);

    window.gtag("js", new Date());
    window.gtag("config", GA_MEASUREMENT_ID, {
      page_title: document.title,
      page_path: window.location.pathname,
      // Property searches and parcel links can contain addresses or parcel IDs.
      // Keep those query strings and fragments out of analytics.
      page_location: publicUrl(location.href),
      page_referrer: document.referrer ? publicUrl(document.referrer) : "",
    });
  }

  function classifyLink(url) {
    if (url.origin === window.location.origin && url.pathname === "/parcel-dashboard/") return "illinois_land_dashboard";
    if (url.pathname.includes("consumer-debt-dashboard")) return "debt_context";
    if (url.pathname.includes("knoxville-market-dashboard")) return "knoxville_market_dashboard";
    if (url.pathname.includes("indianapolis-market-dashboard")) return "indianapolis_market_dashboard";
    if (url.pathname.includes("gilpin-county-dashboard")) return "gilpin_county_dashboard";
    if (url.pathname.includes("tax-sale-land-watch")) return "tax_sale_land_watch";
    if (url.pathname.endsWith(".html")) return "research_page";
    return url.hostname === window.location.hostname ? "internal_link" : "external_link";
  }

  function trackEvent(name, params) {
    if (!getStatus().trackingAllowed || typeof window.gtag !== "function") return;
    window.gtag("event", name, params);
  }

  function handleTrackedClick(event) {
    const link = event.target.closest?.("a[href]");
    if (!link) return;

    let url;
    try { url = new URL(link.getAttribute("href"), window.location.href); } catch (_) { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    const destinationType = classifyLink(url);

    trackEvent("land_index_link_click", {
      link_url: publicUrl(url.href),
      destination_type: destinationType,
      page_path: window.location.pathname,
    });

    if (destinationType === "illinois_land_dashboard") {
      trackEvent("open_illinois_land_dashboard", {
        page_path: window.location.pathname,
      });
    }

    if (destinationType === "debt_context") {
      trackEvent("open_debt_context", {
        page_path: window.location.pathname,
      });
    }

    if (destinationType === "knoxville_market_dashboard") {
      trackEvent("open_knoxville_market_dashboard", {
        page_path: window.location.pathname,
      });
    }

    if (destinationType === "indianapolis_market_dashboard") {
      trackEvent("open_indianapolis_market_dashboard", {
        page_path: window.location.pathname,
      });
    }

    if (destinationType === "tax_sale_land_watch") {
      trackEvent("open_tax_sale_land_watch", {
        page_path: window.location.pathname,
      });
    }

  }

  if (getStatus().trackingAllowed) {
    loadGtag();
    document.addEventListener("click", handleTrackedClick);
  }

  // Honor changes from another open tab, including a cookie-only preference.
  function refreshPreference() {
    const saved = readExcluded();
    // Never undo a current-visit exclusion that storage could not remember.
    if (saved || remembered) {
      excluded = saved;
      remembered = true;
      getStatus();
    }
  }
  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY || event.key === null) refreshPreference();
  });
  window.addEventListener("pageshow", refreshPreference);
  document.addEventListener("visibilitychange", refreshPreference);
})();
