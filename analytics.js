(function () {
  const GA_MEASUREMENT_ID = "G-REPLACE-WITH-YOUR-ID";
  const isConfigured = /^G-[A-Z0-9]+$/i.test(GA_MEASUREMENT_ID) && !GA_MEASUREMENT_ID.includes("REPLACE");

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
    });
  }

  function classifyLink(url) {
    if (url.hostname === "dashboard.illinoislandindex.com") return "illinois_land_dashboard";
    if (url.pathname.includes("consumer-debt-dashboard")) return "debt_context";
    if (url.pathname.includes("knoxville-market-dashboard")) return "knoxville_market_dashboard";
    if (url.hostname === "tally.so") return "market_request_form";
    if (url.pathname.endsWith(".html")) return "research_page";
    return url.hostname === window.location.hostname ? "internal_link" : "external_link";
  }

  function trackEvent(name, params) {
    if (!isConfigured || typeof window.gtag !== "function") return;
    window.gtag("event", name, params);
  }

  function handleTrackedClick(event) {
    const link = event.target.closest("a[href]");
    if (!link) return;

    const url = new URL(link.getAttribute("href"), window.location.href);
    const destinationType = classifyLink(url);

    trackEvent("land_index_link_click", {
      link_text: link.textContent.trim().slice(0, 100),
      link_url: url.href,
      destination_type: destinationType,
      page_path: window.location.pathname,
    });

    if (destinationType === "illinois_land_dashboard") {
      trackEvent("open_illinois_land_dashboard", {
        link_text: link.textContent.trim().slice(0, 100),
        page_path: window.location.pathname,
      });
    }

    if (destinationType === "debt_context") {
      trackEvent("open_debt_context", {
        link_text: link.textContent.trim().slice(0, 100),
        page_path: window.location.pathname,
      });
    }

    if (destinationType === "knoxville_market_dashboard") {
      trackEvent("open_knoxville_market_dashboard", {
        link_text: link.textContent.trim().slice(0, 100),
        page_path: window.location.pathname,
      });
    }

    if (destinationType === "market_request_form") {
      trackEvent("open_market_request_form", {
        link_text: link.textContent.trim().slice(0, 100),
        page_path: window.location.pathname,
      });
    }
  }

  if (isConfigured) {
    loadGtag();
  }

  document.addEventListener("click", handleTrackedClick);
})();
