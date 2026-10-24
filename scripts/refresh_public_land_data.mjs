import { spawn } from "node:child_process";
import { evaluateRefreshPolicy, readJson, runIsolatedSources, writeJson } from "./lib/refresh_status.mjs";

const statusPath = "data/refresh_status.json";
const gilpinCandidates = ["gilpin", "boulder", "clear-creek", "grand", "jefferson"]
  .map((county) => `gilpin-county-dashboard/data/processed/candidates-${county}.json`);

const sources = [
  {
    id: "tennessee_statewide_parcels",
    name: "Tennessee statewide parcels (seven Knoxville-area counties)",
    commands: [
      ["node", ["scripts/import_knoxville_parcel_summary.mjs"]],
      ["node", ["scripts/import_knoxville_parcel_candidates.mjs"]],
    ],
    outputs: [
      "knoxville-market-dashboard/data/processed/parcel_summary.json",
      "knoxville-market-dashboard/data/processed/parcel_candidates.geojson",
    ],
  },
  {
    id: "indiana_statewide_parcels",
    name: "Indiana statewide parcels (Indianapolis area)",
    commands: [
      ["node", ["scripts/import_indianapolis_parcel_summary.mjs"]],
      ["node", ["scripts/import_indianapolis_parcel_candidates.mjs"]],
    ],
    outputs: [
      "indianapolis-market-dashboard/data/processed/parcel_summary.json",
      "indianapolis-market-dashboard/data/processed/parcel_candidates.geojson",
    ],
  },
  {
    id: "colorado_statewide_parcels",
    name: "Colorado statewide parcels (Gilpin area)",
    commands: [["node", ["scripts/import_gilpin_parcels.mjs"]]],
    outputs: ["gilpin-county-dashboard/data/processed/gilpin_parcel_snapshot.json", ...gilpinCandidates],
  },
  {
    id: "colorado_property_taxes",
    name: "Colorado property taxes",
    commands: [[process.platform === "win32" ? "python" : "python3", ["scripts/import_colorado_property_taxes.py"]]],
    outputs: ["gilpin-county-dashboard/data/processed/colorado_property_tax_snapshot.json", ...gilpinCandidates],
  },
];

const spawnCommand = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit", shell: false });
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)));
  child.on("error", reject);
});

const execute = async (source) => {
  for (const [command, args] of source.commands) {
    console.log(`\n==> ${source.name}: ${command} ${args.join(" ")}`);
    await spawnCommand(command, args);
  }
};

const previous = await readJson(statusPath, { sources: {} });
const bootstrapFiles = {
  tennessee_statewide_parcels: "knoxville-market-dashboard/data/processed/parcel_summary.json",
  indiana_statewide_parcels: "indianapolis-market-dashboard/data/processed/parcel_summary.json",
  colorado_statewide_parcels: "gilpin-county-dashboard/data/processed/gilpin_parcel_snapshot.json",
  colorado_property_taxes: "gilpin-county-dashboard/data/processed/colorado_property_tax_snapshot.json",
};
for (const [id, file] of Object.entries(bootstrapFiles)) {
  if (previous.sources[id]?.last_success_at) continue;
  const payload = await readJson(file);
  if (payload?.generated_at) previous.sources[id] = { last_success_at: payload.generated_at };
}
const generatedAt = new Date().toISOString();
const results = await runIsolatedSources(sources, { execute, previousSources: previous.sources });
const summary = await readJson("knoxville-market-dashboard/data/processed/parcel_summary.json");
const previousKnox = previous.sources?.knox_county_parcels;
const knoxLastGood = previousKnox?.last_success_at
  ?? summary?.counties?.find((county) => county.county === "Knox")?.data_as_of
  ?? "2026-10-15T15:38:58.574Z";

results.knox_county_parcels = {
  name: "Knox County parcels",
  status: "frozen",
  attempted_at: generatedAt,
  last_success_at: knoxLastGood,
  error: "No acceptable public no-login source is available: the Comptroller service was retired, the replacement statewide service excludes Knox, and KGIS requires authorization or a data license.",
};

const status = { generated_at: generatedAt, sources: results };
status.policy = evaluateRefreshPolicy(status, { staleDays: Number(process.env.PUBLIC_DATA_STALE_DAYS ?? "7") });
await writeJson(statusPath, status);
await writeJson("knoxville-market-dashboard/data/processed/refresh_status.json", {
  generated_at: generatedAt,
  policy: status.policy,
  sources: Object.fromEntries(Object.entries(results).filter(([id]) => id.includes("tennessee") || id.includes("knox"))),
});
await writeJson("indianapolis-market-dashboard/data/processed/refresh_status.json", {
  generated_at: generatedAt,
  policy: status.policy,
  sources: { indiana_statewide_parcels: results.indiana_statewide_parcels },
});
await writeJson("gilpin-county-dashboard/data/processed/refresh_status.json", {
  generated_at: generatedAt,
  policy: status.policy,
  sources: Object.fromEntries(Object.entries(results).filter(([id]) => id.includes("colorado"))),
});

console.log(`\n${status.policy.rule}`);
console.log("Refresh attempts complete; policy enforcement runs after the workflow commits successful outputs.");
