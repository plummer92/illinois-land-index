import { setTimeout as delay } from "node:timers/promises";

const transientStatus = (status) => status === 408 || status === 429 || (status >= 500 && status <= 599);

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}

// GET only. Retry temporary transport/server failures; never return stale or empty data as success.
export async function fetchJson(url, {
  attempts = 4,
  timeoutMs = 30_000,
  fetchImpl = globalThis.fetch,
  sleep = delay,
  warn = console.warn,
} = {}) {
  const endpoint = new URL(url);
  if (!["https:", "http:"].includes(endpoint.protocol)) throw new Error("Expected an HTTP(S) data source");
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 4 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Invalid request retry bounds");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Request deadline exceeded")), timeoutMs);
    let retry = true;
    let waitMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
    let failure;
    try {
      const response = await fetchImpl(endpoint.toString(), { signal: controller.signal });
      if (!response.ok) {
        retry = transientStatus(response.status);
        waitMs = Math.max(waitMs, retryAfterMs(response.headers.get("retry-after")));
        // Do not ignore a long server backoff or turn the refresh into an unbounded wait.
        if (waitMs > 30_000) retry = false;
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      // Invalid JSON and application errors are not ordinary connectivity failures.
      retry = false;
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("Data source returned invalid JSON"); }
      if (data?.error) {
        retry = transientStatus(Number(data.error.code));
        throw new Error(`Data source error ${data.error.code ?? "unknown"}: ${data.error.message ?? "request rejected"}`);
      }
      return data;
    } catch (error) {
      failure = error;
      if (!retry || attempt === attempts) {
        throw new Error(`GET ${endpoint.origin}${endpoint.pathname} failed after ${attempt} attempt(s): ${error.message}`, { cause: error });
      }
    } finally {
      clearTimeout(timer);
    }
    warn(`Temporary data-source failure at ${endpoint.host}: ${failure.message}; retry ${attempt + 1}/${attempts} in ${waitMs} ms`);
    await sleep(waitMs);
  }
}
