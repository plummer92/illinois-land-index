import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const read = path => readFileSync(new URL(path,import.meta.url),"utf8");
const context = vm.createContext({window:{}});
vm.runInContext(read("../parcel-dashboard/representatives.js"),context);
const api = context.window.ParcelRepresentatives;
const data = JSON.parse(read("../parcel-dashboard/data/representatives.json"));
const votes = JSON.parse(read("../parcel-dashboard/data/chatham-reviewed-votes.json"));

test("a split precinct or boundary match never chooses one of multiple districts",() => {
  assert.equal(api.one([48,54]),null);
  assert.equal(api.one([]),null);
  assert.equal(api.one(undefined),null);
  assert.equal(api.one([48,48]),"48");
  assert.equal(api.resolved({ok:true,records:[{DISTRICT:1},{DISTRICT:2}]},"DISTRICT"),null);
  assert.equal(api.resolved({ok:false,records:[{DISTRICT:1}]},"DISTRICT"),null);
  const split = Object.values(data.precinct_districts).filter(value => value.senate.length > 1 || value.house.length > 1);
  assert.ok(split.length > 0,"split precinct evidence must not be collapsed");
  for (const precinct of split) for (const chamber of ["senate","house"]) if (precinct[chamber].length > 1) assert.equal(api.one(precinct[chamber]),null);
});

test("no district lookup can be built from missing or non-finite coordinates",() => {
  for (const point of [null,[],[1],[1,2,3],[NaN,39],[-89,Infinity],[-181,39],[-89,91],["-89",39]]) assert.equal(api.validPoint(point),false);
  assert.equal(api.validPoint([-89.7,39.6]),true);
});

test("official directory has bounded county coverage and named primary sources",() => {
  assert.equal(Object.keys(data.county_board).length,29);
  assert.equal(Object.keys(data.precinct_districts).length,166);
  assert.equal(data.local.municipalities.CHATHAM.officials.filter(value => value.office === "Trustee").length,6);
  assert.ok(data.local.schools["CHATHAM UNIT #5"]);
  assert.deepEqual(data.gis.school.fields,["SchoolDistrict"]);
  assert.ok(data.sources.every(source => source.url.startsWith("https://")));
  const publicText = JSON.stringify(data);
  assert.doesNotMatch(publicText,/"(?:home_address|mailing_address|owner_name|phone|email)"/i);
});

test("selected votes retain voice-vote uncertainty, absence and abstention",() => {
  assert.equal(votes.records.length,15);
  assert.match(votes.scope,/not a complete voting history/);
  for (const row of votes.records) {
    assert.ok(row.source_url.startsWith("https://chathamil.community.highbond.com/"));
    if (row.vote_type === "voice") assert.ok(Object.values(row.votes).every(value => value !== "Yes" && value !== "No"));
  }
  const core = votes.records.find(row => row.date === "2025-10-14");
  assert.equal(core.votes["Kristen Chiaro"],"Abstain");
  assert.ok(votes.records.some(row => row.votes["Tim Nice"] === "Absent"));
});
