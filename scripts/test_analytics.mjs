import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../analytics.js", import.meta.url), "utf8");
const script = new vm.Script(source, { filename: "analytics.js" });
const measurementId = "G-8JFK3CZ7LE";
const storageKey = "ili.analytics.excluded";
const cookieKey = "ili_analytics_excluded";

test("parcel pages load the versioned shared tracker exactly once", () => {
  for (const page of ["parcel-dashboard/index.html", "parcel-dashboard/rankings.html"]) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    assert.equal((html.match(/src="\.\.\/analytics\.js\?v=[^"]+"/g) || []).length, 1);
  }
});

test("existing Google opt-out flag remains respected", () => {
  const page = browser({ initialDisable: true });
  assertNoTracking(page);
  page.window.landIndexAnalytics.setExcluded(false);
  assertNoTracking(page);
});

test("a preference from another tab stops later events", () => {
  const page = browser();
  page.state.storage.set(storageKey, "1");
  page.window.dispatchEvent({ type: "storage", key: storageKey });
  const before = page.calls().length;
  page.click("/consumer-debt-dashboard/");
  assert.equal(page.calls().length, before);
  assert.equal(page.window["ga-disable-" + measurementId], true);
});

test("cookie-only opt-out is rechecked when returning to an open tab", () => {
  const page = browser({ localStorageBlocked: true });
  page.state.cookies.set(cookieKey, "1");
  page.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(page.status().excluded, true);
  assert.equal(page.window["ga-disable-" + measurementId], true);
});

test("page visibility cannot undo a current-visit opt-out when all storage is blocked", () => {
  const page = browser({ localStorageBlocked: true, cookiesBlocked: true, url: "https://illinoislandindex.com/analytics-preferences/#exclude" });
  page.document.dispatchEvent({ type: "visibilitychange" });
  page.window.dispatchEvent({ type: "pageshow" });
  assert.equal(page.status().excluded, true);
  assert.equal(page.status().remembered, false);
  assertNoTracking(page);
});

function browser({
  url = "https://illinoislandindex.com/parcel-dashboard/",
  webdriver = false,
  state = { storage: new Map(), cookies: new Map() },
  localStorageBlocked = false,
  cookiesBlocked = false,
  initialDisable = false,
} = {}) {
  const listeners = new Map();
  const insertedScripts = [];
  const location = new URL(url);
  function addEventListener(name, listener) {
    const group = listeners.get(name) || [];
    group.push(listener);
    listeners.set(name, group);
  }
  const document = {
    title: "Find your property | Illinois Land Index",
    referrer: "https://example.org/research?private=one#details",
    readyState: "complete",
    createElement: tag => ({ tagName: tag.toUpperCase() }),
    addEventListener,
    dispatchEvent: event => {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
  };
  Object.defineProperty(document, "cookie", {
    get() {
      if (cookiesBlocked) return "";
      return [...state.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set(value) {
      if (cookiesBlocked) return;
      const [assignment, ...attributes] = value.split(";");
      const separator = assignment.indexOf("=");
      const name = assignment.slice(0, separator).trim();
      const content = assignment.slice(separator + 1).trim();
      const expired = attributes.some(attribute => {
        const clean = attribute.trim();
        if (/^max-age\s*=\s*0$/i.test(clean)) return true;
        if (/^expires=/i.test(clean)) return Date.parse(clean.slice(8)) < Date.now();
        return false;
      });
      if (!content || expired) state.cookies.delete(name);
      else state.cookies.set(name, content);
    },
  });
  const window = {
    location,
    document,
    navigator: { webdriver },
    addEventListener,
    dispatchEvent: document.dispatchEvent,
    history: { replaceState(_state, _title, next) { if (next) Object.assign(location, new URL(next, location)); } },
    ["ga-disable-" + measurementId]: initialDisable,
  };
  Object.defineProperty(window, "localStorage", {
    get() {
      if (localStorageBlocked) throw new Error("Storage unavailable");
      return {
        getItem: name => state.storage.get(name) ?? null,
        setItem: (name, value) => state.storage.set(name, String(value)),
        removeItem: name => state.storage.delete(name),
      };
    },
  });
  document.head = {
    appendChild(node) {
      insertedScripts.push({ ...node, disabledWhenInserted: window["ga-disable-" + measurementId] });
      return node;
    },
  };
  const context = vm.createContext({
    window,
    document,
    navigator: window.navigator,
    location,
    URL,
    URLSearchParams,
    console,
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
  });
  const run = () => script.runInContext(context);
  run();
  return {
    window, document, state, insertedScripts, run,
    status: () => window.landIndexAnalytics.getStatus(),
    calls: () => (window.dataLayer || []).map(args => Array.from(args)),
    click(href, textContent = "600 Example Street") {
      const link = { textContent, getAttribute: name => name === "href" ? href : null };
      const event = { type: "click", target: { closest: () => link } };
      document.dispatchEvent(event);
    },
  };
}

function assertNoTracking(page) {
  assert.equal(page.status().trackingAllowed, false);
  assert.equal(page.insertedScripts.length, 0, "excluded visits must never load Google's tag");
  assert.equal(page.window["ga-disable-" + measurementId], true);
  assert.equal(page.calls().length, 0, "excluded visits must not enqueue Analytics commands");
  page.click("/parcel-dashboard/?address=600%20Example%20Street#property-result");
  page.window.landIndexAnalytics.trackPropertySearchSuccess();
  assert.equal(page.calls().length, 0, "excluded click must not enqueue an event");
}

test("production visit loads a single tag and strips query and fragment from its page location", () => {
  const page = browser({ url: "https://illinoislandindex.com/parcel-dashboard/?address=600%20Example%20Street#property-result" });
  assert.equal(page.status().trackingAllowed, true);
  assert.equal(page.status().excluded, false);
  assert.equal(page.insertedScripts.length, 1);
  assert.match(page.insertedScripts[0].src, /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-8JFK3CZ7LE/);
  assert.notEqual(page.insertedScripts[0].disabledWhenInserted, true);
  const configurations = page.calls().filter(([command]) => command === "config");
  assert.equal(configurations.length, 1);
  assert.equal(configurations[0][1], measurementId);
  assert.equal(configurations[0][2].page_location, "https://illinoislandindex.com/parcel-dashboard/");
  assert.doesNotMatch(JSON.stringify(page.calls()), /600|Example%20|property-result/);
});

test("including the shared bootstrap twice does not duplicate the tag or click handlers", () => {
  const page = browser();
  page.run();
  assert.equal(page.insertedScripts.length, 1);
  assert.equal(page.calls().filter(([command]) => command === "config").length, 1);
  page.click("/how-to-research-land-before-buying.html");
  assert.equal(page.calls().filter(([command, name]) => command === "event" && name === "land_index_link_click").length, 1);
});

test("stored owner exclusion blocks collection before initialization on a direct parcel visit", () => {
  const state = { storage: new Map([[storageKey, "1"]]), cookies: new Map() };
  const page = browser({ state });
  assert.equal(page.status().excluded, true);
  assert.equal(page.status().remembered, true);
  assertNoTracking(page);
});

test("excluding this browser immediately blocks clicks and survives a new page load", () => {
  const page = browser();
  const status = page.window.landIndexAnalytics.setExcluded(true);
  assert.equal(status.excluded, true);
  assert.equal(status.remembered, true);
  assert.equal(status.trackingAllowed, false);
  assert.equal(page.window["ga-disable-" + measurementId], true);
  const before = page.calls().length;
  page.click("/consumer-debt-dashboard/");
  assert.equal(page.calls().length, before);
  assertNoTracking(browser({ url: "https://illinoislandindex.com/consumer-debt-dashboard/", state: page.state }));
});

test("preferences exclusion link saves the choice before any tracking and remains effective elsewhere", () => {
  const page = browser({ url: "https://illinoislandindex.com/analytics-preferences/#exclude" });
  assert.equal(page.status().excluded, true);
  assert.equal(page.status().remembered, true);
  assertNoTracking(page);
  assertNoTracking(browser({ state: page.state }));
});

test("preferences pages remain untracked even after restoring ordinary browser counting", () => {
  for (const path of ["/analytics-preferences/", "/analytics-preferences/index.html"]) {
    const state = { storage: new Map([[storageKey, "1"]]), cookies: new Map([[cookieKey, "1"]]) };
    const page = browser({ url: `https://illinoislandindex.com${path}`, state });
    const status = page.window.landIndexAnalytics.setExcluded(false);
    assert.equal(status.excluded, false);
    assert.equal(status.trackingAllowed, false);
    assert.equal(page.insertedScripts.length, 0);
    assert.equal(state.storage.has(storageKey), false);
    assert.equal(state.cookies.has(cookieKey), false);
    const next = browser({ state });
    assert.equal(next.status().trackingAllowed, true);
    assert.equal(next.insertedScripts.length, 1);
  }
});

test("cookie fallback remembers exclusion when localStorage access fails", () => {
  const page = browser({ url: "https://illinoislandindex.com/analytics-preferences/#exclude", localStorageBlocked: true });
  assert.equal(page.status().remembered, true);
  assert.equal(page.state.cookies.get(cookieKey), "1");
  assertNoTracking(page);
  assertNoTracking(browser({ state: page.state, localStorageBlocked: true }));
});

test("localStorage remembers exclusion when cookies cannot be saved", () => {
  const page = browser({ url: "https://illinoislandindex.com/analytics-preferences/#exclude", cookiesBlocked: true });
  assert.equal(page.status().remembered, true);
  assert.equal(page.state.storage.get(storageKey), "1");
  assertNoTracking(page);
  assertNoTracking(browser({ state: page.state, cookiesBlocked: true }));
});

test("blocked persistence still excludes the current visit without claiming the setting was remembered", () => {
  const page = browser({
    url: "https://illinoislandindex.com/analytics-preferences/#exclude",
    localStorageBlocked: true,
    cookiesBlocked: true,
  });
  assert.equal(page.status().excluded, true);
  assert.equal(page.status().remembered, false);
  assertNoTracking(page);
});

test("only canonical HTTPS production hosts are eligible for tracking", () => {
  for (const url of [
    "http://illinoislandindex.com/", "https://preview.illinoislandindex.com/",
    "http://localhost:8000/", "http://127.0.0.1:8000/", "http://[::1]:8000/",
    "https://plummer92.github.io/illinois-land-index/", "file:///tmp/index.html",
    "https://illinoislandindex.com.example.org/",
  ]) assertNoTracking(browser({ url }));
  assert.equal(browser({ url: "https://www.illinoislandindex.com/" }).status().trackingAllowed, true);
});

test("automated browsing remains excluded when owner counting is restored", () => {
  const page = browser({ webdriver: true });
  assertNoTracking(page);
  page.window.landIndexAnalytics.setExcluded(false);
  assertNoTracking(page);
});

test("explicit test URL excludes only the test visit without opting out a later ordinary visit", () => {
  const page = browser({ url: "https://illinoislandindex.com/parcel-dashboard/?analytics_test=1" });
  assertNoTracking(page);
  page.window.landIndexAnalytics.setExcluded(false);
  assertNoTracking(page);
  assert.equal(page.state.storage.has(storageKey), false);
  assert.equal(page.state.cookies.has(cookieKey), false);
  assert.equal(browser({ state: page.state }).status().trackingAllowed, true);
});

test("link events retain destination classification without search details, hash or visible address text", () => {
  const page = browser();
  page.click("/parcel-dashboard/?address=600%20Example%20Street&scoreDetail=28010100008#property-result");
  const events = page.calls().filter(([command]) => command === "event");
  assert.ok(events.some(([, name]) => name === "open_illinois_land_dashboard"));
  assert.ok(events.some(([, name, params]) => name === "land_index_link_click" && params.destination_type === "illinois_land_dashboard"));
  const payload = JSON.stringify(events);
  assert.doesNotMatch(payload, /600|Example|28010100008|scoreDetail|property-result|link_text/);
});

test("successful searches send only fixed event fields, ignoring supplied personal data", () => {
  const page = browser({ url: "https://illinoislandindex.com/parcel-dashboard/?scoreDetail=28010100008#property-result" });
  page.document.title = "600 Example Street — 28010100008";
  page.document.referrer = "https://example.org/600-Example-Street/28010100008?address=600%20Example%20Street";
  page.window.landIndexAnalytics.trackPropertySearchSuccess({address:"600 Example Street",pin:"28010100008",latitude:39.66});
  const events = page.calls().filter(([command,name]) => command === "event" && name === "property_search_success");
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0][2]).sort(), ["page_location","page_path","page_referrer","page_title"]);
  assert.equal(events[0][2].page_title, "Illinois Land Index");
  assert.equal(events[0][2].page_referrer, "https://example.org/");
  assert.equal(events[0][2].page_location, "https://illinoislandindex.com/parcel-dashboard/");
  assert.doesNotMatch(JSON.stringify(page.calls()), /600|Example|28010100008|latitude|scoreDetail|property-result/);
});

test("outbound paths and link text cannot disclose addresses or parcel identifiers", () => {
  const page = browser();
  page.click("https://maps.example.org/600-Example-Street/28010100008?coords=39.66,-89.70", "600 Example Street");
  assert.doesNotMatch(JSON.stringify(page.calls()), /600|Example|28010100008|coords|39.66|link_url|link_text/);
});

test("success events are limited to the property finder and stop after exclusion", () => {
  const page = browser();
  page.window.landIndexAnalytics.setExcluded(true);
  const before = page.calls().length;
  page.window.landIndexAnalytics.trackPropertySearchSuccess();
  assert.equal(page.calls().length, before);
  for (const url of ["https://illinoislandindex.com/", "https://illinoislandindex.com/parcel-dashboard/rankings.html"]) {
    const otherPage = browser({url});
    otherPage.window.landIndexAnalytics.trackPropertySearchSuccess();
    assert.equal(otherPage.calls().filter(([,name]) => name === "property_search_success").length, 0);
  }
});
