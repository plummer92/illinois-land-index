import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createTaxApi} from "../api/worker.mjs";

const ORIGIN = "https://illinoislandindex.com";
const WWW = "https://www.illinoislandindex.com";
const PIN = "29060453009";
const API = "https://tax-api.example.test";
const stamp = Date.parse("2026-11-15T18:00:00Z");
const record = pin => ({status: "ok", pin, tax_year: 2025, total_cents: 10001, districts: [
  {name: "SCHOOL DISTRICT", amount_cents: 7000, category: "schools"},
  {name: "VILLAGE", amount_cents: 3001, category: "village"}
]});
const html = text => new Response(text || "<html>county fixture</html>", {headers: {"Content-Type": "text/html; charset=UTF-8"}});
function request(body = {pin: PIN}, headers = {}, path = "/tax-breakdown") {
  return new Request(API + path, {method: "POST", headers: {Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1", ...headers}, body: typeof body === "string" ? body : JSON.stringify(body)});
}
function fakeCache() {
  const entries = new Map();
  const writes = [];
  return {entries, writes,
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, response) { writes.push({key: key.url, headers: new Headers(response.headers)}); entries.set(key.url, response.clone()); }
  };
}
function setup(overrides = {}) {
  const calls = [];
  const cache = fakeCache();
  const api = createTaxApi({now: () => stamp, cache, parseBill: (_, pin) => record(pin),
    fetchImpl: async (...args) => { calls.push(args); return html(); }, ...overrides});
  return {api, calls, cache};
}

test("strict allowlist omits private parser fields and never forwards incoming credentials", async () => {
  const {api, calls, cache} = setup({parseBill: (_, pin) => ({...record(pin), owner: "PRIVATE OWNER", html: "SECRET", balance: 88,
    districts: record(pin).districts.map(row => ({...row, address: "PRIVATE MAILING ADDRESS"}))})});
  const response = await api.fetch(request({pin: PIN}, {Cookie: "private_session=secret", Authorization: "Bearer secret"}));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ["districts", "fetched_at", "pin", "source_url", "status", "tax_year", "total_cents"].sort());
  assert.deepEqual(data.districts, record(PIN).districts);
  assert.equal(data.fetched_at, new Date(stamp).toISOString());
  const [url, init] = calls[0];
  assert.equal(url, "https://tax.sangamonil.gov/SangamonCountyWeb/app/taxBillDetails.action?parcelNumber=" + PIN);
  assert.equal(init.redirect, "manual"); assert.equal(init.credentials, "omit");
  assert.equal(init.method, "GET"); assert.equal(init.headers.Cookie, undefined); assert.equal(init.headers.Authorization, undefined);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(cache.writes[0].headers.get("Cache-Control"), "public, max-age=86400");
  assert.equal(cache.writes[0].headers.get("Access-Control-Allow-Origin"), null);
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE|SECRET|balance/);
});

test("invalid parcel, extra fields, malformed JSON and all query parameters fail before county access", async () => {
  const {api, calls, cache} = setup();
  const bad = [null, [], {}, {pin: 29060453009}, {pin: ""}, {pin: "29060453009&evil=1"}, {pin: "2906045300"}, {pin: "290604530090"},
    {pin: PIN, url: "https://evil.invalid"}, {pin: PIN, taxYear: 2024}, '{"pin":', '"29060453009"'];
  for (const body of bad) assert.equal((await api.fetch(request(body))).status, 400);
  assert.equal((await api.fetch(request({pin: PIN}, {}, "/tax-breakdown?pin=" + PIN))).status, 400);
  assert.equal(calls.length, 0); assert.equal(cache.writes.length, 0);
});

test("512-byte request bound is enforced on streamed bytes without trusting Content-Length", async () => {
  const {api, calls} = setup();
  assert.equal((await api.fetch(request({pin: PIN}, {"Content-Length": "513"}))).status, 413);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({start(controller) { controller.enqueue(encoder.encode('{"pin":"')); controller.enqueue(encoder.encode("x".repeat(510))); controller.enqueue(encoder.encode('"}')); controller.close(); }});
  const streamed = new Request(API + "/tax-breakdown", {method: "POST", duplex: "half", headers: {Origin: ORIGIN, "Content-Type": "application/json"}, body: stream});
  assert.equal((await api.fetch(streamed)).status, 413);
  assert.equal((await api.fetch(request(" ".repeat(492) + JSON.stringify({pin: PIN})))).status, 413);
  assert.equal(calls.length, 0);
});

test("exact origin allowlist, production localhost denial and opt-in development origin", async () => {
  const {api, calls} = setup();
  for (const origin of ["null", "https://illinoislandindex.com.evil.test", "http://illinoislandindex.com", "https://illinoislandindex.com/", "http://127.0.0.1:8768"]) {
    const response = await api.fetch(request({pin: PIN}, {Origin: origin}));
    assert.equal(response.status, 403); assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
  assert.equal(calls.length, 0);
  const dev = await api.fetch(request({pin: PIN}, {Origin: "http://127.0.0.1:8768"}), {DEVELOPMENT: "true"});
  assert.equal(dev.status, 200); assert.equal(dev.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8768");
  assert.equal((await api.fetch(request({pin: PIN}, {Origin: "http://127.0.0.1:8768"}), {DEVELOPMENT: true})).status, 403);
});

test("preflight requires only POST and Content-Type; no authentication or credential allowance", async () => {
  const {api, calls} = setup();
  const preflight = headers => new Request(API + "/tax-breakdown", {method: "OPTIONS", headers: {Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type", ...headers}});
  const response = await api.fetch(preflight());
  assert.equal(response.status, 204); assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  assert.match(response.headers.get("Vary"), /Origin/);
  for (const headers of [{"Access-Control-Request-Method": "GET"}, {"Access-Control-Request-Headers": "authorization"}, {Origin: "https://evil.test"}]) {
    assert.equal((await api.fetch(preflight(headers))).status, 403);
  }
  assert.equal(calls.length, 0);
});

test("one internal cache entry receives per-request CORS without leaking cross-origin headers", async () => {
  const {api, calls, cache} = setup();
  const one = await api.fetch(request());
  const two = await api.fetch(request({pin: PIN}, {Origin: WWW}));
  assert.equal(one.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(two.headers.get("Access-Control-Allow-Origin"), WWW);
  assert.equal(two.headers.get("Vary"), "Origin");
  assert.equal(two.headers.get("Cache-Control"), "no-store");
  assert.equal(calls.length, 1); assert.equal(cache.entries.size, 1);
  assert.deepEqual(await one.json(), await two.json());
});

test("cache is keyed by exact parcel and rejects expired or wrong-parcel cache entries", async () => {
  let time = stamp;
  const {api, calls, cache} = setup({now: () => time});
  await api.fetch(request());
  const secondPin = "29060453010";
  const second = await api.fetch(request({pin: secondPin}));
  assert.equal((await second.json()).pin, secondPin); assert.equal(calls.length, 2);
  const originalKey = cache.writes[0].key;
  const wrong = {...record(secondPin), fetched_at: new Date(stamp).toISOString(), source_url: "https://wrong.invalid"};
  cache.entries.set(originalKey, new Response(JSON.stringify(wrong)));
  assert.equal((await api.fetch(request())).status, 200); assert.equal(calls.length, 3);
  time += 86400000;
  assert.equal((await api.fetch(request())).status, 200); assert.equal(calls.length, 4);
});

test("verified no-bill has only allowlisted fields and a five-minute internal cache", async () => {
  let time = stamp;
  const {api, calls, cache} = setup({now: () => time, parseBill: (_, pin) => ({status: "no_bill", pin, owner: "PRIVATE"})});
  const response = await api.fetch(request());
  assert.deepEqual(Object.keys(await response.json()).sort(), ["status", "pin", "fetched_at", "source_url"].sort());
  assert.equal(cache.writes[0].headers.get("Cache-Control"), "public, max-age=300");
  await api.fetch(request()); assert.equal(calls.length, 1);
  time += 300000; await api.fetch(request()); assert.equal(calls.length, 2);
});

test("upstream errors, redirects, non-HTML and oversized HTML never enter cache or echo county data", async () => {
  const variations = [
    async () => { throw Error("PRIVATE upstream diagnostic"); },
    async () => new Response("PRIVATE", {status: 500, headers: {"Content-Type": "text/html"}}),
    async () => new Response("PRIVATE", {status: 302, headers: {Location: "https://evil.test", "Content-Type": "text/html"}}),
    async () => new Response("PRIVATE", {headers: {"Content-Type": "application/json"}}),
    async () => new Response("PRIVATE", {headers: {"Content-Type": "text/html", "Content-Length": String(512 * 1024 + 1)}}),
    async () => html("x".repeat(512 * 1024 + 1))
  ];
  for (const fetchImpl of variations) {
    const {api, cache} = setup({fetchImpl});
    const response = await api.fetch(request());
    assert.equal(response.status, 502); assert.equal(cache.writes.length, 0);
    assert.doesNotMatch(await response.text(), /PRIVATE|evil\.test|<html>/);
  }
});

test("Workers-compatible manual redirect mode never follows a county redirect", async () => {
  let calls = 0;
  const {api, cache} = setup({fetchImpl: async (_, init) => {
    calls++;
    // Workers rejects redirect:'error' before it sends a request.
    assert.equal(init.redirect, "manual");
    return new Response(null, {status: 302, headers: {Location: "https://other.invalid/private", "Content-Type": "text/html"}});
  }});
  const response = await api.fetch(request());
  assert.equal(response.status, 502); assert.equal(calls, 1); assert.equal(cache.writes.length, 0);
  assert.doesNotMatch(await response.text(), /other\.invalid|private/);
});

test("parser errors and mismatched parcel/year/amounts/categories never produce a valid bill or cache", async () => {
  for (const parseBill of [
    () => { throw Error("PRIVATE original HTML"); },
    () => ({...record(PIN), pin: "29060453010"}),
    () => ({...record(PIN), tax_year: "2025"}),
    () => ({...record(PIN), total_cents: 1}),
    () => ({...record(PIN), districts: []}),
    () => ({...record(PIN), districts: [{name: "COUNTY", category: "owner", amount_cents: 10001}]}),
    () => ({status: "no_bill", pin: "29060453010"})
  ]) {
    const {api, cache} = setup({parseBill});
    const response = await api.fetch(request());
    assert.equal(response.status, 502); assert.equal(cache.writes.length, 0);
    assert.doesNotMatch(await response.text(), /PRIVATE|original HTML/);
  }
});

test("expired cached bill is never served when the new county fetch fails", async () => {
  let time = stamp, attempt = 0;
  const {api, cache} = setup({now: () => time, fetchImpl: async () => { if (++attempt > 1) throw Error("down"); return html(); }});
  assert.equal((await api.fetch(request())).status, 200);
  time += 86400000;
  const unavailable = await api.fetch(request());
  assert.equal(unavailable.status, 502); assert.equal((await unavailable.json()).status, "error");
  assert.equal(cache.writes.length, 1);
});

test("timeout aborts upstream and returns a safe error without caching", async () => {
  let signal;
  const {api, cache} = setup({timeoutMs: 10, fetchImpl: async (_, init) => { signal = init.signal; return new Promise(() => {}); }});
  const response = await api.fetch(request());
  assert.equal(response.status, 504); assert.equal(signal.aborted, true); assert.equal(cache.writes.length, 0);
});

test("simultaneous same-parcel misses share one upstream fetch", async () => {
  let release, calls = 0;
  const {api} = setup({fetchImpl: () => { calls++; return new Promise(resolve => { release = () => resolve(html()); }); }});
  const first = api.fetch(request());
  const second = api.fetch(request({pin: PIN}, {Origin: WWW}));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(b.headers.get("Access-Control-Allow-Origin"), WWW);
});

test("at most four different uncached county requests run concurrently; failed slots are released", async () => {
  const releases = [];
  const {api} = setup({cache: null, fetchImpl: () => new Promise(resolve => releases.push(() => resolve(html())))});
  const running = ["29060453001", "29060453002", "29060453003", "29060453004"].map(pin => api.fetch(request({pin})));
  while (releases.length < 4) await new Promise(resolve => setImmediate(resolve));
  const rejected = await api.fetch(request({pin: "29060453005"}));
  assert.equal(rejected.status, 503); assert.equal(rejected.headers.get("Retry-After"), "5");
  releases.forEach(resolve => resolve());
  assert.ok((await Promise.all(running)).every(response => response.status === 200));
  const next = api.fetch(request({pin: "29060453005"}));
  while (releases.length < 5) await new Promise(resolve => setImmediate(resolve));
  releases[4](); assert.equal((await next).status, 200);
});

test("60-per-minute IP bound applies to cached requests, resets, and is independent by IP", async () => {
  let time = stamp;
  const {api, calls} = setup({now: () => time});
  for (let i = 0; i < 60; i++) assert.equal((await api.fetch(request())).status, 200);
  const limited = await api.fetch(request());
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("Retry-After"), "60");
  assert.equal((await api.fetch(request({pin: PIN}, {"CF-Connecting-IP": "192.0.2.2"}))).status, 200);
  time += 60000; assert.equal((await api.fetch(request())).status, 200);
  assert.equal(calls.length, 1);
});

test("cache API failures do not discard a valid county response", async () => {
  const {api} = setup({cache: {match: async () => {throw Error("cache down");}, put: async () => {throw Error("cache down");}}});
  assert.equal((await api.fetch(request())).status, 200);
});

test("only health, landing page and JSON POST are public routes", async () => {
  const {api, calls} = setup();
  const health = await api.fetch(new Request(API + "/health"));
  assert.deepEqual(Object.keys(await health.json()).sort(), ["service", "version"]);
  const page = await api.fetch(new Request(API + "/"));
  assert.match(page.headers.get("Content-Type"), /text\/html/);
  const text = await page.text();
  assert.match(text, /https:\/\/illinoislandindex\.com\/parcel-dashboard\//);
  assert.doesNotMatch(text, /<form|<script|analytics|gtag|PIN/);
  assert.equal((await api.fetch(new Request(API + "/admin"))).status, 404);
  assert.equal((await api.fetch(new Request(API + "/tax-breakdown"))).status, 405);
  assert.equal((await api.fetch(request({pin: PIN}, {}, "/health"))).status, 405);
  assert.equal((await api.fetch(request({pin: PIN}, {"Content-Type": "text/plain"}))).status, 415);
  assert.equal(calls.length, 0);
});

test("real parser integrates with the sanitized county fixture", async () => {
  const fixture = readFileSync(new URL("./fixtures/tax-residential.html", import.meta.url), "utf8");
  const api = createTaxApi({cache: null, now: () => stamp, fetchImpl: async () => html(fixture)});
  const response = await api.fetch(request());
  assert.equal(response.status, 200);
  const bill = await response.json();
  assert.equal(bill.status, "ok"); assert.equal(bill.pin, PIN); assert.equal(bill.tax_year, 2025);
  assert.equal(bill.districts.reduce((sum, row) => sum + row.amount_cents, 0), bill.total_cents);
});
