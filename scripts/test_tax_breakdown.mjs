import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../parcel-dashboard/tax-breakdown.js", import.meta.url), "utf8");
const now = Date.parse("2026-11-15T18:00:00.000Z");
const pin = "29060453009";
const stamp = age => new Date(now - age).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));

class FakeNode {
  constructor(tag, connected = false) {
    this.tag = tag;
    this.children = [];
    this.parent = null;
    this.connected = connected;
    this.events = {};
    this.attributes = {};
    this.style = {};
    this.textContent = "";
    this.open = false;
  }
  get isConnected() { return this.parent ? this.parent.isConnected : this.connected; }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const node of this.children) { node.parent = null; node.connected = false; }
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  emit(name) { return Promise.all((this.events[name] || []).map(callback => callback({target:this}))); }
}

const nodes = node => [node, ...node.children.flatMap(nodes)];
const text = node => nodes(node).map(child => child.textContent).join(" ");
const byClass = (node, name) => nodes(node).filter(child => (child.className || "").split(" ").includes(name));

function bill(changes = {}) {
  return {
    status:"ok", pin, fetched_at:stamp(60_000), tax_year:2025, total_cents:100_000,
    districts:[
      {name:"COMMUNITY UNIT SCHOOL", category:"schools", amount_cents:55_000},
      {name:"COMMUNITY COLLEGE", category:"schools", amount_cents:5_000},
      {name:"VILLAGE", category:"village", amount_cents:10_000},
      {name:"COUNTY", category:"county", amount_cents:20_000},
      {name:"FIRE DISTRICT", category:"other", amount_cents:10_000},
      {name:"LIBRARY DISTRICT", category:"other", amount_cents:0}
    ],
    ...changes
  };
}

function setup(fetchImpl = async () => { throw Error("Unexpected network request"); }) {
  const timers = new Map();
  const analytics = [];
  let timerId = 0;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const track = (...args) => analytics.push(args);
  const window = {gtag:track, dataLayer:[], ILIAnalytics:{track, trackEvent:track}};
  const context = vm.createContext({
    window, Date:FixedDate, Intl, AbortController, fetch:fetchImpl, gtag:track,
    document:{createElement:tag => new FakeNode(tag)},
    setTimeout:(callback, delay) => { timers.set(++timerId, {callback, delay}); return timerId; },
    clearTimeout:id => timers.delete(id)
  });
  vm.runInContext(source, context);
  const target = new FakeNode("div", true);
  const panel = new FakeNode("details", true);
  return {...window.ParcelTaxBreakdown, target, panel, timers, analytics, window};
}

test("validation retains only bill fields and preserves district amounts, including zero", () => {
  const {validate} = setup();
  const input = bill({owner:"Excluded", address:"Excluded", payments_cents:99, balance_cents:1});
  input.districts[0].private_note = "Excluded";
  const valid = validate(input, pin);
  assert.ok(valid);
  assert.deepEqual(Object.keys(valid).sort(), ["districts","fetched_at","pin","status","tax_year","total_cents"]);
  assert.deepEqual(clone(valid.districts), bill().districts);
  assert.equal(valid.total_cents, 100_000);
  assert.equal(valid.tax_year, 2025);
  assert.notEqual(valid.districts, input.districts);
});

test("categories combine school and college dollars without losing zero or uncategorized districts", () => {
  const {validate, groups} = setup();
  const grouped = groups(validate(bill(), pin));
  assert.deepEqual(clone(grouped.map(({id,amount_cents,percent,rows}) => ({id,amount_cents,percent,count:rows.length}))), [
    {id:"schools",amount_cents:60_000,percent:60,count:2},
    {id:"village",amount_cents:10_000,percent:10,count:1},
    {id:"county",amount_cents:20_000,percent:20,count:1},
    {id:"other",amount_cents:10_000,percent:10,count:2}
  ]);
  const zero = groups(validate(bill({total_cents:0, districts:[{name:"COUNTY",category:"county",amount_cents:0}]}), pin));
  assert.ok(zero.every(group => group.amount_cents === 0 && group.percent === 0 && Number.isFinite(group.percent)));
  assert.equal(zero.find(group => group.id === "county").rows.length, 1);
  assert.equal(zero.find(group => group.id === "schools").rows.length, 0);
});

test("invalid parcel, year, amount, district and reconciliation responses are rejected", () => {
  const {validate} = setup();
  const invalid = [
    null, {}, bill({pin:"29070380008"}), bill({status:"error"}),
    bill({tax_year:"2025"}), bill({tax_year:1989}), bill({tax_year:2027}),
    bill({total_cents:-1}), bill({total_cents:100_000.5}), bill({total_cents:100_001}),
    bill({total_cents:Number.MAX_SAFE_INTEGER + 1}), bill({districts:[]}), bill({districts:null}),
    bill({districts:Array.from({length:101}, (_, i) => ({name:`District ${i}`,category:"other",amount_cents:0})),total_cents:0})
  ];
  for (const change of [{name:" "},{name:"x".repeat(151)},{category:"invented"},{amount_cents:-1},{amount_cents:0.5},{amount_cents:"55000"}]) {
    const value = bill(); Object.assign(value.districts[0], change); invalid.push(value);
  }
  const duplicate = bill(); duplicate.districts[1].name = duplicate.districts[0].name; invalid.push(duplicate);
  const nullDistrict = bill(); nullDistrict.districts[0] = null; invalid.push(nullDistrict);
  invalid.forEach((value, index) => assert.equal(validate(value, pin), null, `invalid response ${index}`));
  for (const badPin of [null, undefined, "", "123", "29-060-453-009", "29060453009&x=1", "<script>"]) {
    assert.equal(validate(bill({pin:badPin}), badPin), null, `invalid input parcel ${badPin}`);
  }
});

test("timestamps reject stale and implausibly future results at the documented limits", () => {
  const {validate} = setup();
  assert.ok(validate(bill({fetched_at:stamp(26 * 60 * 60 * 1000)}), pin));
  assert.equal(validate(bill({fetched_at:stamp(26 * 60 * 60 * 1000 + 1)}), pin), null);
  assert.ok(validate(bill({fetched_at:stamp(-60_000)}), pin));
  for (const value of [undefined, "not a date", stamp(-60_001)]) assert.equal(validate(bill({fetched_at:value}), pin), null);
  assert.equal(validate({status:"no_bill",pin,fetched_at:stamp(27 * 60 * 60 * 1000)}, pin), null);
});

test("opening the panel requests only the parcel number, with no credentials, referrer or analytics", async () => {
  const calls = [];
  const app = setup(async (url, options) => { calls.push({url,options}); return {ok:true,json:async () => bill()}; });
  const {output} = app.attach(app.target, {pin,panel:app.panel,address:"Never send",owner:"Never send"});
  assert.equal(calls.length, 0);
  await app.panel.emit("toggle"); await settle();
  assert.equal(calls.length, 0);
  app.panel.open = true; await app.panel.emit("toggle"); await settle();
  assert.equal(calls.length, 1);
  const {url,options} = calls[0];
  assert.equal(new URL(url).protocol, "https:");
  assert.equal(new URL(url).search, "");
  assert.equal(new URL(url).pathname, "/tax-breakdown");
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), {pin});
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(output.attributes["aria-live"], "polite");
  assert.equal(output.attributes["aria-busy"], "false");
  assert.equal(app.timers.size, 0);
  assert.equal(app.analytics.length, 0);
  assert.equal(app.window.dataLayer.length, 0);
  assert.ok(!nodes(output).some(node => ["iframe","script","img"].includes(node.tag)));
  assert.match(text(output), /\$1,000\.00/);
  assert.match(text(output), /not your remaining balance or proof of payment/);
  await app.panel.emit("toggle"); await settle();
  assert.equal(calls.length, 1, "a completed lookup is reused within this panel");
});

test("a no-bill result is distinct from a verified zero-dollar bill", async () => {
  for (const noBill of [true, false]) {
    const response = noBill ? {status:"no_bill",pin,fetched_at:stamp(0)} : bill({total_cents:0,districts:[{name:"COUNTY",category:"county",amount_cents:0}]});
    const app = setup(async () => ({ok:true,json:async () => response}));
    const {load,output} = app.attach(app.target, {pin,panel:app.panel});
    await load();
    if (noBill) {
      assert.match(text(output), /returned no tax bill/);
      assert.equal(byClass(output, "tax-inline-total").length, 0);
      assert.equal(byClass(output, "tax-inline-groups").length, 0);
    } else {
      assert.match(text(output), /record reports \$0 in tax billed/);
      assert.equal(byClass(output, "tax-inline-total").length, 1);
      assert.match(text(byClass(output, "tax-inline-total")[0]), /\$0\.00/);
      assert.equal(byClass(output, "tax-inline-group").length, 4);
      assert.ok(nodes(output).filter(node => node.style.width).every(node => node.style.width === "0.0000%"));
    }
    assert.doesNotMatch(text(output), /NaN|Infinity/);
  }
});

test("HTTP errors, invalid JSON and unverified amounts show a retry instead of fabricated zero", async () => {
  const failures = [
    async () => { throw Error("Network failed"); },
    async () => ({ok:false}),
    async () => ({ok:true,json:async () => { throw Error("Bad JSON"); }}),
    async () => ({ok:true,json:async () => bill({total_cents:1})}),
    async () => ({ok:true,json:async () => bill({pin:"29070380008"})})
  ];
  for (const fetchImpl of failures) {
    const app = setup(fetchImpl);
    const {load,output} = app.attach(app.target, {pin,panel:app.panel}); await load();
    assert.match(text(output), /No estimate is shown/);
    assert.equal(byClass(output, "tax-inline-total").length, 0);
    assert.doesNotMatch(text(output), /\$[\d,.]+/);
    assert.equal(nodes(output).filter(node => node.tag === "button" && node.type === "button").length, 1);
    assert.equal(output.attributes["aria-busy"], "false");
    assert.equal(app.timers.size, 0);
  }
});

test("manual retry replaces an error with the verified result and removes the retry control", async () => {
  let calls = 0;
  const app = setup(async () => ++calls === 1 ? {ok:false} : {ok:true,json:async () => bill()});
  const {load,output} = app.attach(app.target, {pin,panel:app.panel}); await load();
  const retry = nodes(output).find(node => node.tag === "button");
  assert.ok(retry); await retry.emit("click"); await settle();
  assert.equal(calls, 2);
  assert.match(text(output), /Total property tax billed/);
  assert.equal(nodes(output).filter(node => node.tag === "button").length, 0);
  assert.doesNotMatch(text(output), /couldn’t load/);
});

test("an in-flight lookup is not duplicated by repeated opens or load calls", async () => {
  let finish, calls = 0;
  const app = setup(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const {load,output} = app.attach(app.target, {pin,panel:app.panel});
  const pending = load(); app.panel.open = true; await app.panel.emit("toggle"); await load();
  assert.equal(calls, 1);
  assert.equal(output.attributes["aria-busy"], "true");
  finish({ok:true,json:async () => bill()}); await pending;
  assert.equal(calls, 1);
  assert.equal(output.attributes["aria-busy"], "false");
});

test("a response for a removed property cannot render into the old or replacement panel", async () => {
  for (const success of [true, false]) {
    let finish;
    const app = setup(() => new Promise(resolve => { finish = resolve; }));
    const {load,output} = app.attach(app.target, {pin,panel:app.panel}); const pending = load();
    const replacement = new FakeNode("p"); replacement.textContent = "A different property";
    app.target.replaceChildren(replacement);
    assert.equal(output.isConnected, false);
    finish(success ? {ok:true,json:async () => bill()} : {ok:false}); await pending;
    assert.equal(text(app.target).trim(), "A different property");
    assert.equal(byClass(output, "tax-inline-total").length, 0);
    assert.equal(nodes(output).filter(node => node.tag === "button").length, 0);
    assert.equal(app.timers.size, 0);
  }
});

test("invalid input parcels never start a request", async () => {
  let calls = 0;
  const app = setup(async () => { calls++; throw Error("Unexpected request"); });
  for (const invalidPin of ["", "123", "29060453009&extra=1", null]) {
    const {load} = app.attach(app.target, {pin:invalidPin,panel:app.panel}); await load();
  }
  app.panel.open = true; await app.panel.emit("toggle"); await settle();
  assert.equal(calls, 0);
  assert.equal(app.timers.size, 0);
});

test("district labels are rendered as text, with accessible row headers", async () => {
  const name = '<img src=x onerror="unexpected()">';
  const app = setup(async () => ({ok:true,json:async () => bill({total_cents:123,districts:[{name,category:"other",amount_cents:123}]})}));
  const {load,output} = app.attach(app.target, {pin,panel:app.panel}); await load();
  assert.match(text(output), /<img src=x/);
  assert.ok(!nodes(output).some(node => node.tag === "img"));
  const header = nodes(output).find(node => node.tag === "th" && node.textContent === name);
  assert.equal(header.attributes.scope, "row");
  assert.equal(nodes(output).filter(node => node.tag === "th" && node.attributes.scope === "col").length, 2);
});

test("a timeout aborts the request and exposes a recoverable failure", async () => {
  let signal;
  const app = setup((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener("abort", () => reject(Error("Aborted")));
  }));
  const {load,output} = app.attach(app.target, {pin,panel:app.panel}); const pending = load();
  assert.equal(app.timers.size, 1);
  const timer = [...app.timers.values()][0];
  assert.equal(timer.delay, 20_000); timer.callback(); await pending;
  assert.equal(signal.aborted, true);
  assert.match(text(output), /No estimate is shown/);
  assert.equal(nodes(output).filter(node => node.tag === "button").length, 1);
  assert.equal(app.timers.size, 0);
});
