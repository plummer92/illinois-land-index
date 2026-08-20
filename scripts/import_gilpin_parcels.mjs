import fs from "node:fs/promises";
import path from "node:path";

const service = "https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0";
const outputDir = path.resolve("gilpin-county-dashboard/data/processed");
const counties = [
  { name: "Gilpin", fips: "08047", role: "Focus county", center: [39.856, -105.522] },
  { name: "Boulder", fips: "08013", role: "Northern border", center: [40.092, -105.357] },
  { name: "Clear Creek", fips: "08019", role: "Southern border", center: [39.689, -105.641] },
  { name: "Grand", fips: "08049", role: "Western border", center: [40.102, -106.118] },
  { name: "Jefferson", fips: "08059", role: "Eastern border", center: [39.586, -105.251] },
];

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const payload = await response.json();
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return payload;
}

function queryUrl(params) {
  const url = new URL(`${service}/query`);
  Object.entries({ f: "json", ...params }).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function numeric(value) {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function candidateScore(parcel) {
  const acres = numeric(parcel.landAcres) || 0;
  const description = `${parcel.landUseDsc || ""} ${parcel.zoningDesc || ""}`.toLowerCase();
  let score = 30;
  if (acres >= 5) score += 10;
  if (acres >= 10) score += 10;
  if (acres >= 20) score += 10;
  if (acres >= 50) score += 10;
  if (/vacant|agric|forest|open|rural|land/.test(description)) score += 15;
  if (!numeric(parcel.apprValTot)) score -= 5;
  return Math.max(0, Math.min(100, score));
}

async function getCount(where) {
  const data = await fetchJson(queryUrl({ where, returnCountOnly: "true" }));
  return data.count || 0;
}

async function getFeatures(where, outFields, returnGeometry = false, limit = 2000, orderByFields = "landAcres DESC") {
  const features = [];
  let offset = 0;
  while (features.length < limit) {
    const pageSize = Math.min(1000, limit - features.length);
    const data = await fetchJson(queryUrl({
      where,
      outFields,
      returnGeometry: String(returnGeometry),
      outSR: "4326",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      orderByFields,
    }));
    const page = data.features || [];
    features.push(...page);
    if (page.length < pageSize || !data.exceededTransferLimit) break;
    offset += page.length;
  }
  return features;
}

function polygonAreaAcres(geometry) {
  const rings = geometry?.rings || [];
  let squareMeters = 0;
  for (const ring of rings) {
    if (ring.length < 4) continue;
    const averageLatitude = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    const metersPerDegreeX = 111320 * Math.cos(averageLatitude * Math.PI / 180);
    const metersPerDegreeY = 110574;
    let area = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
    }
    squareMeters += Math.abs(area / 2) * metersPerDegreeX * metersPerDegreeY;
  }
  return squareMeters / 4046.8564224;
}

function shapeAreaThreshold(acres, latitude) {
  const squareMeters = acres * 4046.8564224;
  return squareMeters / (111320 * Math.cos(latitude * Math.PI / 180) * 110574);
}

function simplifyGeometry(geometry, maxPointsPerRing = 60) {
  if (!geometry?.rings) return null;
  const coordinates = geometry.rings.map((ring) => {
    const step = Math.max(1, Math.ceil(ring.length / maxPointsPerRing));
    const sampled = ring.filter((_, index) => index % step === 0).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);
    const first = sampled[0];
    const last = sampled[sampled.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) sampled.push(first);
    return sampled;
  }).filter((ring) => ring.length >= 4);
  return coordinates.length ? { type: "Polygon", coordinates } : null;
}

const acreageBuckets = [
  ["under_1", "Under 1 acre", "landAcres < 1"],
  ["one_to_5", "1 to 5 acres", "landAcres >= 1 AND landAcres < 5"],
  ["five_to_20", "5 to 20 acres", "landAcres >= 5 AND landAcres < 20"],
  ["twenty_to_50", "20 to 50 acres", "landAcres >= 20 AND landAcres < 50"],
  ["fifty_plus", "50+ acres", "landAcres >= 50"],
];

const countySummaries = [];
const candidates = [];
const candidateSets = new Map();
for (const county of counties) {
  const countyWhere = `countyName='${county.name}'`;
  const parcelCount = await getCount(countyWhere);
  const hasPublishedAcres = await getCount(`${countyWhere} AND landAcres > 0`) > 0;
  const acreageExpression = hasPublishedAcres ? "landAcres" : "Shape__Area";
  const threshold = (acres) => hasPublishedAcres ? acres : shapeAreaThreshold(acres, county.center[0]);
  const bucketCounts = [];
  for (const [key, label, clause] of acreageBuckets) {
    const adjustedClause = hasPublishedAcres ? clause : clause.replaceAll("landAcres", acreageExpression).replace(/(\d+(?:\.\d+)?)/g, (value) => threshold(Number(value)));
    bucketCounts.push({ key, label, count: await getCount(`${countyWhere} AND ${adjustedClause}`) });
  }
  const rawCandidates = await getFeatures(
    `${countyWhere} AND ${acreageExpression} >= ${threshold(5)}`,
    "OBJECTID,situsAdd,sitAddCty,landAcres,Shape__Area,zoningCode,zoningDesc,landUseCde,landUseDsc,saleDate,salePrice,apprValTot,asedValTot,dateReceived,URL",
    true,
    500,
    `${acreageExpression} DESC`,
  );
  const countyCandidates = rawCandidates.map(({ attributes, geometry }, index) => ({
    candidate_id: `${county.fips}-${attributes.OBJECTID || index + 1}`,
    county: county.name,
    state: "CO",
    acres: numeric(attributes.landAcres) || polygonAreaAcres(geometry),
    situs_address: attributes.situsAdd || "Address not published",
    city: attributes.sitAddCty || "",
    zoning_code: attributes.zoningCode || "",
    zoning_description: attributes.zoningDesc || "",
    land_use_code: attributes.landUseCde || "",
    land_use_description: attributes.landUseDsc || "",
    sale_date: attributes.saleDate || "",
    sale_price: numeric(attributes.salePrice),
    appraised_value: numeric(attributes.apprValTot),
    assessed_value: numeric(attributes.asedValTot),
    source_updated: attributes.dateReceived || "",
    source_url: attributes.URL || service,
    score: candidateScore(attributes),
    geometry: simplifyGeometry(geometry),
  }));
  const acreage = countyCandidates.map((item) => item.acres).filter(Number.isFinite);
  const values = countyCandidates.map((item) => item.appraised_value).filter((value) => Number.isFinite(value) && value > 0);
  countySummaries.push({
    ...county,
    parcel_count: parcelCount,
    candidate_count: countyCandidates.length,
    candidate_acres: acreage.reduce((sum, value) => sum + value, 0),
    largest_candidate_acres: Math.max(0, ...acreage),
    average_appraised_value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    acreage_buckets: bucketCounts,
    source_updated: countyCandidates.find((item) => item.source_updated)?.source_updated || null,
    acreage_method: hasPublishedAcres ? "published landAcres" : "derived from public parcel geometry",
    candidates_file: `candidates-${county.name.toLowerCase().replaceAll(" ", "-")}.json`,
  });
  candidateSets.set(county.name, countyCandidates);
  candidates.push(...countyCandidates);
  console.log(`Imported ${parcelCount.toLocaleString()} ${county.name} parcels and ${countyCandidates.length} candidates.`);
}

const regionAcreage = candidates.map((item) => item.acres).filter(Number.isFinite);
const output = {
  generated_at: new Date().toISOString(),
  source_updated: countySummaries.find((item) => item.name === "Gilpin")?.source_updated || null,
  county: { name: "Gilpin County", state: "Colorado", fips: "08047" },
  region: { name: "Gilpin County and bordering counties", county_count: counties.length },
  source: {
    name: "Colorado Public Parcel Composite",
    url: service,
    county_gis: "https://gis.gilpincounty.org/portal/apps/sites/#/open-data",
    county_tax: "https://gilpincountyco-tsrweb.tylerhost.net/treasurer/web/",
  },
  summary: {
    parcel_count: countySummaries.reduce((sum, county) => sum + county.parcel_count, 0),
    candidate_count: candidates.length,
    candidate_acres: regionAcreage.reduce((sum, value) => sum + value, 0),
    largest_candidate_acres: Math.max(0, ...regionAcreage),
  },
  counties: countySummaries,
  privacy_note: "Public candidate output excludes owner names, owner mailing addresses, account numbers, and parcel identifiers.",
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "gilpin_parcel_snapshot.json"), `${JSON.stringify(output, null, 2)}\n`);
for (const county of countySummaries) {
  await fs.writeFile(
    path.join(outputDir, county.candidates_file),
    `${JSON.stringify({ generated_at: output.generated_at, county: county.name, candidates: candidateSets.get(county.name) }, null, 2)}\n`,
  );
}
console.log(`Imported ${countySummaries.length} counties and ${candidates.length} public-safe candidates.`);
