import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read = path => readFileSync(new URL(path,import.meta.url),"utf8");
class Node {
  constructor(tag="text",value="") { this.tag=tag; this.children=[]; this.dataset={}; this.value=""; this._text=value; }
  set textContent(value) { this._text=value; this.children=[]; }
  get textContent() { return this._text + this.children.map(child=>typeof child==="string"?child:child.textContent).join(" "); }
  append(...children) { for(const child of children) { if(typeof child!=="string") { child.remove(); child.parentNode=this; } this.children.push(child); } }
  prepend(...children) { this.append(...children); this.children.unshift(...this.children.splice(-children.length)); }
  replaceChildren(...children) { for(const child of this.children) if(typeof child!=="string") child.parentNode=null; this.children=[]; this._text=""; this.append(...children); }
  addEventListener() {}
  setAttribute(key,value) { this[key]=value; }
  remove() { if(this.parentNode) this.parentNode.children=this.parentNode.children.filter(child=>child!==this); this.parentNode=null; }
}
const box = (west,south,east,north) => ({type:"Polygon",coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]});
const area=box(-90,39,-89,40), elsewhere=box(-88,39,-87,40);
const data=()=>({checked:"2026-11-12",bounds:[-90,39,-89,40],county:area,
  water:[{id:"IL1670300",name:"CHATHAM",boundary:"Modeled",geometry:area}],
  power:[{id:"56697",name:"Ameren Illinois",sourceYear:2023,geometry:area}],
  plan:{interior:area,vicinity:area},sources:{water:"https://example.org/epa",power:"https://example.org/power",plan:"https://example.org/plan"}});
function setup({areas=data(),gas={source:"https://example.org/county",retrieved:"2026-11-12",communities:[{name:"Chatham",bounds:[-90,39,-89,40],geometry:area}]},failure=false}={}) {
  const context=vm.createContext({window:{},URL,Date,Intl,document:{createElement:tag=>new Node(tag),createTextNode:value=>new Node("text",value)},Option:function(label,value) {const result=new Node("option",label);result.value=value;return result;},
    fetch:async url=>{if(failure)throw Error("offline");return{ok:true,json:async()=>url.includes("gas-communities")?gas:areas};}});
  for(const file of ["water-reports.js","energy-sources.js","utilities.js"]) vm.runInContext(read("../parcel-dashboard/"+file),context,{filename:file});
  return context.window;
}
const descendants=node=>[node,...node.children.filter(child=>typeof child!=="string").flatMap(descendants)];

test("water and village electricity show retrieval dates without inventing a boundary vintage",async()=>{
  const api=setup(),root=new Node("div");
  await api.showPropertyUtilities(root,{lon:-89.7,lat:39.7});
  const water=descendants(root).find(node=>node.dataset.utility==="water");
  const power=descendants(root).find(node=>node.dataset.utility==="power");
  assert.match(water.textContent,/Estimated service area/);
  assert.match(water.textContent,/EPA service-area map · Map checked Nov 12, 2026/);
  assert.match(water.textContent,/Boundary update date unavailable/);
  assert.match(power.textContent,/Village electric map · Map checked Nov 12, 2026/);
  assert.match(power.textContent,/2041 plan is the planning horizon; map update date unavailable/);
  assert.match(power.textContent,/Confirm the meter’s provider on your bill/);
  assert.match(power.textContent,/September 2026/);
});

test("regional electric source year stays separate from the map check date",async()=>{
  const areas=data();areas.plan={interior:elsewhere,vicinity:elsewhere};
  const api=setup({areas}),root=new Node("div");
  await api.showPropertyUtilities(root,{lon:-89.7,lat:39.7});
  const power=descendants(root).find(node=>node.dataset.utility==="power");
  assert.match(power.textContent,/Source record year: 2023/);
  assert.match(power.textContent,/Map checked Nov 12, 2026/);
  assert.doesNotMatch(power.textContent,/Source record year: 2026/);
});

test("gas label identifies the county boundary retrieval without confirming a meter",async()=>{
  const api=setup(),root=new Node("div");
  await api.showPropertyUtilities(root,{lon:-89.7,lat:39.7});
  const gas=descendants(root).find(node=>node.dataset.utility==="gas");
  assert.match(gas.textContent,/Community match only/);
  assert.match(gas.textContent,/County municipal boundaries · Boundary retrieved Nov 12, 2026/);
  assert.match(gas.textContent,/Utility-list effective date unavailable/);
  assert.match(gas.textContent,/municipal location alone does not confirm service/);
});

test("annual report year does not become a current home water test",()=>{
  const api=setup(),root=new Node("div");
  assert.equal(api.addWaterReport(root,"IL1670300"),true);
  assert.match(root.textContent,/Village of Chatham annual water report · Report year: 2025/);
  assert.match(root.textContent,/Sampling dates vary by test/);
  assert.match(root.textContent,/Review date unavailable/);
  assert.match(root.textContent,/not a test of this home’s tap/);
});

test("absent or invalid metadata dates remain unavailable, and failed loads claim no match",async()=>{
  const api=setup({failure:true});
  for(const date of [undefined,"","2041","2026-02-30","not-a-date"]) assert.equal(api.UtilitySourceContext.dateLabel(date),null);
  const text=api.UtilitySourceContext.evidenceText({sourceName:"County map",checked:"2026-02-30"});
  assert.match(text.summary,/Check date unavailable/);
  assert.match(text.dates,/Source date unavailable/);
  const root=new Node("div");await api.showPropertyUtilities(root,{lon:-89.7,lat:39.7});
  assert.match(root.textContent,/Service map unavailable/);
  assert.doesNotMatch(root.textContent,/Map checked|Boundary retrieved|Mapped service area/);
});
