import fs from "node:fs/promises";
import { fetchJson } from "./lib/fetch_json.mjs";

const layer = "https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0";
const outputPath = "indianapolis-market-dashboard/data/processed/parcel_candidates.geojson";
const counties = [
  { county: "Marion", fips: "18097" }, { county: "Hamilton", fips: "18057" },
  { county: "Hendricks", fips: "18063" }, { county: "Boone", fips: "18011" },
  { county: "Johnson", fips: "18081" }, { county: "Hancock", fips: "18059" },
  { county: "Morgan", fips: "18109" }, { county: "Shelby", fips: "18145" },
];
const perCountyLimit = 12;
const queryCount = 30;
const minAcres = 20;
const maxRingPoints = 90;
const earthRadiusMeters = 6_378_137;
const squareMetersPerAcre = 4_046.8564224;

const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const radians = (degrees) => degrees * Math.PI / 180;

const ringAreaSquareMeters = (ring) => {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const lower = ring[(index + ring.length - 1) % ring.length];
    const middle = ring[index];
    const upper = ring[(index + 1) % ring.length];
    total += (radians(upper[0]) - radians(lower[0])) * Math.sin(radians(middle[1]));
  }
  return total * earthRadiusMeters * earthRadiusMeters / 2;
};

const geometryAcres = (geometry) => Math.abs((geometry?.rings ?? []).reduce((sum, ring) => sum + ringAreaSquareMeters(ring), 0)) / squareMetersPerAcre;

const simplifyRing = (ring) => {
  const step = Math.max(1, Math.ceil(ring.length / maxRingPoints));
  const simplified = ring.filter((_, index) => index % step === 0 || index === ring.length - 1)
    .map(([lon, lat]) => [round(Number(lon), 5), round(Number(lat), 5)]);
  if (simplified.length < 3) return [];
  const first = simplified[0];
  const last = simplified.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push([...first]);
  return simplified.length >= 4 ? simplified : [];
};

const toGeoJson = (geometry) => ({
  type: "Polygon",
  coordinates: (geometry?.rings ?? []).map(simplifyRing).filter((ring) => ring.length >= 4),
});

const centroid = (geometry) => {
  const ring = geometry.coordinates[0] ?? [];
  if (!ring.length) return null;
  const totals = ring.reduce((sum, [lon, lat]) => ({ lon: sum.lon + lon, lat: sum.lat + lat }), { lon: 0, lat: 0 });
  return [round(totals.lon / ring.length, 6), round(totals.lat / ring.length, 6)];
};

const queryUrl = (county) => {
  const url = new URL(`${layer}/query`);
  const params = {
    f: "json",
    where: `county_fips='${county.fips}'`,
    returnGeometry: "true",
    outSR: "4326",
    outFields: "objectid,county_fips,dlgf_prop_class_code,tax_township,source_originator,loaddate",
    orderByFields: "SHAPE__Area DESC",
    resultRecordCount: String(queryCount),
    geometryPrecision: "6",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

const importCounty = async (county, generatedAt) => {
  console.log(`Importing ${county.county} parcel candidates...`);
  const data = await fetchJson(queryUrl(county));
  return (data.features ?? []).map((feature) => {
    const acres = geometryAcres(feature.geometry);
    const geometry = toGeoJson(feature.geometry);
    return { feature, acres, geometry };
  }).filter((item) => item.acres >= minAcres && item.geometry.coordinates.length)
    .slice(0, perCountyLimit)
    .map((item, index) => ({
      type: "Feature",
      geometry: item.geometry,
      properties: {
        candidate_id: `${county.fips}-${index + 1}`,
        county: county.county,
        fips: county.fips,
        acres: round(item.acres, 2),
        parcel_class: String(item.feature.attributes?.dlgf_prop_class_code ?? "Not classified"),
        township: String(item.feature.attributes?.tax_township ?? "Not available"),
        source_originator: String(item.feature.attributes?.source_originator ?? "Not available"),
        score: item.acres >= 100 ? 70 : item.acres >= 50 ? 55 : 40,
        source: "Indiana Geographic Information Office / IndianaMap",
        source_layer: layer,
        source_status: "ok",
        data_as_of: generatedAt,
        centroid: centroid(item.geometry),
        note: "Screening geometry only. Acres are calculated geodesically from the public polygon; owner, address, and parcel ID fields are excluded.",
      },
    }));
};

const main = async () => {
  const generatedAt = new Date().toISOString();
  const features = [];
  for (const county of counties) features.push(...await importCounty(county, generatedAt));
  const output = {
    type: "FeatureCollection",
    generated_at: generatedAt,
    title: "Indianapolis-Area Public Parcel Candidate Geometry",
    privacy_note: "Public-safe screening geometry. Owner names, addresses, and parcel identifiers are excluded.",
    selection_logic: `Largest source polygons by SHAPE__Area, then geodesically measured and filtered to ${minAcres}+ acres; capped at ${perCountyLimit} per county. Verify boundaries and acreage with the county before use.`,
    features: features.sort((a, b) => b.properties.acres - a.properties.acres),
  };
  await fs.mkdir("indianapolis-market-dashboard/data/processed", { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output)}\n`);
  console.log(`Wrote ${features.length} candidate geometries.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
