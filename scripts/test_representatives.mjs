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
const cyrusone = JSON.parse(read("../parcel-dashboard/data/cyrusone-county-vote.json"));

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

test("the CyrusOne ledger reconciles the final 29-member roll call",() => {
  assert.equal(api.validCountyVote(cyrusone),cyrusone);
  assert.equal(cyrusone.vote_date,"2026-04-07");
  assert.deepEqual(cyrusone.tally,{yes:17,no:10,abstain:1,not_voting:1});
  assert.deepEqual(cyrusone.source.pages,[31]);
  assert.equal(api.countyVoteContext(cyrusone,"7",data.county_board["7"]).label,"No");
  assert.equal(api.countyVoteContext(cyrusone,"26",data.county_board["26"]).label,"Yes");
});

test("all four replacement members are never assigned their predecessor's vote",() => {
  const predecessors = {2:"Casey Constant",4:"Jeffrey A. Thomas",12:"Marc Ayers",16:"Greg Stumpf"};
  for (const [district,previous] of Object.entries(predecessors)) {
    const context = api.countyVoteContext(cyrusone,district,data.county_board[district]);
    assert.equal(context.status,"previous",district);
    assert.equal(context.record.member_at_vote,previous);
    assert.notEqual(context.record.member_at_vote,data.county_board[district].name);
  }
  for (const district of Object.keys(cyrusone.records).filter(key => !Object.hasOwn(predecessors,key))) {
    assert.equal(api.countyVoteContext(cyrusone,district,data.county_board[district]).status,"current",district);
  }
});

test("abstention and chairman non-vote remain distinct from opposition and absence",() => {
  assert.equal(api.countyVoteContext(cyrusone,"4",data.county_board["4"]).label,"Abstained");
  const chair = api.countyVoteContext(cyrusone,"24",data.county_board["24"]);
  assert.equal(chair.record.vote,"not_voting");
  assert.equal(chair.label,"Did not vote");
  assert.equal(chair.status,"current");
});

test("unresolved locations and unavailable vote records do not become a No vote",() => {
  for (const district of [null,undefined,"","30","7,26"]) {
    const result = api.countyVoteContext(cyrusone,district,data.county_board["7"]);
    assert.equal(result.status,"unresolved");
    assert.equal(result.label,undefined);
  }
  assert.equal(api.countyVoteContext(null,"7",data.county_board["7"]).status,"unavailable");
  const unknownHolder = api.countyVoteContext(cyrusone,"7",{name:"Unverified new official"});
  assert.equal(unknownHolder.status,"previous");
  assert.equal(api.countyVoteContext(cyrusone,"7",null).status,"historical");
});

test("incomplete, altered or mislabeled roll calls fail validation",() => {
  const changes = [
    value => {delete value.records["1"];},
    value => {value.records["24"].vote="no";},
    value => {value.tally.yes=18;},
    value => {value.vote_date="2026-03-23";},
    value => {value.source.pages=[];},
    value => {value.source.url="https://unverified.example/vote";},
    value => {value.records["7"].identity_aliases=[value.records["26"].member_at_vote];},
  ];
  for (const change of changes) {
    const value = structuredClone(cyrusone); change(value);
    assert.equal(api.validCountyVote(value),null);
  }
});
