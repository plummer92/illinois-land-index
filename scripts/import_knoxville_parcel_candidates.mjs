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

const args = new Map(process.argv.slice(2).map((arg, index, all) => {
  if (!arg.startsWith("--")) return [arg, true];
  const next = all[index + 1];
  return [arg, next && !next.startsWith("--") ? next : true];
}));

const perCountyLimit = Number(args.get("--per-county") || 12);
const minAcres = Number(args.get("--min-acres") || 20);
const maxRingPoints = Number(args.get("--max-ring-points") || 90);
const coordinatePrecision = Number(args.get("--coordinate-precision") || 5);
const outputPath = String(args.get("--output") || "knoxville-market-dashboard/data/processed/parcel_candidates.geojson");

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
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

const findField = (fields, candidates) => {
  const names = new Set(fields.map((field) => field.name));
  return candidates.find((candidate) => names.has(candidate)) ?? null;
};

const detectFields = (county, layerInfo) => {
  const fields = layerInfo.fields ?? [];
  const fieldNames = fields.map((field) => field.name);
  const assessmentPrefix = fieldNames.find((name) => /^Assessment_Data_\d+_/.test(name))?.match(/^(Assessment_Data_\d+_)/)?.[1] ?? "";

  if (county.nonImpact) {
    const acre = findField(fields, ["RECORDED_AREA", "CALCULATED_AREA", "SYS_CALC_AREA", "SQUARE_FEET"]);
    return {
      objectId: findField(fields, ["OBJECTID", "FID"]),
      acre,
      acreUnit: findField(fields, ["RECORDED_AREA", "CALCULATED_AREA", "SYS_CALC_AREA"]) ? "acres" : "square_feet",
      classField: findField(fields, ["TAX_CLASS", "PARCEL_TYPE", "PARCEL_TYPE_1"]),
      landUseField: findField(fields, ["LANDUSE"]),
      buildings: null,
      landMarketValue: null,
      appraisal: null,
    };
  }

  return {
    objectId: findField(fields, ["OBJECTID", "FID"]),
    acre: findField(fields, ["Parcels_CALC_ACRE", `${assessmentPrefix}DEEDAC`]),
    acreUnit: "acres",
    classField: findField(fields, [`${assessmentPrefix}CLASS`]),
    landUseField: findField(fields, [`${assessmentPrefix}LANDUSE`]),
    buildings: findField(fields, [`${assessmentPrefix}BLDGS`]),
    landMarketValue: findField(fields, [`${assessmentPrefix}LANDMKTVAL`]),
    appraisal: findField(fields, [`${assessmentPrefix}APPRAISAL`]),
  };
};

const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeAcres = (value, unit) => {
  const number = asNumber(value);
  if (number === null) return null;
  return unit === "square_feet" ? number / 43560 : number;
};

const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
};

const simplifyCoordinate = (coordinate) => [
  round(Number(coordinate[0]), coordinatePrecision),
  round(Number(coordinate[1]), coordinatePrecision),
];

const simplifyRing = (ring) => {
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const step = Math.max(1, Math.ceil(ring.length / maxRingPoints));
  const simplified = ring
    .filter((_, index) => index % step === 0 || index === ring.length - 1)
    .map(simplifyCoordinate);
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    simplified.push([...first]);
  }
  return simplified.length >= 4 ? simplified : ring.slice(0, 4).map(simplifyCoordinate);
};

const arcgisGeometryToGeoJson = (geometry) => {
  if (!geometry?.rings?.length) return null;
  return {
    type: "Polygon",
    coordinates: geometry.rings.map(simplifyRing).filter((ring) => ring.length >= 4),
  };
};

const centroidFromGeometry = (geometry) => {
  const ring = geometry?.coordinates?.[0] || [];
  if (!ring.length) return null;
  const sums = ring.reduce((acc, coord) => {
    acc.lon += Number(coord[0]) || 0;
    acc.lat += Number(coord[1]) || 0;
    return acc;
  }, { lon: 0, lat: 0 });
  return [round(sums.lon / ring.length, 6), round(sums.lat / ring.length, 6)];
};

const scoreCandidate = ({ acres, buildingCount, landMarketValue, appraisalValue, landUse, parcelClass }) => {
  let score = 0;
  if (acres >= 50) score += 35;
  else if (acres >= 20) score += 24;
  else if (acres >= 10) score += 12;
  if (buildingCount === 0) score += 16;
  if (buildingCount && buildingCount <= 1) score += 8;
  if (/agric|farm|forest|vacant|rural|unimproved|land/i.test(`${landUse} ${parcelClass}`)) score += 18;
  if (landMarketValue && acres) {
    const landPerAcre = landMarketValue / acres;
    if (landPerAcre < 15000) score += 12;
    else if (landPerAcre < 30000) score += 6;
  }
  if (appraisalValue && landMarketValue && landMarketValue / appraisalValue > 0.55) score += 10;
  return Math.min(100, Math.round(score));
};

const queryCountyCandidates = async (county, fields) => {
  const rawThreshold = fields.acreUnit === "square_feet" ? minAcres * 43560 : minAcres;
  const outFields = [
    fields.objectId,
    fields.acre,
    fields.classField,
    fields.landUseField,
    fields.buildings,
    fields.landMarketValue,
    fields.appraisal,
  ].filter(Boolean).join(",");

  const data = await fetchJson(queryUrl(county, {
    where: `${fields.acre} >= ${rawThreshold}`,
    returnGeometry: "true",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    orderByFields: `${fields.acre} DESC`,
    resultRecordCount: String(perCountyLimit),
  }));

  if (data.error) throw new Error(`${county.county}: ${JSON.stringify(data.error)}`);
  return data.features ?? [];
};

const importCounty = async (county) => {
  console.log(`Importing ${county.county} parcel candidates...`);
  const layerInfo = await fetchJson(`${layerUrl(county)}?f=json`);
  const fields = detectFields(county, layerInfo);
  if (!fields.acre) throw new Error(`No acreage field found for ${county.county}`);

  const features = await queryCountyCandidates(county, fields);
  return features.map((feature, index) => {
    const attrs = feature.attributes ?? {};
    const acres = round(normalizeAcres(attrs[fields.acre], fields.acreUnit), 2);
    const buildingCount = fields.buildings ? asNumber(attrs[fields.buildings]) : null;
    const landMarketValue = fields.landMarketValue ? asNumber(attrs[fields.landMarketValue]) : null;
    const appraisalValue = fields.appraisal ? asNumber(attrs[fields.appraisal]) : null;
    const parcelClass = fields.classField ? String(attrs[fields.classField] ?? "").trim() : "";
    const landUse = fields.landUseField ? String(attrs[fields.landUseField] ?? "").trim() : "";
    const geometry = arcgisGeometryToGeoJson(feature.geometry);
    const score = scoreCandidate({ acres, buildingCount, landMarketValue, appraisalValue, landUse, parcelClass });

    return {
      type: "Feature",
      geometry,
      properties: {
        candidate_id: `${county.fips}-${index + 1}`,
        county: county.county,
        fips: county.fips,
        acres,
        parcel_class: parcelClass || "Not classified",
        land_use: landUse || "Not classified",
        building_count: buildingCount,
        land_market_value: landMarketValue,
        appraisal_value: appraisalValue,
        land_value_per_acre: landMarketValue && acres ? round(landMarketValue / acres, 0) : null,
        score,
        source: county.source,
        source_layer: layerUrl(county),
        centroid: geometry ? centroidFromGeometry(geometry) : null,
        note: "Public-safe candidate geometry. Owner names, mailing addresses, and parcel identifiers are intentionally excluded.",
      },
    };
  }).filter((feature) => feature.geometry);
};

const main = async () => {
  const countyFeatures = [];
  for (const county of counties) {
    countyFeatures.push(...await importCounty(county));
  }
  const output = {
    type: "FeatureCollection",
    generated_at: new Date().toISOString(),
    title: "Knoxville-East Tennessee Public Parcel Candidate Geometry",
    privacy_note: "Public-safe parcel candidate geometry for dashboard screening only. Owner names, mailing addresses, and parcel identifiers are intentionally excluded.",
    selection_logic: `${minAcres}+ acre parcels, capped at ${perCountyLimit} largest candidates per county before terrain, flood, zoning, utility, and access validation. Geometry is simplified for web-map performance.`,
    features: countyFeatures.sort((a, b) => (b.properties.score - a.properties.score) || (b.properties.acres - a.properties.acres)),
  };

  await fs.writeFile(outputPath, `${JSON.stringify(output)}\n`);
  console.log(`Wrote ${output.features.length.toLocaleString()} parcel candidate geometries to ${outputPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
