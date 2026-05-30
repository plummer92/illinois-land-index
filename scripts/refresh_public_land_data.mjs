import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const steps = [
  {
    name: "Knoxville parcel summary",
    command: "node",
    args: ["scripts/import_knoxville_parcel_summary.mjs"],
  },
  {
    name: "Knoxville parcel candidates",
    command: "node",
    args: ["scripts/import_knoxville_parcel_candidates.mjs"],
  },
];

const run = (step) => new Promise((resolve, reject) => {
  console.log(`\n==> ${step.name}`);
  const child = spawn(step.command, step.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${step.name} failed with exit code ${code}`));
  });
  child.on("error", reject);
});

const main = async () => {
  for (const step of steps) {
    await run(step);
  }

  await fs.writeFile(
    "knoxville-market-dashboard/data/processed/refresh_status.json",
    `${JSON.stringify({
      generated_at: new Date().toISOString(),
      status: "ok",
      steps: steps.map((step) => step.name),
    }, null, 2)}\n`,
  );

  console.log("\nPublic land data refresh complete.");
};

main().catch(async (error) => {
  console.error(error);
  try {
    await fs.writeFile(
      "knoxville-market-dashboard/data/processed/refresh_status.json",
      `${JSON.stringify({
        generated_at: new Date().toISOString(),
        status: "failed",
        error: error.message,
      }, null, 2)}\n`,
    );
  } catch {
    // Preserve the original failure as the command result.
  }
  process.exitCode = 1;
});
