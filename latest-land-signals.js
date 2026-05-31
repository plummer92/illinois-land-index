(function () {
  const numberFormat = new Intl.NumberFormat("en-US");
  const compactFormat = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  function setText(id, value) {
    const element = document.querySelector(`[data-signal-stat="${id}"]`);
    if (element) element.textContent = value;
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
    try {
      const [summary, candidates] = await Promise.all([
        loadJson("./knoxville-market-dashboard/data/processed/parcel_summary.json"),
        loadJson("./knoxville-market-dashboard/data/processed/parcel_candidates.geojson"),
      ]);

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

      setStatus("Live public Knoxville data loaded. Illinois/Sangamon headline counts stay in the private dashboard until a public-safe aggregate export is published.");
    } catch (error) {
      setStatus("Live headline counts could not load. Use the dashboard links below while the data source refreshes.");
      console.error(error);
    }
  }

  main();
})();
