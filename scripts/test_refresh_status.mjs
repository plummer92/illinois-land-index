import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateRefreshPolicy, runIsolatedSources, statusForAttempt } from "./lib/refresh_status.mjs";

test("a failed source is restored and does not stop later sources", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "land-index-refresh-"));
  const first = path.join(directory, "first.json");
  const second = path.join(directory, "second.json");
  await fs.writeFile(first, "last good");
  const visited = [];
  const results = await runIsolatedSources([
    { id: "first", name: "First", outputs: [first] },
    { id: "second", name: "Second", outputs: [second] },
  ], {
    previousSources: { first: { last_success_at: "2026-10-20T00:00:00.000Z" } },
    now: () => new Date("2026-10-24T00:00:00.000Z"),
    log: { log() {}, error() {} },
    execute: async (source) => {
      visited.push(source.id);
      if (source.id === "first") {
        await fs.writeFile(first, "partial bad write");
        throw new Error("offline");
      }
      await fs.writeFile(second, "fresh");
    },
  });
  assert.deepEqual(visited, ["first", "second"]);
  assert.equal(await fs.readFile(first, "utf8"), "last good");
  assert.equal(await fs.readFile(second, "utf8"), "fresh");
  assert.equal(results.first.status, "stale");
  assert.equal(results.second.status, "ok");
});

test("failed sources retain last success and new failures are failed, not stale", () => {
  const attemptedAt = "2026-10-24T00:00:00.000Z";
  assert.deepEqual(statusForAttempt({ previous: { last_success_at: "2026-10-23T00:00:00.000Z" }, attemptedAt, ok: false, error: "down" }), {
    status: "stale", attempted_at: attemptedAt, last_success_at: "2026-10-23T00:00:00.000Z", error: "down",
  });
  assert.equal(statusForAttempt({ attemptedAt, ok: false, error: "down" }).status, "failed");
});

test("policy stays green for a partial recent outage", () => {
  const policy = evaluateRefreshPolicy({ sources: {
    one: { status: "ok", last_success_at: "2026-10-24T00:00:00.000Z" },
    two: { status: "stale", last_success_at: "2026-10-20T00:00:00.000Z" },
  } }, { now: new Date("2026-10-24T12:00:00.000Z"), staleDays: 7 });
  assert.equal(policy.ok, true);
  assert.deepEqual(policy.overdue_sources, []);
});

test("policy is red when every source fails or any source exceeds the configurable threshold", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");
  assert.equal(evaluateRefreshPolicy({ sources: {
    one: { status: "stale", last_success_at: "2026-10-24T00:00:00.000Z" },
    two: { status: "failed", last_success_at: null },
  } }, { now, staleDays: 7 }).every_source_failed, true);
  const overdue = evaluateRefreshPolicy({ sources: {
    one: { status: "ok", last_success_at: "2026-10-24T00:00:00.000Z" },
    two: { status: "stale", last_success_at: "2026-10-16T00:00:00.000Z" },
  } }, { now, staleDays: 7 });
  assert.equal(overdue.ok, false);
  assert.deepEqual(overdue.overdue_sources, ["two"]);
});

test("frozen sources are shown but excluded from the red/green rule", () => {
  const policy = evaluateRefreshPolicy({ sources: {
    live: { status: "ok", last_success_at: "2026-10-24T00:00:00.000Z" },
    knox: { status: "frozen", last_success_at: "2026-10-15T00:00:00.000Z" },
  } }, { now: new Date("2026-10-24T12:00:00.000Z"), staleDays: 7 });
  assert.equal(policy.ok, true);
  assert.deepEqual(policy.overdue_sources, []);
  assert.equal(policy.source_count, 1);
});
