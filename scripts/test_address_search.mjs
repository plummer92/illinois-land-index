import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../address-search.js",import.meta.url),"utf8");
const chatham = "600 E SPRUCE ST, CHATHAM, ILLINOIS, 62629";
const springfield = "600 E SPRUCE ST, SPRINGFIELD, ILLINOIS, 62703";
const item = text => ({text,isCollection:false});
const response = suggestions => ({ok:true,json:async () => ({suggestions})});
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(fetch = async () => response([item(chatham),item(springfield)])) {
  function element(id = "") {
    const attrs = new Map(), listeners = new Map();
    return {id,value:"",textContent:"",hidden:false,children:[],
      setAttribute:(key,value) => attrs.set(key,value),getAttribute:key => attrs.get(key),removeAttribute:key => attrs.delete(key),
      addEventListener:(event,listener) => listeners.set(event,listener),
      trigger(event,extra = {}) {let prevented=false; listeners.get(event)?.({preventDefault(){prevented=true;},...extra}); return prevented;},
      replaceChildren(...children) {this.children = children;},append(child){this.children.push(child);},scrollIntoView(){}
    };
  }
  const timers = new Map(), requests = [], selected = [];
  let id = 0;
  const input = element("query"), list = element("suggestions"), status = element("status");
  const context = vm.createContext({window:{},document:{createElement:() => element()},AbortController,URLSearchParams,
    setTimeout:(callback,delay) => {timers.set(++id,{callback,delay});return id;},clearTimeout:timer => timers.delete(timer),
    fetch:(url,options) => {requests.push({url,options});return fetch(url,options);}
  });
  vm.runInContext(source,context);
  const api = context.window.ParcelAddressSearch;
  const control = api.attach({input,list,status,onSelect:value => selected.push(value)});
  return {input,list,status,api,control,requests,selected,
    type(value) {input.value=value;input.trigger("input");},
    async run(delay=350) {for (const [key,timer] of [...timers]) if (timer.delay===delay) {timers.delete(key);timer.callback();} await settle();}
  };
}

test("suggestions wait for a pause, ignore parcel numbers, and only contact the county", async () => {
  const page = fixture();
  page.type("28010100008");await page.run();assert.equal(page.requests.length,0);
  page.type("600 E S");page.type("600 E Sp");page.type("600 E Spr");
  assert.equal(page.requests.length,0);
  await page.run();assert.equal(page.requests.length,1);
  const url=new URL(page.requests[0].url);
  assert.equal(url.hostname,"sangis.co.sangamon.il.us");
  assert.equal(url.searchParams.get("text"),"600 E Spr");
  assert.equal(page.list.children.length,2);
  assert.equal(page.selected.length,0,"similar addresses in different towns are never auto-selected");
});

test("full direction words and omitted street suffixes retain recognizable county matches", () => {
  const {api}=fixture();
  const data={suggestions:[item(chatham),item(springfield),item("600 E ASH ST, SPRINGFIELD"),item("601 E SPRUCE ST, CHATHAM"),item(chatham),{text:chatham,isCollection:true}]};
  assert.deepEqual(Array.from(api.matchingSuggestions(data,"600 East Spr")),[chatham,springfield]);
  assert.deepEqual(Array.from(api.matchingSuggestions(data,"600 Spruce, Chatham")),[chatham]);
});

test("keyboard selection preserves the town and closes the accessible list", async () => {
  const page=fixture();page.type("600 E Spr");await page.run();
  assert.equal(page.input.getAttribute("aria-expanded"),"true");
  page.input.trigger("keydown",{key:"ArrowDown"});page.input.trigger("keydown",{key:"ArrowDown"});
  assert.equal(page.input.getAttribute("aria-activedescendant"),"suggestions-1");
  assert.equal(page.input.trigger("keydown",{key:"Enter"}),true);
  assert.deepEqual(page.selected,[springfield]);
  assert.equal(page.input.value,springfield);
  assert.equal(page.input.getAttribute("aria-expanded"),"false");
});

test("typing or canceling discards a stale county response", async () => {
  let release;
  const page=fixture(() => new Promise(resolve => {release=resolve;}));
  page.type("600 E Spr");await page.run();
  page.type("700 E Spr");
  release(response([item(chatham)]));await settle();
  assert.equal(page.list.children.length,0);
  assert.equal(page.requests[0].options.signal.aborted,true);
  assert.equal(page.selected.length,0);
});

test("county failure leaves manual lookup available and does not replace typed text", async () => {
  const page=fixture(async () => {throw new Error("offline");});
  page.type("600 E Spruce");await page.run();
  assert.match(page.status.textContent,/still enter the full address/);
  assert.equal(page.input.value,"600 E Spruce");
  assert.equal(page.list.hidden,true);
});

test("Enter without an explicitly highlighted suggestion preserves ordinary form submission", async () => {
  const page=fixture();page.type("600 E Spr");await page.run();
  assert.equal(page.input.trigger("keydown",{key:"Enter"}),false);
  assert.equal(page.selected.length,0);
  page.input.trigger("keydown",{key:"Escape"});
  assert.equal(page.input.getAttribute("aria-expanded"),"false");
});
