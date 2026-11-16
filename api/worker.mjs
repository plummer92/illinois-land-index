import {parseTaxBill} from "./tax-parser.mjs";

const VERSION = "2026-11-15.2";
const UPSTREAM = "https://tax.sangamonil.gov/SangamonCountyWeb/app/taxBillDetails.action";
const ORIGINS = new Set(["https://illinoislandindex.com", "https://www.illinoislandindex.com"]);
const REQUEST_LIMIT = 512;
const HTML_LIMIT = 512 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const NO_BILL_TTL = 5 * 60 * 1000;
const MAX_IPS = 4096;
const CATEGORIES = new Set(["schools", "village", "county", "other"]);

class SafeError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const upstreamError = () => new SafeError(502, "upstream_unavailable", "The county tax record could not be verified. Please try again later.");

async function boundedText(body, maximum, oversized) {
  if (!body) return "";
  const reader = body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        void reader.cancel().catch(() => {});
        throw oversized;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
}

// Rebuild the response rather than serializing arbitrary parser/cache properties.
// No HTML, names of owners, mailing addresses, balances or payment records leave this API.
function cleanBill(value, pin) {
  if (!value || value.pin !== pin) throw upstreamError();
  if (value.status === "no_bill") return {status: "no_bill", pin};
  if (value.status !== "ok" || !Number.isInteger(value.tax_year) || value.tax_year < 1900 || value.tax_year > 2200 ||
      !Number.isSafeInteger(value.total_cents) || value.total_cents < 0 ||
      !Array.isArray(value.districts) || !value.districts.length || value.districts.length > 120) throw upstreamError();
  let sum = 0;
  const districts = value.districts.map(row => {
    if (!row || typeof row.name !== "string" || !row.name.trim() || row.name.length > 300 ||
        !CATEGORIES.has(row.category) ||
        !Number.isSafeInteger(row.amount_cents) || row.amount_cents < 0) throw upstreamError();
    sum += row.amount_cents;
    if (!Number.isSafeInteger(sum)) throw upstreamError();
    return {name: row.name, amount_cents: row.amount_cents, category: row.category};
  });
  if (sum !== value.total_cents) throw upstreamError();
  return {status: "ok", pin, tax_year: value.tax_year, total_cents: value.total_cents, districts};
}

export function createTaxApi(options = {}) {
  const now = options.now || Date.now;
  const parse = options.parseBill || parseTaxBill;
  const fetchCounty = (...args) => (options.fetchImpl || globalThis.fetch)(...args);
  const cacheStore = () => options.cache === null ? null : (options.cache || globalThis.caches?.default);
  const inflight = new Map();
  const rates = new Map();
  let active = 0;

  function allowedOrigin(request, env) {
    const origin = request.headers.get("Origin");
    return origin && (ORIGINS.has(origin) || (env.DEVELOPMENT === "true" && origin === "http://127.0.0.1:8768")) ? origin : null;
  }
  function reply(request, env, body, status = 200, extra = {}) {
    const headers = new Headers({"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Vary": "Origin", ...extra});
    const origin = allowedOrigin(request, env);
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    return new Response(body === null ? null : JSON.stringify(body), {status, headers});
  }
  function fail(request, env, error) {
    const safe = error instanceof SafeError ? error : upstreamError();
    return reply(request, env, {status: "error", code: safe.code, message: safe.message}, safe.status,
      safe.status === 429 ? {"Retry-After": "60"} : safe.status === 503 ? {"Retry-After": "5"} : {});
  }
  function consumeRate(request) {
    // Cloudflare supplies this header. No IP is logged or included in a response.
    const header = request.headers.get("CF-Connecting-IP");
    const ip = header && header.length <= 64 ? header : "anonymous";
    const time = now();
    let bucket = rates.get(ip);
    if (!bucket || time >= bucket.until) {
      for (const [key, item] of rates) if (time >= item.until) rates.delete(key);
      if (rates.size >= MAX_IPS) rates.delete(rates.keys().next().value);
      bucket = {until: time + 60000, count: 0};
      rates.set(ip, bucket);
    }
    if (++bucket.count > 60) throw new SafeError(429, "rate_limited", "Too many lookups. Please wait a minute and try again.");
  }
  function cacheKey(pin) {
    // Synthetic internal cache key only: never fetched, navigated to or logged.
    return new Request("https://illinois-land-index-tax-lookup.theplummer92.chatgpt.site/__cache__/" + VERSION + "/" + pin);
  }
  function sourceUrl(pin) { return UPSTREAM + "?" + new URLSearchParams({parcelNumber: pin}); }
  async function readCache(pin) {
    try {
      const response = await cacheStore()?.match(cacheKey(pin));
      if (!response || !response.ok) return null;
      const raw = await response.json();
      const bill = cleanBill(raw, pin);
      const stamp = Date.parse(raw.fetched_at);
      const ttl = bill.status === "no_bill" ? NO_BILL_TTL : DAY;
      if (!Number.isFinite(stamp) || stamp > now() || now() - stamp >= ttl || raw.source_url !== sourceUrl(pin)) return null;
      return {...bill, fetched_at: new Date(stamp).toISOString(), source_url: sourceUrl(pin)};
    } catch { return null; }
  }
  async function writeCache(data) {
    try {
      const ttl = data.status === "no_bill" ? NO_BILL_TTL : DAY;
      await cacheStore()?.put(cacheKey(data.pin), new Response(JSON.stringify(data), {headers: {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=" + ttl / 1000
      }}));
    } catch { /* Cache failure must not turn a verified county response into a failure. */ }
  }
  async function fetchBill(pin) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SafeError(504, "upstream_timeout", "The county tax service took too long to respond. Please try again later."));
      }, options.timeoutMs || 15000);
    });
    try {
      const data = await Promise.race([deadline, (async () => {
        // Workers does not implement redirect:"error". Manual mode sends no
        // follow-up request; the status check below rejects every redirect.
        const response = await fetchCounty(sourceUrl(pin), {method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal,
          headers: {"Accept": "text/html", "User-Agent": "IllinoisLandIndex/1.0 public property-tax lookup"}});
        if (!response.ok || response.redirected || !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get("Content-Type") || "")) throw upstreamError();
        if (Number(response.headers.get("Content-Length")) > HTML_LIMIT) { void response.body?.cancel().catch(() => {}); throw upstreamError(); }
        const html = await boundedText(response.body, HTML_LIMIT, upstreamError());
        const bill = cleanBill(parse(html, pin), pin);
        return {...bill, fetched_at: new Date(now()).toISOString(), source_url: sourceUrl(pin)};
      })()]);
      await writeCache(data);
      return data;
    } finally { clearTimeout(timer); }
  }
  async function lookup(pin) {
    const cached = await readCache(pin);
    if (cached) return cached;
    if (inflight.has(pin)) return inflight.get(pin);
    if (active >= 4) throw new SafeError(503, "busy", "The tax lookup is busy. Please try again in a few seconds.");
    active++;
    const task = fetchBill(pin).finally(() => { active--; inflight.delete(pin); });
    inflight.set(pin, task);
    return task;
  }
  async function fetch(request, env = {}) {
    const url = new URL(request.url);
    if (!["/tax-breakdown", "/health", "/"].includes(url.pathname)) return reply(request, env, {status: "error", code: "not_found"}, 404);
    if (url.search) return reply(request, env, {status: "error", code: "invalid_request", message: "Query parameters are not accepted."}, 400);
    if (url.pathname === "/") {
      if (request.method !== "GET") return reply(request, env, {status: "error", code: "method_not_allowed"}, 405, {Allow: "GET"});
      return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Illinois Land Index tax lookup</title><h1>Illinois Land Index tax lookup</h1><p>This service supplies verified county tax-district amounts to the property dashboard.</p><p><a href="https://illinoislandindex.com/parcel-dashboard/">Find your property at Illinois Land Index</a></p></html>', {headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      }});
    }
    if (url.pathname === "/health") {
      if (request.method !== "GET") return reply(request, env, {status: "error", code: "method_not_allowed"}, 405, {Allow: "GET"});
      return reply(request, env, {service: "illinois-land-index-tax-breakdown", version: VERSION});
    }
    if (request.method !== "POST" && request.method !== "OPTIONS") return reply(request, env, {status: "error", code: "method_not_allowed"}, 405, {Allow: "POST, OPTIONS"});
    if (request.headers.has("Origin") && !allowedOrigin(request, env)) return reply(request, env, {status: "error", code: "origin_not_allowed"}, 403);
    if (request.method === "OPTIONS") {
      const method = request.headers.get("Access-Control-Request-Method");
      const requested = (request.headers.get("Access-Control-Request-Headers") || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
      if (!allowedOrigin(request, env) || method !== "POST" || requested.some(value => value !== "content-type")) return reply(request, env, {status: "error", code: "invalid_preflight"}, 403);
      return reply(request, env, null, 204, {"Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"});
    }
    try {
      consumeRate(request);
      if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) throw new SafeError(415, "invalid_content_type", "Send a JSON parcel lookup.");
      const tooLarge = new SafeError(413, "request_too_large", "The lookup request is too large.");
      if (Number(request.headers.get("Content-Length")) > REQUEST_LIMIT) throw tooLarge;
      let body;
      try { body = JSON.parse(await boundedText(request.body, REQUEST_LIMIT, tooLarge)); }
      catch (error) { if (error instanceof SafeError) throw error; throw new SafeError(400, "invalid_request", "Provide an 11-digit parcel number."); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
          typeof body.pin !== "string" || !/^\d{11}$/.test(body.pin)) throw new SafeError(400, "invalid_request", "Provide only an 11-digit parcel number.");
      return reply(request, env, await lookup(body.pin));
    } catch (error) { return fail(request, env, error); }
  }
  return {fetch};
}

export default createTaxApi();
