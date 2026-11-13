(() => {
  const rankFilters = ["scorePin", "scoreTown", "scoreClass", "scoreAcres", "scoreTargets", "scoreMin", "scoreSort", "scorePage"];

  function followParcelLink() {
    const url = new URL(location.href);
    if (url.hash === "#chatham-map") {
      document.getElementById("chatham-map").open = true;
      return;
    }
    const oldRankSection = ["#scored-properties", "#scores-title", "#parcel-rankings", "#rank-results"].includes(url.hash);
    if (url.hash && !oldRankSection) return;

    // Saved score details now open the parcel directly. Other old ranking links
    // keep their township, filters and page on the dedicated rankings page.
    const pin = url.searchParams.get("foundParcel") || url.searchParams.get("scoreDetail");
    if (/^\d{11}$/.test(pin || "")) {
      url.hash = "property-result";
      history.replaceState(history.state, "", url);
    } else if (oldRankSection || rankFilters.some(key => url.searchParams.has(key))) {
      const rankings = new URL("./rankings.html", url);
      rankings.search = url.search;
      if (url.hash === "#rank-results") rankings.hash = url.hash;
      location.replace(rankings.href);
    }
  }

  followParcelLink();
  window.addEventListener("popstate", followParcelLink);
  window.addEventListener("hashchange", followParcelLink);
})();
