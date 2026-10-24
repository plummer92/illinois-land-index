import { evaluateRefreshPolicy, readJson } from "./lib/refresh_status.mjs";

const statusPath = "data/refresh_status.json";
const staleDays = Number(process.env.PUBLIC_DATA_STALE_DAYS ?? "7");
const status = await readJson(statusPath);
if (!status) {
  console.error(`Missing ${statusPath}`);
  process.exitCode = 1;
} else {
  const policy = evaluateRefreshPolicy(status, { staleDays });
  console.log(policy.rule);
  console.log(`${policy.ok_count}/${policy.source_count} sources refreshed successfully.`);
  if (policy.overdue_sources.length) console.error(`Overdue sources: ${policy.overdue_sources.join(", ")}`);
  if (policy.every_source_failed) console.error("Every configured source failed or remained stale.");
  process.exitCode = policy.ok ? 0 : 1;
}
