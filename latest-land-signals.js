(function () {
  const numberFormat = new Intl.NumberFormat("en-US");
  const compactFormat = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  function setText(id, value) {
    document.querySelectorAll(`[data-signal-stat="${id}"]`).forEach((element) => {
      element.textContent = value;
    });
  }

  function setStatus(message) {
    const element = document.getElementById("signalStatsStatus");
    if (element) element.textContent = message;
  }

  function formatDate(value) {
    if (!value) return "Recently refreshed";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recently refreshed";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function bucketCount(summary, key) {
    return (summary.counties || []).reduce((total, county) => {
      const bucket = (county.acreage_buckets || []).find((item) => item.key === key);
      return total + Number(bucket?.count || 0);
    }, 0);
  }

  function topCountyBy(summary, key) {
    return (summary.counties || [])
      .slice()
      .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))[0];
  }

  async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${path}`);
    return response.json();
  }

  async function main() {
    const [publicSummaryResult, knoxvilleSummaryResult, knoxvilleCandidatesResult] = await Promise.allSettled([
      loadJson("./data/public-signal-summary.json"),
      loadJson("./knoxville-market-dashboard/data/processed/parcel_summary.json"),
      loadJson("./knoxville-market-dashboard/data/processed/parcel_candidates.geojson"),
    ]);

    if (publicSummaryResult.status === "fulfilled") {
      const sangamon = publicSummaryResult.value.illinois_sangamon || {};
      const totals = sangamon.totals || {};
      const scoreBands = sangamon.score_bands || {};
      const acreageBands = sangamon.acreage_bands || {};
      const terrain = sangamon.terrain || {};
      const topTownship = (sangamon.top_townships || [])[0];
      const topClass = (sangamon.top_property_classes || [])[0];

      setText("illinois-targets", compactFormat.format(totals.public_target_rows || 0));
      setText("illinois-score-80", numberFormat.format(scoreBands.score_80_plus || 0));
      setText("illinois-max-score", numberFormat.format(totals.max_opportunity_score || 0));
      setText("illinois-taxes-due", numberFormat.format(totals.taxes_due_count || 0));
      setText("illinois-taxes-due-soon", numberFormat.format(totals.taxes_due_soon_45_days || 0));
      setText("illinois-owner-rollups", compactFormat.format(totals.owner_rollup_count || 0));
      setText("illinois-large-owner-rollups", numberFormat.format(totals.large_owner_rollup_count || 0));
      setText("illinois-terrain-ready", numberFormat.format(terrain.ready_count || totals.terrain_ready_count || 0));
      setText("illinois-low-terrain", numberFormat.format(terrain.low_risk_count || 0));
      setText("illinois-fifty-plus", numberFormat.format(acreageBands.fifty_plus_acres || 0));
      setText("illinois-total-acres", compactFormat.format(totals.total_acres || 0));
      setText("illinois-top-township", topTownship ? topTownship.label : "Review dashboard");
      setText("illinois-top-class", topClass ? topClass.label : "Review dashboard");
      setText("illinois-updated", formatDate(sangamon.refreshed_at || publicSummaryResult.value.generated_at));
    }

    if (knoxvilleSummaryResult.status === "fulfilled" && knoxvilleCandidatesResult.status === "fulfilled") {
      const summary = knoxvilleSummaryResult.value;
      const candidates = knoxvilleCandidatesResult.value;
      const candidateFeatures = candidates.features || [];
      const highScoreCandidates = candidateFeatures.filter((feature) => Number(feature.properties?.score || 0) >= 55);
      const fiftyPlusAcres = bucketCount(summary, "fifty_plus_acres");
      const topAcreageCounty = topCountyBy(summary, "total_acres");
      const topParcelCounty = topCountyBy(summary, "parcel_count");
      const generatedAt = candidates.generated_at || summary.generated_at;

      setText("knoxville-counties", numberFormat.format(summary.totals?.counties_loaded || 0));
      setText("knoxville-parcels", compactFormat.format(summary.totals?.parcel_count || 0));
      setText("knoxville-candidates", numberFormat.format(candidateFeatures.length));
      setText("knoxville-high-score", numberFormat.format(highScoreCandidates.length));
      setText("knoxville-acreage", compactFormat.format(summary.totals?.total_acres || 0));
      setText("knoxville-fifty-plus", numberFormat.format(fiftyPlusAcres));
      setText("knoxville-top-acreage-county", topAcreageCounty ? topAcreageCounty.county : "Review dashboard");
      setText("knoxville-top-parcel-county", topParcelCounty ? topParcelCounty.county : "Review dashboard");
      setText("knoxville-updated", formatDate(generatedAt));
    }

    if (publicSummaryResult.status === "fulfilled" && knoxvilleSummaryResult.status === "fulfilled" && knoxvilleCandidatesResult.status === "fulfilled") {
      setStatus("Live public Illinois/Sangamon and Knoxville data loaded. Public summaries exclude owner names, addresses, legal descriptions, and parcel IDs.");
    } else if (publicSummaryResult.status === "fulfilled" || knoxvilleSummaryResult.status === "fulfilled") {
      setStatus("Some live headline counts loaded. One public data source is temporarily unavailable.");
    } else {
      setStatus("Live headline counts could not load. Use the dashboard links below while the data source refreshes.");
    }
  }

  main();
})();
