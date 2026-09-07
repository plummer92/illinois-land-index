import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "./lib/fetch_json.mjs";

const url = "https://example.test/FeatureServer/83/query?f=json";
const quiet = { sleep: async () => {}, warn: () => {} };

test("retries the observed connection timeout and returns a later successful payload", async () => {
  let calls = 0;
  const sleeps = [];
  const payload = await fetchJson(url, { ...quiet, sleep: async (ms) => sleeps.push(ms), fetchImpl: async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ETIMEDOUT" }) });
    return Response.json({ count: 123 });
  } });
  assert.deepEqual(payload, { count: 123 });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
});

test("permanent HTTP errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(fetchJson(url, { ...quiet, fetchImpl: async () => {
    calls += 1; return new Response("missing", { status: 404 });
  } }), /after 1 attempt.*HTTP 404/);
  assert.equal(calls, 1);
});

test("rate-limit Retry-After is respected within the wait bound", async () => {
  let calls = 0;
  const sleeps = [];
  const payload = await fetchJson(url, { ...quiet, sleep: async (ms) => sleeps.push(ms), fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? new Response("busy", { status: 429, headers: { "retry-after": "7" } }) : Response.json({ count: 7 });
  } });
  assert.equal(payload.count, 7);
  assert.deepEqual(sleeps, [7000]);
});

test("a long server backoff fails without retrying earlier than requested", async () => {
  let calls = 0;
  await assert.rejects(fetchJson(url, { ...quiet, sleep: async () => assert.fail("Must not retry a long backoff"), fetchImpl: async () => {
    calls += 1; return new Response("busy", { status: 429, headers: { "retry-after": "120" } });
  } }), /after 1 attempt.*HTTP 429/);
  assert.equal(calls, 1);
});

test("server failures exhaust the fixed budget and remain failures", async () => {
  let calls = 0;
  const sleeps = [];
  await assert.rejects(fetchJson(url, { ...quiet, sleep: async (ms) => sleeps.push(ms), fetchImpl: async () => {
    calls += 1; return new Response("down", { status: 503 });
  } }), /after 4 attempt.*HTTP 503/);
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
});

test("a stalled request is aborted and retried with a fresh signal", async () => {
  const signals = [];
  const payload = await fetchJson(url, { ...quiet, timeoutMs: 5, fetchImpl: async (_url, { signal }) => {
    signals.push(signal);
    if (signals.length === 1) return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    return Response.json({ ok: true });
  } });
  assert.equal(payload.ok, true);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test("the deadline also covers reading the response body", async () => {
  let calls = 0;
  await assert.rejects(fetchJson(url, { ...quiet, attempts: 2, timeoutMs: 5, fetchImpl: async (_url, { signal }) => {
    calls += 1;
    return { ok: true, text: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) };
  } }), /after 2 attempt.*deadline/);
  assert.equal(calls, 2);
});

test("invalid successful JSON is not silently treated as empty data", async () => {
  let calls = 0;
  await assert.rejects(fetchJson(url, { ...quiet, fetchImpl: async () => {
    calls += 1; return new Response("not JSON");
  } }), /invalid JSON/);
  assert.equal(calls, 1);
});

test("ArcGIS permanent errors fail; transient service errors retry", async () => {
  await assert.rejects(fetchJson(url, { ...quiet, fetchImpl: async () => Response.json({ error: { code: 400, message: "Bad query" } }) }), /after 1 attempt.*Bad query/);
  let calls = 0;
  assert.deepEqual(await fetchJson(url, { ...quiet, fetchImpl: async () => {
    calls += 1;
    return Response.json(calls === 1 ? { error: { code: 503, message: "Busy" } } : { features: [] });
  } }), { features: [] });
  assert.equal(calls, 2);
});
