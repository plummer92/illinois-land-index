import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../parcel-dashboard/lookup.js", import.meta.url), "utf8");
const pin = "28010100008";
const otherPin = "28010100009";
const address = "600 Example Street, Chatham";
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = data => ({ok:true, json:async () => data});
const lot = number => ({type:"Feature",properties:{PIN:number,TOTACRES:1},geometry:null});
const candidate = label => ({address:label,score:100,attributes:{Addr_type:"PointAddress",AddNum:"600"},location:{x:-89.7,y:39.6}});

function finder({mapped = () => false, scored = () => false, matches = [], fetch = async () => response({features:[]}), handedOffQuery, analytics = true} = {}) {
  const elements = new Map();
  const events = [];
  const shown = [];
  const listeners = new Map();
  const timers = new Map();
  const storage = new Map(handedOffQuery ? [["ili-property-query",handedOffQuery]] : []);
  let timerId = 0;
  function element() {
    const callbacks = new Map();
    return {
      value:"",textContent:"",maxLength:140,children:[],
      addEventListener:(name,handler) => callbacks.set(name,handler),
      trigger(name) { callbacks.get(name)?.({preventDefault(){}}); },
      replaceChildren(...items) { this.children = items; },
      append(...items) { this.children.push(...items); },
      get firstElementChild() { return this.children[0]; },
      focus(){},
    };
  }
  for (const id of ["parcel-form","parcel-number","lookup-status","lookup-choices"]) elements.set(id,element());
  const document = {getElementById:id => elements.get(id),createElement:element};
  const window = {
    addEventListener:(name,handler) => listeners.set(name,handler),
    ...(analytics ? {landIndexAnalytics:{trackPropertySearchSuccess:(...args) => events.push(args)}} : {}),
  };
  const context = vm.createContext({
    window,document,AbortController,URLSearchParams,console,fetch,
    sessionStorage:{getItem:key => storage.get(key),removeItem:key => storage.delete(key)},
    setTimeout:handler => { const id = ++timerId; timers.set(id,handler); return id; },
    clearTimeout:id => timers.delete(id),
  });
  vm.runInContext(source,context,{filename:"lookup.js"});
  const api = vm.runInContext("propertyFinder",context);
  api.connect({mapped,scored,search:() => matches,clear(){},show:(...args) => shown.push(args),focus(){},nearby(){}});
  return {
    events,shown,api,storage,
    choices:() => elements.get("lookup-choices").children,
    edit(query) { elements.get("parcel-number").value = query; elements.get("parcel-number").trigger("input"); },
    async search(query) { elements.get("parcel-number").value = query; elements.get("parcel-form").trigger("submit"); await settle(); },
    async click(index = 0) { elements.get("lookup-choices").children[index].onclick(); await settle(); },
    async event(name,event={}) { listeners.get(name)?.(event); await settle(); },
    timeout() { for (const handler of timers.values()) handler(); },
  };
}

test("initial page/deep-link load sends no search event; each completed mapped lookup sends one empty event", async () => {
  const page = finder({mapped:() => true});
  await settle();
  assert.equal(page.events.length,0);
  await page.search(pin);
  assert.equal(page.shown.length,1);
  assert.deepEqual(page.events,[[]]);
  await page.search(pin);
  assert.deepEqual(page.events,[[],[]],"a later intentional search is a separate completed lookup");
});

test("address search only counts once the resident selects a resolved lot", async () => {
  let request = 0;
  const page = finder({fetch:async () => response(++request === 1 ? {candidates:[candidate(address)]} : {features:[lot(pin),lot(otherPin)]})});
  await page.search(address);
  assert.equal(page.events.length,0);
  const selected = page.choices()[0];
  await page.click();
  assert.equal(page.shown[0][0].pin,pin);
  assert.deepEqual(page.events,[[]]);
  selected.onclick();
  await settle();
  assert.deepEqual(page.events,[[]],"repeated handling of the same choice must not duplicate the metric");
});

test("partial parcel choice counts a property; street search does not", async () => {
  const street = finder({matches:[{kind:"street",label:"Example Street",choose(){}}]});
  await street.search("Example");
  assert.equal(street.events.length,0);
  const parcel = finder({matches:[{kind:"parcel",label:pin,pin,choose(){throw new Error("must use resolved property display");}}]});
  await parcel.search("280101");
  assert.equal(parcel.shown[0][0].pin,pin);
  assert.deepEqual(parcel.events,[[]]);
});

test("no matches, failed address lookup and empty input never count as success", async () => {
  const page = finder();
  await page.search(pin);
  await page.search("Example");
  await page.search("");
  assert.equal(page.events.length,0);
  const failed = finder({fetch:async () => { throw new Error("County unavailable"); }});
  await failed.search(address);
  assert.equal(failed.events.length,0);
});

test("stale county response and a cancelled choice cannot record a search", async () => {
  let release;
  const page = finder({mapped:number => number === otherPin,fetch:() => new Promise(resolve => { release = resolve; })});
  await page.search(pin);
  await page.search(otherPin);
  release(response({features:[lot(pin)]}));
  await settle();
  assert.equal(page.shown.length,1);
  assert.equal(page.shown[0][0].pin,otherPin);
  assert.deepEqual(page.events,[[]]);
  const options = finder({matches:[{kind:"parcel",pin},{kind:"parcel",pin:otherPin}]});
  await options.search("280101");
  const staleChoice = options.choices()[0];
  options.api.cancel();
  staleChoice.onclick();
  await settle();
  assert.equal(options.events.length,0);
});

test("scoring fallback counts a resolved result after network failure but not an aborted request", async () => {
  const fallback = finder({scored:() => true,fetch:async () => {throw new Error("Offline");}});
  await fallback.search(pin);
  assert.equal(fallback.shown[0][0].geometryUnavailable,true);
  assert.deepEqual(fallback.events,[[]]);
  const timedOut = finder({scored:() => true,fetch:(_url,{signal}) => new Promise((_resolve,reject) => signal.addEventListener("abort",() => reject(new Error("Aborted"))))});
  await timedOut.search(pin);
  timedOut.timeout();
  await settle();
  assert.equal(timedOut.events.length,0);
});

test("editing a pending lookup cancels its stale result before another submission", async () => {
  let release;
  const page=finder({fetch:() => new Promise(resolve => {release=resolve;})});
  await page.search(pin);
  page.edit("600 E Spr");
  release(response({features:[lot(pin)]}));
  await settle();
  assert.equal(page.shown.length,0);
  assert.equal(page.events.length,0);
});

test("homepage handoff is counted after success and cannot replay on pageshow", async () => {
  const page = finder({mapped:() => true,handedOffQuery:pin});
  await settle();
  assert.deepEqual(page.events,[[]]);
  assert.equal(page.storage.has("ili-property-query"),false);
  await page.event("pageshow",{persisted:true});
  assert.deepEqual(page.events,[[]]);
});

test("lookup still works when tracking is absent or blocked", async () => {
  const page = finder({mapped:() => true,analytics:false});
  await page.search(pin);
  assert.equal(page.shown.length,1);
});
