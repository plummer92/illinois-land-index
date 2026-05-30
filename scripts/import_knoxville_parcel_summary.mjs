import fs from "node:fs/promises";

const stateFeatureServer = "https://services.arcgis.com/rD2ylXRs80UroD90/arcgis/rest/services/TN_County_Parcel_Map/FeatureServer";
const knoxFeatureServer = "https://geoviewer.cot.tn.gov/arcgis/rest/services/GeoViewer/NonImpact_Parcels/MapServer";

const counties = [
  { county: "Anderson", fips: "47001", layerId: 83, source: "TN Comptroller FeatureServer", service: stateFeatureServer },
  { county: "Blount", fips: "47009", layerId: 79, source: "TN Comptroller FeatureServer", service: stateFeatureServer },
  { county: "Campbell", fips: "47013", layerId: 77, source: "TN Comptroller FeatureServer", service: stateFeatureServer },
  { county: "Knox", fips: "47093", layerId: 3, source: "TN Comptroller NonImpact / Knox parcel map service", service: knoxFeatureServer, nonImpact: true },
  { county: "Loudon", fips: "47105", layerId: 38, source: "TN Comptroller FeatureServer", service: stateFeatureServer },
  { county: "Roane", fips: "47145", layerId: 19, source: "TN Comptroller FeatureServer", service: stateFeatureServer },
  { county: "Sevier", fips: "47155", layerId: 15, source: "TN Comptroller FeatureServer", service: stateFeatureServer },
  { county: "Union", fips: "47173", layerId: 7, source: "TN Comptroller FeatureServer", service: stateFeatureServer },
];

const bucketDefinitions = [
  { key: "under_1_acre", label: "Under 1 acre", where: "{acre} < 1" },
  { key: "one_to_5_acres", label: "1 to 5 acres", where: "{acre} >= 1 AND {acre} < 5" },
  { key: "five_to_20_acres", label: "5 to 20 acres", where: "{acre} >= 5 AND {acre} < 20" },
  { key: "twenty_to_50_acres", label: "20 to 50 acres", where: "{acre} >= 20 AND {acre} < 50" },
  { key: "fifty_plus_acres", label: "50+ acres", where: "{acre} >= 50" },
];

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse JSON from ${url}\n${text.slice(0, 240)}`);
  }
};

const layerUrl = (county) => `${county.service}/${county.layerId}`;

const queryUrl = (county, params) => {
  const url = new URL(`${layerUrl(county)}/query`);
  for (const [key, value] of Object.entries({ f: "json", ...params })) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const getCount = async (county, where = "1=1") => {
  const data = await fetchJson(queryUrl(county, { where, returnCountOnly: "true" }));
  if (typeof data.count !== "number") {
    throw new Error(`Missing count for ${county.county}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.count;
};

const getStats = async (county, fieldMap) => {
  const stats = [
    { statisticType: "sum", onStatisticField: fieldMap.acre, outStatisticFieldName: "total_acres" },
    { statisticType: "avg", onStatisticField: fieldMap.acre, outStatisticFieldName: "avg_acres" },
    { statisticType: "max", onStatisticField: fieldMap.acre, outStatisticFieldName: "max_acres" },
  ];

  if (fieldMap.landMarketValue) {
    stats.push(
      { statisticType: "sum", onStatisticField: fieldMap.landMarketValue, outStatisticFieldName: "total_land_market_value" },
      { statisticType: "avg", onStatisticField: fieldMap.landMarketValue, outStatisticFieldName: "avg_land_market_value" },
    );
  }
  if (fieldMap.appraisal) {
    stats.push(
      { statisticType: "sum", onStatisticField: fieldMap.appraisal, outStatisticFieldName: "total_appraisal_value" },
      { statisticType: "avg", onStatisticField: fieldMap.appraisal, outStatisticFieldName: "avg_appraisal_value" },
    );
  }
  if (fieldMap.buildings) {
    stats.push({ statisticType: "sum", onStatisticField: fieldMap.buildings, outStatisticFieldName: "building_count_sum" });
  }

  const data = await fetchJson(
    queryUrl(county, {
      where: "1=1",
      returnGeometry: "false",
      outStatistics: JSON.stringify(stats),
    }),
  );
  return data.features?.[0]?.attributes ?? {};
};

const getGroupedCounts = async (county, groupField, limit = 8) => {
  if (!groupField) return [];
  const data = await fetchJson(
    queryUrl(county, {
      where: `${groupField} IS NOT NULL`,
      returnGeometry: "false",
      groupByFieldsForStatistics: groupField,
      orderByFields: "parcel_count DESC",
      outStatistics: JSON.stringify([
        { statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "parcel_count" },
      ]),
    }),
  );
  return (data.features ?? [])
    .map((feature) => ({
      label: String(feature.attributes[groupField] ?? "").trim() || "Unknown",
      count: feature.attributes.parcel_count ?? 0,
    }))
    .filter((item) => item.count > 0)
    .slice(0, limit);
};

const findField = (fields, candidates) => {
  const names = new Set(fields.map((field) => field.name));
  return candidates.find((candidate) => names.has(candidate)) ?? null;
};

const detectFields = (county, layerInfo) => {
  const fields = layerInfo.fields ?? [];
  const fieldNames = fields.map((field) => field.name);
  const assessmentPrefix = fieldNames.find((name) => /^Assessment_Data_\d+_/.test(name))?.match(/^(Assessment_Data_\d+_)/)?.[1] ?? "";

  if (county.nonImpact) {
    return {
      acre: findField(fields, ["RECORDED_AREA", "CALCULATED_AREA", "SYS_CALC_AREA", "SQUARE_FEET"]),
      acreUnit: findField(fields, ["RECORDED_AREA", "CALCULATED_AREA", "SYS_CALC_AREA"]) ? "acres" : "square_feet",
      classField: findField(fields, ["TAX_CLASS", "PARCEL_TYPE", "PARCEL_TYPE_1"]),
      landUseField: findField(fields, ["LANDUSE"]),
      buildings: null,
      landMarketValue: null,
      appraisal: null,
    };
  }

  return {
    acre: findField(fields, ["Parcels_CALC_ACRE", `${assessmentPrefix}DEEDAC`]),
    acreUnit: "acres",
    classField: findField(fields, [`${assessmentPrefix}CLASS`]),
    landUseField: findField(fields, [`${assessmentPrefix}LANDUSE`]),
    buildings: findField(fields, [`${assessmentPrefix}BLDGS`]),
    landMarketValue: findField(fields, [`${assessmentPrefix}LANDMKTVAL`]),
    appraisal: findField(fields, [`${assessmentPrefix}APPRAISAL`]),
  };
};

const normalizeAcres = (value, unit) => {
  if (typeof value !== "number") return null;
  return unit === "square_feet" ? value / 43560 : value;
};

const round = (value, digits = 2) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
};

const importCounty = async (county) => {
  const layerInfo = await fetchJson(`${layerUrl(county)}?f=json`);
  const fields = detectFields(county, layerInfo);
  if (!fields.acre) {
    throw new Error(`No acreage field found for ${county.county}`);
  }

  const [parcelCount, stats, acreageBuckets, topClasses, topLandUses] = await Promise.all([
    getCount(county),
    getStats(county, fields),
    Promise.all(
      bucketDefinitions.map(async (bucket) => ({
        key: bucket.key,
        label: bucket.label,
        count: await getCount(county, bucket.where.replaceAll("{acre}", fields.acre)),
      })),
    ),
    getGroupedCounts(county, fields.classField),
    getGroupedCounts(county, fields.landUseField),
  ]);

  return {
    county: county.county,
    fips: county.fips,
    source: county.source,
    service_url: layerUrl(county),
    layer_name: layerInfo.name,
    last_edit_date: layerInfo.editingInfo?.lastEditDate ? new Date(layerInfo.editingInfo.lastEditDate).toISOString() : null,
    data_last_edit_date: layerInfo.editingInfo?.dataLastEditDate ? new Date(layerInfo.editingInfo.dataLastEditDate).toISOString() : null,
    fields_used: fields,
    parcel_count: parcelCount,
    total_acres: round(normalizeAcres(stats.total_acres, fields.acreUnit), 1),
    avg_acres: round(normalizeAcres(stats.avg_acres, fields.acreUnit), 2),
    max_acres: round(normalizeAcres(stats.max_acres, fields.acreUnit), 1),
    total_land_market_value: stats.total_land_market_value ?? null,
    avg_land_market_value: round(stats.avg_land_market_value, 0),
    total_appraisal_value: stats.total_appraisal_value ?? null,
    avg_appraisal_value: round(stats.avg_appraisal_value, 0),
    building_record_sum: stats.building_count_sum ?? null,
    acreage_buckets: acreageBuckets,
    top_classes: topClasses,
    top_land_uses: topLandUses,
  };
};

const main = async () => {
  const countySummaries = [];
  for (const county of counties) {
    console.log(`Importing ${county.county}...`);
    countySummaries.push(await importCounty(county));
  }

  const totals = countySummaries.reduce(
    (acc, county) => {
      acc.parcel_count += county.parcel_count ?? 0;
      acc.total_acres += county.total_acres ?? 0;
      acc.counties_loaded += 1;
      if (county.total_land_market_value) acc.total_land_market_value += county.total_land_market_value;
      if (county.total_appraisal_value) acc.total_appraisal_value += county.total_appraisal_value;
      return acc;
    },
    { counties_loaded: 0, parcel_count: 0, total_acres: 0, total_land_market_value: 0, total_appraisal_value: 0 },
  );

  const output = {
    generated_at: new Date().toISOString(),
    title: "Knoxville-East Tennessee Public Parcel Summary",
    privacy_note:
      "Public-safe aggregate import only. This file intentionally excludes owner names, mailing addresses, parcel IDs, and individual parcel geometry.",
    sources: [
      {
        name: "TNMap / ArcGIS TN_County_Parcel_Map FeatureServer",
        url: stateFeatureServer,
        counties: countySummaries.filter((county) => county.source === "TN Comptroller FeatureServer").map((county) => county.county),
      },
      {
        name: "Tennessee Comptroller NonImpact Parcels MapServer",
        url: knoxFeatureServer,
        counties: countySummaries.filter((county) => county.county === "Knox").map((county) => county.county),
      },
    ],
    totals: {
      counties_loaded: totals.counties_loaded,
      parcel_count: totals.parcel_count,
      total_acres: round(totals.total_acres, 1),
      total_land_market_value: totals.total_land_market_value || null,
      total_appraisal_value: totals.total_appraisal_value || null,
    },
    counties: countySummaries,
  };

  await fs.writeFile(
    "knoxville-market-dashboard/data/processed/parcel_summary.json",
    `${JSON.stringify(output, null, 2)}\n`,
  );
  console.log(`Wrote ${output.totals.parcel_count.toLocaleString()} parcels across ${output.totals.counties_loaded} counties.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
