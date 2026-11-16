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

  function formatChange(value) {
    if (value === null || value === undefined) return "new";
    const numeric = Number(value || 0);
    if (numeric === 0) return "no change";
    return `${numeric > 0 ? "+" : ""}${numberFormat.format(numeric)}`;
  }

  function formatComparison(metric) {
    if (!metric || !Number.isFinite(metric.current)) return "Unavailable";
    if (!metric || metric.previous === null || metric.previous === undefined) return "No comparable earlier value";
    return `${numberFormat.format(Number(metric.previous || 0))} → ${numberFormat.format(Number(metric.current || 0))} (${formatChange(metric.change)})`;
  }

  function formatCount(value) {
    return Number.isInteger(value) && value >= 0 ? numberFormat.format(value) : "Unavailable";
  }

  function formatEvidenceDate(value) {
    if (typeof value !== "string" || !value) return "Unavailable";
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(dateOnly ? `${value}T12:00:00.000Z` : value);
    if (Number.isNaN(date.getTime())) return "Unavailable";
    return date.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: dateOnly ? "UTC" : "America/Chicago",
    });
  }

  function renderPaymentReview(summary) {
    const review = summary.payment_reconciliation || {};
    const correction = summary.payment_correction || {};
    const totals = summary.illinois_sangamon?.totals || {};
    setText("payment-checked", formatEvidenceDate(review.checked_at));
    setText("payment-records-checked", formatCount(review.records_checked));
    setText("payment-positive", formatCount(review.positive_current_balance_records));
    setText("payment-zero", formatCount(review.zero_current_balance_records));
    setText("payment-credit", formatCount(review.credit_current_balance_records));
    const yearsKnown = Number.isInteger(review.billing_tax_year) && Number.isInteger(review.payable_year);
    setText("payment-billing-years", yearsKnown ? `Tax year ${review.billing_tax_year}, payable ${review.payable_year}` : "Billing years unavailable");
    setText("payment-coverage", review.coverage_note || "The scope of this record check is unavailable. Do not treat these figures as a current countywide total.");
    setText("payment-history", review.historical_note || "The explanation of the earlier counts is unavailable.");
    setText("payment-correction-note", correction.note || "The county snapshot and the separate record check have different coverage and dates.");
    setText("illinois-tax-source-date", formatEvidenceDate(correction.source_date || totals.countywide_tax_data_as_of));
    setText("payment-snapshot-targets", formatCount(totals.public_target_rows));
    setText("payment-snapshot-current", formatCount(totals.public_target_taxes_due_count));
    setText("payment-snapshot-older", formatCount(totals.public_target_delinquent_taxes_due_count));
    setText("payment-snapshot-either", formatCount(totals.public_target_any_taxes_due_count));
    setText("payment-snapshot-county-older", formatCount(totals.delinquent_taxes_due_count));
    const current = totals.public_target_taxes_due_count;
    const older = totals.public_target_delinquent_taxes_due_count;
    const either = totals.public_target_any_taxes_due_count;
    const validGroups = [current, older, either].every(value => Number.isInteger(value) && value >= 0)
      && either >= Math.max(current, older) && either <= current + older;
    setText("payment-snapshot-overlap", validGroups
      ? `${numberFormat.format(current + older - either)} records appear in both groups; ${numberFormat.format(either - current)} have only an older-year balance. The current and older-year counts should not be added together.`
      : "The overlap between current and older-year balances is unavailable.");
    const link = document.getElementById("paymentCountySource");
    if (link && typeof review.source_url === "string") {
      try {
        const url = new URL(review.source_url);
        if (url.protocol === "https:" && url.hostname === "tax.sangamonil.gov") link.href = url.href;
      } catch (_) { /* Keep the official county search link if source metadata is invalid. */ }
    }
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
    const [publicSummaryResult, publicDeltaResult, knoxvilleSummaryResult, knoxvilleCandidatesResult] = await Promise.allSettled([
      loadJson("./data/public-signal-summary.json"),
      loadJson("./data/public-signal-delta.json"),
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
      setText("illinois-taxes-due", formatCount(totals.taxes_due_count));
      setText("illinois-taxes-due-soon", formatCount(totals.taxes_due_soon_45_days));
      setText("illinois-owner-rollups", compactFormat.format(totals.owner_rollup_count || 0));
      setText("illinois-large-owner-rollups", numberFormat.format(totals.large_owner_rollup_count || 0));
      setText("illinois-terrain-ready", numberFormat.format(terrain.ready_count || totals.terrain_ready_count || 0));
      setText("illinois-low-terrain", numberFormat.format(terrain.low_risk_count || 0));
      setText("illinois-fifty-plus", numberFormat.format(acreageBands.fifty_plus_acres || 0));
      setText("illinois-total-acres", compactFormat.format(totals.total_acres || 0));
      setText("illinois-top-township", topTownship ? topTownship.label : "Review dashboard");
      setText("illinois-top-class", topClass ? topClass.label : "Review dashboard");
      setText("illinois-updated", formatEvidenceDate(publicSummaryResult.value.score_source_date || sangamon.refreshed_at));
      renderPaymentReview(publicSummaryResult.value);
    }

    if (publicDeltaResult.status === "fulfilled") {
      const delta = publicDeltaResult.value.illinois_sangamon || {};
      const metrics = delta.metrics || [];
      const byLabel = Object.fromEntries(metrics.map((metric) => [metric.label, metric]));
      const movement = delta.largest_movement;

      setText("delta-compared-to", formatDate(publicDeltaResult.value.compared_to));
      setText("delta-current-week", formatDate(publicDeltaResult.value.generated_at));
      setText("delta-targets", formatComparison(byLabel["Sangamon target rows"]));
      setText("delta-score-80", formatComparison(byLabel["Score 80+ rows"]));
      setText("delta-taxes-due", formatComparison(byLabel["Countywide unpaid-balance rows"] || byLabel["Taxes due rows"]));
      setText("delta-due-soon", formatComparison(byLabel["Due within 45 days"]));
      setText("delta-owner-groups", formatComparison(byLabel["Large owner groups"]));
      setText("delta-terrain", formatComparison(byLabel["Terrain-ready rows"]));
      setText("delta-largest-movement", movement ? `${movement.label}: ${formatChange(movement.change)}` : "Waiting on the next comparison");
      if (publicDeltaResult.value.comparison_type === "model_and_recorded_acreage_correction") {
        setText("delta-title","What changed after the scoring correction");
        setText("delta-note","These differences come from correcting the vacant-residential rule and filling missing acreage from county GIS. They are not market movement. Tax and payment records were not refreshed.");
      } else if (publicDeltaResult.value.comparison_type === "payment_field_mapping_correction") {
        setText("delta-title", "What changed after correcting the tax fields");
        setText("delta-note", publicDeltaResult.value.comparison_note || "The earlier calculation mixed tax fields. These are corrections to the source snapshot, not newly unpaid properties or a countywide live payment check.");
        setText("delta-largest-movement", "Tax-data correction; see the explanation");
      }
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
      setStatus("Published Illinois/Sangamon and Knoxville snapshots loaded. Check their source dates and correction notes. Public summaries exclude owner names, addresses, legal descriptions, and parcel IDs.");
    } else if (publicSummaryResult.status === "fulfilled" || knoxvilleSummaryResult.status === "fulfilled") {
      setStatus("Some live headline counts loaded. One public data source is temporarily unavailable.");
    } else {
      setStatus("Live headline counts could not load. Use the dashboard links below while the data source refreshes.");
    }
  }

  main();
})();
