import fs from "node:fs/promises";
import path from "node:path";

const DAY_MS = 86_400_000;

export function statusForAttempt({ previous, attemptedAt, ok, error }) {
  if (ok) return { status: "ok", attempted_at: attemptedAt, last_success_at: attemptedAt, error: null };
  const lastSuccessAt = previous?.last_success_at ?? null;
  return {
    status: lastSuccessAt ? "stale" : "failed",
    attempted_at: attemptedAt,
    last_success_at: lastSuccessAt,
    error: error || "Refresh failed",
  };
}

export function evaluateRefreshPolicy(statusDocument, { now = new Date(), staleDays = 7 } = {}) {
  if (!Number.isFinite(staleDays) || staleDays < 0) throw new Error("staleDays must be a non-negative number");
  // "frozen" sources have no available public source (e.g. Knox County after the
  // Comptroller service was retired). Their last-good data stays published, but
  // they no longer count toward the red/green rule.
  const sources = Object.entries(statusDocument.sources ?? {}).filter(([, source]) => source.status !== "frozen");
  const okCount = sources.filter(([, source]) => source.status === "ok").length;
  const staleCutoff = now.getTime() - staleDays * DAY_MS;
  const overdue = sources.filter(([, source]) => {
    if (source.status === "ok") return false;
    const timestamp = Date.parse(source.last_success_at ?? "");
    return !Number.isFinite(timestamp) || timestamp < staleCutoff;
  }).map(([id]) => id);
  const everySourceFailed = sources.length === 0 || okCount === 0;
  return {
    ok: !everySourceFailed && overdue.length === 0,
    stale_days: staleDays,
    ok_count: okCount,
    source_count: sources.length,
    every_source_failed: everySourceFailed,
    overdue_sources: overdue,
    rule: `red when every source fails in the run or any source has no success within ${staleDays} day(s); frozen sources excluded; green otherwise`,
  };
}

async function snapshotFiles(files) {
  const snapshot = new Map();
  for (const file of files) {
    try { snapshot.set(file, await fs.readFile(file)); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      snapshot.set(file, null);
    }
  }
  return snapshot;
}

async function restoreFiles(snapshot) {
  for (const [file, contents] of snapshot) {
    if (contents === null) await fs.rm(file, { force: true });
    else {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents);
    }
  }
}

export async function runIsolatedSources(sources, { execute, previousSources = {}, now = () => new Date(), log = console } = {}) {
  const results = {};
  for (const source of sources) {
    const attemptedAt = now().toISOString();
    const snapshot = await snapshotFiles(source.outputs ?? []);
    try {
      await execute(source);
      results[source.id] = { name: source.name, ...statusForAttempt({ attemptedAt, ok: true }) };
      log.log(`${source.name}: ok`);
    } catch (error) {
      await restoreFiles(snapshot);
      results[source.id] = {
        name: source.name,
        ...statusForAttempt({ previous: previousSources[source.id], attemptedAt, ok: false, error: error.message }),
      };
      log.error(`${source.name}: ${results[source.id].status} — ${error.message}`);
    }
  }
  return results;
}

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
