import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = relative => readFileSync(new URL(relative, import.meta.url), "utf8");
const scoreText = read("../data/sangamon-parcel-scores.json");
const scores = JSON.parse(scoreText);
const reasons = JSON.parse(read("../parcel-dashboard/data/score-reasons.json"));
const context = vm.createContext({window:{}});
vm.runInContext(read("../parcel-dashboard/score-context.js"), context, {filename:"score-context.js"});
const api = context.window.ParcelScoreContext;
const row = ["fixture-parcel",0,0,2,9,8,13,30,1];
const sourceDate = "2026-11-08";
const rule = [0,9,0,0,8,0,0,-12,0];
const source = () => ({source_date:sourceDate,patterns:[rule],rows:{[row[0]]:0}});
const base = () => ({row:[...row],loaded:true,sourceDate,propertyClass:"IMPROVED RESIDENTIAL",parcel:{pin:row[0]}});
const fact = (input,label) => api.facts(input).find(item => item.label === label);
const ring = [[-89.75,39.65],[-89.74,39.65],[-89.74,39.66],[-89.75,39.65]];
const feature = (type,pin=row[0]) => ({properties:{PIN:pin},geometry:{type,coordinates:
  type === "Polygon" ? [ring] : type === "MultiPolygon" ? [[ring]] : [-89.75,39.65]}});

test("every published parcel has consistent totals and matching, dated explanation inputs", () => {
  assert.equal(scores.rows.length,22707,"reviewed snapshot coverage changed; re-audit the replacement");
  assert.equal(reasons.source_date,scores.source_date);
  assert.equal(Object.keys(reasons.rows).length,scores.rows.length);
  // Git's text checkout can use CRLF on Windows; the recorded digest covers LF source bytes.
  assert.equal(createHash("sha256").update(scoreText.replace(/\r\n/g,"\n")).digest("hex"),reasons.rank_file_sha256);
  for (const published of scores.rows) {
    assert.equal(published[4]+published[5]+published[6],published[7],"component total mismatch");
    assert.ok(api.validateReasons(reasons,published,scores.source_date),"missing or inconsistent explanation");
  }
});

test("zero is a recorded score, while absent entries and failed loading have separate states", () => {
  const zero = scores.rows.find(published => published[7] === 0);
  assert.ok(zero);
  assert.equal(fact({...base(),row:zero},"Scoring record").status,"Recorded");
  assert.match(api.interpretation(zero,true),/not a grade for your home/);
  assert.doesNotMatch(api.interpretation(zero,true),/outside the published|could not load/);
  assert.equal(fact({...base(),row:null},"Scoring record").status,"Not scored");
  assert.match(api.interpretation(null,true),/No score is different from a score of zero/);
  assert.equal(fact({...base(),row:null,loaded:false},"Scoring record").status,"Could not load");
  assert.match(api.interpretation(null,false),/unknown.*not a score of zero/);
});

test("missing acreage is not reported as zero area, and missing scores do not acquire deductions", () => {
  const missing = [...row]; missing[3]=0;
  const size = fact({...base(),row:missing},"Lot size");
  assert.equal(size.status,"Missing");
  assert.match(size.detail,/does not establish that the lot has zero area/);
  assert.match(size.detail,/missing-acreage deduction/);
  const unscored = fact({...base(),row:null},"Lot size");
  assert.equal(unscored.status,"Missing");
  assert.doesNotMatch(unscored.detail,/deduction|awarded/);
});

test("GIS acreage does not silently replace the scoring inputs or recalculate the score", () => {
  const updated = fact({...base(),parcel:{pin:row[0],acres:2.5}},"Lot size");
  assert.equal(updated.status,"Recorded");
  assert.match(updated.detail,/2.5 acres from this county GIS lookup/);
  assert.match(updated.detail,/score used 2 acres/);
  assert.match(updated.detail,/score has not been recalculated/);
  const missing = [...row]; missing[3]=0;
  const recovered = fact({...base(),row:missing,parcel:{pin:row[0],acres:0.25}},"Lot size");
  assert.match(recovered.detail,/score used no positive acreage/);
  assert.match(recovered.detail,/score has not been recalculated/);
  assert.match(recovered.detail,/missing-acreage deduction/);
  const unchanged = fact({...base(),parcel:{pin:row[0],acres:2}},"Lot size");
  assert.doesNotMatch(unchanged.detail,/sources differ/);
});

test("a failed GIS refresh preserves dated snapshot acreage", () => {
  const size = fact({...base(),parcel:{pin:row[0],geometryUnavailable:true}},"Lot size");
  assert.equal(size.status,"Recorded");
  assert.match(size.detail,/scoring snapshot dated 2026-11-08/);
  assert.match(size.detail,/GIS lookup could not refresh it/);
});

test("stored and live outlines are distinguished from point-only locations", () => {
  const snapshot = fact({...base(),entry:{d:"M0,0L1,1",pt:[0,0]}},"Lot boundary");
  assert.equal(snapshot.status,"Mapped");
  assert.match(snapshot.detail,/does not record a separate boundary retrieval date/);
  const live = fact({...base(),parcel:{pin:row[0],features:[feature("Polygon")]}},"Lot boundary");
  assert.equal(live.status,"Mapped");
  assert.match(live.detail,/returned by this lookup, not a boundary survey/);
  for (const extra of [{entry:{pt:[0,0]}},{parcel:{pin:row[0],position:[0,0]}},{parcel:{pin:row[0],features:[feature("Point")]}}]) {
    const point = fact({...base(),...extra},"Lot boundary");
    assert.equal(point.status,"Point only");
    assert.match(point.detail,/does not show the property limits/);
  }
});

test("another parcel's polygon and invalid coordinates cannot establish this parcel's boundary", () => {
  const boundary = fact({...base(),parcel:{pin:row[0],features:[feature("Polygon","other-fixture")],position:[NaN,1]}},"Lot boundary");
  assert.equal(boundary.status,"Missing");
});

test("empty, unclosed and non-finite polygons are not reported as mapped boundaries", () => {
  const invalidPolygons = [
    undefined, null, [], [[]],
    [[[0,0],[1,0],[1,1]]],
    [[[0,0],[1,0],[1,1],[0,1]]],
    [[[0,0],[0,0],[0,0],[0,0]]],
    [[[0,0],[1,0],[2,0],[0,0]]],
    [[[0,0],[1,0],[1,Infinity],[0,0]]],
    [[[0,0],[1,0],["1",1],[0,0]]],
    [ring,[]],
  ];
  for (const coordinates of invalidPolygons) {
    const parcel = {pin:row[0],features:[{properties:{PIN:row[0]},geometry:{type:"Polygon",coordinates}}]};
    assert.equal(fact({...base(),parcel},"Lot boundary").status,"Missing");
  }
});

test("multipolygons need nonempty valid parts, while an independent usable point stays point-only", () => {
  const valid = {pin:row[0],features:[feature("MultiPolygon")]};
  assert.equal(fact({...base(),parcel:valid},"Lot boundary").status,"Mapped");
  for (const coordinates of [undefined,null,[],[[]],[[ring],[]],[[ring],[[[0,0],[0,0],[0,0],[0,0]]]]]) {
    const parcel = {pin:row[0],features:[{properties:{PIN:row[0]},geometry:{type:"MultiPolygon",coordinates}}]};
    assert.equal(fact({...base(),parcel},"Lot boundary").status,"Missing");
    assert.equal(fact({...base(),parcel:{...parcel,position:[-89.75,39.65]}},"Lot boundary").status,"Point only");
  }
});

test("point features require a finite coordinate pair", () => {
  for (const coordinates of [undefined,null,[],[1],[1,2,3],[NaN,1],[Infinity,1],["1",2]]) {
    const parcel = {pin:row[0],features:[{properties:{PIN:row[0]},geometry:{type:"Point",coordinates}}]};
    assert.equal(fact({...base(),parcel},"Lot boundary").status,"Missing");
  }
});

test("pending lookup, failed lookup and no returned geometry remain separate", () => {
  assert.equal(fact({...base(),pending:true},"Lot boundary").status,"Checking");
  const failed = fact({...base(),parcel:{pin:row[0],geometryUnavailable:true}},"Lot boundary");
  assert.equal(failed.status,"Could not load");
  assert.match(failed.detail,/not evidence that no boundary exists/);
  assert.equal(fact(base(),"Lot boundary").status,"Missing");
});

test("explanation validation rejects unavailable, stale, malformed and inconsistent details", () => {
  assert.equal(api.validateReasons(source(),row,sourceDate),rule);
  assert.equal(api.validateReasons(null,row,sourceDate),null);
  assert.equal(api.validateReasons({...source(),source_date:"2026-11-07"},row,sourceDate),null);
  assert.equal(api.validateReasons({...source(),rows:{}},row,sourceDate),null);
  assert.equal(api.validateReasons({...source(),rows:{[row[0]]:"0"}},row,sourceDate),null);
  assert.equal(api.validateReasons({...source(),patterns:[[...rule.slice(0,8)]]},row,sourceDate),null);
  assert.equal(api.validateReasons({...source(),patterns:[[0,9,0,0,8,0,0,-12,0.5]]},row,sourceDate),null);
  assert.equal(api.validateReasons({...source(),patterns:[[0,8,0,0,8,0,0,-12,0]]},row,sourceDate),null);
  const badTotal = [...row]; badTotal[7]++;
  assert.equal(api.validateReasons(source(),badTotal,sourceDate),null);
});
