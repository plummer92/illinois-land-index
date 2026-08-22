const formatNumber = (value, digits = 0) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
const formatMoney = (value) => Number.isFinite(value) && value > 0 ? value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Not published";
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);

const publicCountyLinks = {
  Gilpin: {
    search: "https://gis.colorado.gov/proptaxmap/",
    info: "https://gilpin.infoenvoy.net/Search",
  },
  Boulder: {
    search: "https://maps.bouldercounty.org/boco/PropertySearch/?page=Home",
    info: "https://bouldercounty.gov/departments/assessor/",
  },
  "Clear Creek": {
    search: "https://www.clearcreekcounty.us/443/Interactive-Maps",
    info: "https://www.clearcreekcounty.us/188/Assessor",
  },
  Grand: {
    search: "https://www.co.grand.co.us/133/Assessors-Office",
    info: "https://www.co.grand.co.us/434/4086/Property-Taxes",
  },
  Jefferson: {
    search: "https://propertysearch.jeffco.us/propertyrecordssearch/dashboard",
    info: "https://www.jeffco.us/713/Parcel-Maps",
  },
};

let snapshot;
let map;
let parcelLayer;
const candidateCache = new Map();
let activeCandidates = [];

function nextCheck(candidate) {
  const text = `${candidate.land_use_description} ${candidate.zoning_description}`.toLowerCase();
  if (/mining|mine/.test(text)) return "Mining history and title";
  if ((candidate.acres || 0) >= 20) return "Slope and usable acreage";
  if (/vacant/.test(text)) return "Access, well, and septic";
  return "Zoning and buildability";
}

function filteredCandidates() {
  const county = document.getElementById("countyFilter").value;
  const minAcres = Number(document.getElementById("minAcres").value);
  const minScore = Number(document.getElementById("minScore").value);
  const landUse = document.getElementById("landUse").value;
  return activeCandidates.filter((item) => (!county || item.county === county) && (item.acres || 0) >= minAcres && item.score >= minScore && (!landUse || item.land_use_description === landUse));
}

async function loadCountyCandidates(countyName) {
  if (candidateCache.has(countyName)) return candidateCache.get(countyName);
  const county = snapshot.counties.find((item) => item.name === countyName);
  if (!county) return [];
  const response = await fetch(`./data/processed/${county.candidates_file}`);
  if (!response.ok) throw new Error(`${countyName} candidate data could not be loaded.`);
  const payload = await response.json();
  candidateCache.set(countyName, payload.candidates || []);
  return candidateCache.get(countyName);
}

async function loadSelectedCandidates() {
  const selected = document.getElementById("countyFilter").value;
  document.getElementById("visibleCount").textContent = "Loading...";
  activeCandidates = selected
    ? await loadCountyCandidates(selected)
    : (await Promise.all(snapshot.counties.map((county) => loadCountyCandidates(county.name)))).flat();
}

function selectedSummary() {
  const county = document.getElementById("countyFilter").value;
  if (county) return snapshot.counties.find((item) => item.name === county);
  const bucketMap = new Map();
  snapshot.counties.forEach((item) => item.acreage_buckets.forEach((bucket) => {
    const current = bucketMap.get(bucket.key) || { ...bucket, count: 0 };
    current.count += bucket.count;
    bucketMap.set(bucket.key, current);
  }));
  return { name: "Five-county region", ...snapshot.summary, acreage_buckets: [...bucketMap.values()] };
}

function selectedCountyLinks(countyName) {
  return publicCountyLinks[countyName] || {
    search: "https://gis.colorado.gov/proptaxmap/",
    info: "https://gis.colorado.gov/proptaxmap/",
  };
}

function updatePublicLinks() {
  const countyName = document.getElementById("countyFilter").value;
  const links = selectedCountyLinks(countyName);
  document.getElementById("countySearchLink").href = links.search;
  document.getElementById("countyInfoLink").href = links.info;
}

function renderSummary() {
  const summary = selectedSummary();
  document.getElementById("parcelCount").textContent = formatNumber(summary.parcel_count);
  document.getElementById("candidateCount").textContent = formatNumber(summary.candidate_count);
  document.getElementById("candidateAcres").textContent = `${formatNumber(summary.candidate_acres)} ac`;
  document.getElementById("largestCandidate").textContent = `${formatNumber(summary.largest_candidate_acres, 1)} ac`;
  document.getElementById("parcelCountLabel").textContent = `${summary.name} parcels`;
  document.getElementById("candidateCountLabel").textContent = `${summary.name} candidates`;
  document.getElementById("acreageHeading").textContent = `How ${summary.name} parcels break down by size.`;
  document.getElementById("acreageBuckets").innerHTML = summary.acreage_buckets.map((bucket) => `<article><span>${escapeHtml(bucket.label)}</span><strong>${formatNumber(bucket.count)}</strong><p>county parcel records</p></article>`).join("");
}

function renderCandidates() {
  const candidates = filteredCandidates();
  renderSummary();
  document.getElementById("visibleCount").textContent = `${candidates.length} shown`;
  document.getElementById("candidateRows").innerHTML = candidates.slice(0, 100).map((item) => `
    <tr data-candidate="${escapeHtml(item.candidate_id)}">
      <td><span class="score">${item.score}</span></td>
      <td><strong>${escapeHtml(item.situs_address)}</strong><br>${escapeHtml(item.city || "Gilpin County")}</td>
      <td>${formatNumber(item.acres, 2)}</td>
      <td>${escapeHtml(item.land_use_description || "Not classified")}<br><small>${escapeHtml(item.zoning_description || item.zoning_code || "Zoning not published")}</small></td>
      <td>${formatMoney(item.appraised_value)}</td>
      <td>${formatMoney(item.estimated_annual_tax)}</td>
      <td>${escapeHtml(nextCheck(item))}<br><a href="${escapeHtml(selectedCountyLinks(item.county).search)}" target="_blank" rel="noreferrer">Open public county search</a></td>
    </tr>`).join("") || '<tr><td colspan="7">No candidates match these filters.</td></tr>';

  parcelLayer.clearLayers();
  candidates.forEach((item) => {
    if (!item.geometry) return;
    const layer = L.geoJSON({ type: "Feature", geometry: item.geometry }, { style: { color: "#235347", weight: 1.5, fillColor: item.score >= 70 ? "#d7a52b" : "#4a8a76", fillOpacity: .42 } });
    layer.bindPopup(`<div class="map-popup"><strong>${escapeHtml(item.situs_address)}</strong>${formatNumber(item.acres, 2)} acres<br>${escapeHtml(item.land_use_description || "Land use not classified")}<br>Score ${item.score}</div>`);
    layer.addTo(parcelLayer);
  });
}

async function init() {
  const [response, taxResponse] = await Promise.all([
    fetch("./data/processed/gilpin_parcel_snapshot.json"),
    fetch("./data/processed/colorado_property_tax_snapshot.json"),
  ]);
  if (!response.ok) throw new Error("Gilpin parcel snapshot could not be loaded.");
  snapshot = await response.json();
  if (taxResponse.ok) {
    const taxSnapshot = await taxResponse.json();
    document.getElementById("taxCoverage").innerHTML = taxSnapshot.counties.map((county) => `
      <article><span>${escapeHtml(county.name)} County</span><strong>${county.accounts ? formatNumber(county.accounts) : "Assessment only"}</strong><p>${county.coverage === "official_bulk_assessor_roll" ? `${formatMoney(county.estimated_annual_tax)} estimated annual levy` : "Treasurer bulk payment feed still needed"}</p></article>
    `).join("");
    document.getElementById("taxCoverageNote").textContent = `Updated ${new Date(taxSnapshot.generated_at).toLocaleDateString()}. Annual tax is estimated from assessed value and mill levy; it is not a verified unpaid balance.`;
  }
  document.getElementById("refreshStatus").textContent = `Source received ${snapshot.source_updated || "date not published"}; dashboard built ${new Date(snapshot.generated_at).toLocaleDateString()}.`;

  document.getElementById("map").innerHTML = "";
  map = L.map("map", { scrollWheelZoom: false }).setView([39.86, -105.51], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  parcelLayer = L.layerGroup().addTo(map);
  await loadSelectedCandidates();
  const uses = [...new Set(activeCandidates.map((item) => item.land_use_description).filter(Boolean))].sort();
  document.getElementById("landUse").innerHTML += uses.map((use) => `<option>${escapeHtml(use)}</option>`).join("");
  updatePublicLinks();
  renderCandidates();

  ["minAcres", "minScore", "landUse"].forEach((id) => document.getElementById(id).addEventListener("input", () => {
    document.getElementById("minAcresValue").value = document.getElementById("minAcres").value;
    document.getElementById("minScoreValue").value = document.getElementById("minScore").value;
    renderCandidates();
  }));
  document.getElementById("countyFilter").addEventListener("change", async () => {
    await loadSelectedCandidates();
    updatePublicLinks();
    renderCandidates();
  });
  document.getElementById("clearFilters").addEventListener("click", async () => {
    document.getElementById("minAcres").value = 5;
    document.getElementById("minScore").value = 0;
    document.getElementById("landUse").value = "";
    document.getElementById("countyFilter").value = "Gilpin";
    document.getElementById("minAcresValue").value = 5;
    document.getElementById("minScoreValue").value = 0;
    await loadSelectedCandidates();
    updatePublicLinks();
    renderCandidates();
  });
}

init().catch((error) => {
  document.getElementById("refreshStatus").textContent = error.message;
  document.getElementById("candidateRows").innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
});
