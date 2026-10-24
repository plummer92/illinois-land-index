import fs from "node:fs/promises";
import { fetchJson } from "./lib/fetch_json.mjs";

const service = "https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer";
const layer = `${service}/0`;
const outputPath = "indianapolis-market-dashboard/data/processed/parcel_summary.json";
const counties = [
  { county: "Marion", fips: "18097", role: "Core county" },
  { county: "Hamilton", fips: "18057", role: "North" },
  { county: "Hendricks", fips: "18063", role: "West" },
  { county: "Boone", fips: "18011", role: "Northwest" },
  { county: "Johnson", fips: "18081", role: "South" },
  { county: "Hancock", fips: "18059", role: "East" },
  { county: "Morgan", fips: "18109", role: "Southwest" },
  { county: "Shelby", fips: "18145", role: "Southeast" },
];

const queryUrl = (params) => {
  const url = new URL(`${layer}/query`);
  for (const [key, value] of Object.entries({ f: "json", ...params })) url.searchParams.set(key, value);
  return url.toString();
};

const countyWhere = (county) => `county_fips='${county.fips}'`;

const getCount = async (county) => {
  const data = await fetchJson(queryUrl({ where: countyWhere(county), returnCountOnly: "true" }));
  if (!Number.isFinite(data.count)) throw new Error(`Missing parcel count for ${county.county}`);
  return data.count;
};

const getTopClasses = async (county) => {
  const data = await fetchJson(queryUrl({
    where: `${countyWhere(county)} AND dlgf_prop_class_code IS NOT NULL`,
    returnGeometry: "false",
    groupByFieldsForStatistics: "dlgf_prop_class_code",
    orderByFields: "parcel_count DESC",
    outStatistics: JSON.stringify([{ statisticType: "count", onStatisticField: "objectid", outStatisticFieldName: "parcel_count" }]),
  }));
  return (data.features ?? []).slice(0, 8).map((feature) => ({
    label: String(feature.attributes.dlgf_prop_class_code),
    count: feature.attributes.parcel_count,
  }));
};

const main = async () => {
  const layerInfo = await fetchJson(`${layer}?f=json`);
  const generatedAt = new Date().toISOString();
  const summaries = [];
  for (const county of counties) {
    console.log(`Importing ${county.county}...`);
    const [parcelCount, topClasses] = await Promise.all([getCount(county), getTopClasses(county)]);
    summaries.push({
      ...county,
      source: "Indiana Geographic Information Office / IndianaMap",
      service_url: layer,
      source_status: "ok",
      data_as_of: generatedAt,
      parcel_count: parcelCount,
      total_acres: null,
      avg_acres: null,
      max_acres: null,
      acreage_buckets: [],
      acreage_note: "The statewide layer has no acreage attribute; summary acreage totals and buckets are not published.",
      top_classes: topClasses,
      fields_used: {
        county: "county_fips",
        class: "dlgf_prop_class_code",
        township: "tax_township",
        source_originator: "source_originator",
        geometry_area: "SHAPE__Area (ordering only; candidate acres are calculated geodesically from geometry)",
      },
    });
  }
  const output = {
    generated_at: generatedAt,
    title: "Indianapolis-Area Public Parcel Summary",
    privacy_note: "Public-safe aggregate import only. Owner names, addresses, parcel identifiers, and individual geometry are excluded.",
    source: {
      name: "Parcel Boundaries of Indiana Current",
      owner: "Indiana Geographic Information Office (IGIO)",
      url: service,
    },
    totals: {
      counties_loaded: summaries.length,
      parcel_count: summaries.reduce((sum, county) => sum + county.parcel_count, 0),
      total_acres: null,
    },
    counties: summaries,
  };
  await fs.mkdir("indianapolis-market-dashboard/data/processed", { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${output.totals.parcel_count.toLocaleString()} parcels across ${summaries.length} counties.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
