import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../parcel-dashboard/local-decisions.js",import.meta.url),"utf8");
class Node {
  constructor(tag,text="") { this.tag=tag; this.textContent=text; this.children=[]; this.events={}; this.isConnected=true; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=nodes; }
  addEventListener(name,fn) { this.events[name]=fn; }
}
function setup(fetch=async()=>{throw Error("Unexpected fetch");}) {
  const context=vm.createContext({window:{},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch,
    document:{createElement:tag=>new Node(tag),createTextNode:text=>new Node("text",text)}});
  vm.runInContext(source,context);
  return context.window;
}
const flatten = node => [node,...node.children.flatMap(flatten)];
const text = node => flatten(node).map(n=>n.textContent).join(" ");
const boundary = (...names) => ({features:names.map(name=>({attributes:{Corp_Name:name}}))});

test("tax links preserve the exact parcel and reject malformed or injectable identifiers",()=>{
  const {taxLinks}=setup().ParcelLocalDecisions;
  for (const pin of [null,undefined,"", "29-060-453-009","29060453009&taxYear=1","<script>","123"]) assert.equal(taxLinks(pin),null);
  for (const pin of ["29060453009","29070380008"]) {
    const urls=taxLinks(pin);
    assert.equal(Object.keys(urls).length,3);
    for(const href of Object.values(urls)) {
      const u=new URL(href); assert.equal(u.hostname,"tax.sangamonil.gov");
      assert.equal(u.searchParams.get("parcelNumber"),pin); assert.equal([...u.searchParams].length,1);
    }
  }
});
test("municipal ambiguity, truncated results and missing fields never establish Chatham residency",()=>{
  const {municipality}=setup().ParcelLocalDecisions;
  assert.equal(municipality(boundary("Chatham"," CHATHAM ")).status,"chatham");
  assert.equal(municipality(boundary("Springfield")).status,"other");
  assert.equal(municipality(boundary()).status,"no_match");
  for(const value of [null,{},boundary("Chatham","Springfield"),boundary("Chatham",null),{...boundary("Chatham"),exceededTransferLimit:true},{...boundary("Chatham"),error:{code:500}}]) assert.equal(municipality(value).status,"unknown");
});
test("tax section is available without geometry and never fabricates amounts for an exempt parcel",()=>{
  const app=setup();const parent=new Node("div");
  const panel=app.showPropertyLocalDecisions(parent,{pin:"29070380008"});
  assert.match(text(panel),/could not verify this parcel’s municipality/);
  assert.match(text(panel),/amounts are not imported/);
  assert.doesNotMatch(text(panel),/\$[\d,.]+/);
  assert.equal(flatten(panel).filter(n=>n.tag==="a"&&n.href.includes("parcelNumber=29070380008")).length,3);
});
test("municipal requests are lazy, finite-point only, and failures can be retried",async()=>{
  let calls=0;
  const app=setup(async href=>{calls++; const url=new URL(href);assert.equal(url.hostname,"sangis.co.sangamon.il.us");return calls===1?{ok:false}:{ok:true,json:async()=>boundary("Chatham")};});
  const panel=app.showPropertyLocalDecisions(new Node("div"),{pin:"29060453009",position:[-89.7,39.6]});
  assert.equal(calls,0);panel.open=true;await panel.events.toggle();assert.equal(calls,1);
  assert.match(text(panel),/Lookup unavailable/);
  await panel.events.toggle();assert.equal(calls,2);assert.match(text(panel),/falls inside Chatham/);
  await panel.events.toggle();assert.equal(calls,2);
  for(const point of [null,[],[NaN,39],[0,Infinity],[-181,39],["-89",39]]) {
    assert.equal((await app.ParcelLocalDecisions.locateMunicipality(point)).status,"unknown");
  }
  assert.equal(calls,2);
});
test("a late geographic response cannot rewrite a removed property panel",async()=>{
  let finish;
  const app=setup(()=>new Promise(resolve=>{finish=resolve;}));
  const panel=app.showPropertyLocalDecisions(new Node("div"),{pin:"29060453009",position:[-89.7,39.6]});
  panel.open=true;const pending=panel.events.toggle();panel.isConnected=false;
  finish({ok:true,json:async()=>boundary("Chatham")});await pending;
  assert.doesNotMatch(text(panel),/falls inside Chatham/);
});
test("no taxpayer information is sent to a proxy or embedded third-party tax page",async()=>{
  let request;
  const app=setup(async href=>{request=new URL(href);return {ok:true,json:async()=>boundary("Chatham")};});
  const panel=app.showPropertyLocalDecisions(new Node("div"),{pin:"29060453009",position:[-89.7,39.6]});
  panel.open=true;await panel.events.toggle();
  assert.equal(request.searchParams.get("outFields"),"Corp_Name");
  assert.ok(!request.href.includes("29060453009"));
  assert.ok(!flatten(panel).some(n=>["iframe","script"].includes(n.tag)));
  assert.ok(flatten(panel).filter(n=>n.tag==="a").every(n=>n.referrerPolicy==="no-referrer"));
});
