import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseTaxBill} from "../api/tax-parser.mjs";

const read=name => readFileSync(new URL("./fixtures/tax-"+name+".html",import.meta.url),"utf8");
const residential=read("residential"), pin="29060453009";

test("official residential bill returns current taxes in exact cents with schools and college combined",() => {
  const data=parseTaxBill(residential,pin);
  assert.equal(data.status,"ok");assert.equal(data.tax_year,2025);
  assert.equal(data.total_cents,591210);assert.equal(data.districts.length,11);
  assert.equal(data.districts.reduce((sum,row)=>sum+row.amount_cents,0),data.total_cents);
  const amounts=Object.fromEntries(["schools","village","county","other"].map(category=>[category,data.districts.filter(row=>row.category===category).reduce((sum,row)=>sum+row.amount_cents,0)]));
  assert.deepEqual(amounts,{schools:367553,village:33353,county:56550,other:133754});
  assert.equal(data.districts.find(row=>row.name==="#526 J.C.").category,"schools");
  assert.equal(data.districts.find(row=>row.name==="BALL R&B").category,"other");
  assert.equal(JSON.stringify(data).includes("pension"),false,"pensions are not an extra spending category");
});

test("zero-tax exempt bill is a real zero bill, not a missing record",() => {
  const data=parseTaxBill(read("exempt"),"29070380008");
  assert.equal(data.status,"ok");assert.equal(data.total_cents,0);
  assert.ok(data.districts.length>0);assert.ok(data.districts.every(row=>row.amount_cents===0));
});

test("Springfield bill keeps city corporation separate from school, college, county and other districts",() => {
  const data=parseTaxBill(read("springfield"),"14320101015");
  assert.equal(data.total_cents,579792);
  assert.equal(data.districts.find(row=>row.name==="SPFLD CORP").category,"village");
  assert.equal(data.districts.find(row=>row.name==="SPFLD PARK").category,"other");
  assert.equal(data.districts.find(row=>row.name==="#186-SPFLD").category,"schools");
  assert.equal(data.districts.find(row=>row.name==="S.M.T.D").category,"other");
});

test("prior-year heading is read from that bill and never replaced with the current calendar year",() => {
  const data=parseTaxBill(read("prior-year"),pin);
  assert.equal(data.tax_year,2024);assert.equal(data.total_cents,542888);
});

test("explicit no-bill response differs from service errors, unknown markup and malformed tables",() => {
  assert.deepEqual(parseTaxBill(read("no-bill"),"00000000000"),{status:"no_bill",pin:"00000000000"});
  assert.throws(()=>parseTaxBill("<h1>Service unavailable</h1>",pin));
  assert.throws(()=>parseTaxBill(read("no-bill").replace("No tax bill details for this parcel in this tax year.","Please retry"),"00000000000"));
});

test("expected PIN and returned parcel identity must match before any amount is trusted",() => {
  assert.throws(()=>parseTaxBill(residential,"29060453010"),/parcel mismatch/);
  for (const bad of [null,"29060453009?x=1","29-06.0-453-009",29060453009]) assert.throws(()=>parseTaxBill(residential,bad));
  assert.throws(()=>parseTaxBill(residential.replace("parcelheader","different-header"),pin),/parcel identity/);
});

test("district labels not verified in the official catalog remain other and retain their amount",() => {
  for (const unknown of ["#999-NEW SCHOOL","NEW CORP","COUNTY WATER","CHATHAM LIBRARY"]) {
    const data=parseTaxBill(residential.replace("#5-CHATHAM",unknown),pin);
    const row=data.districts.find(row=>row.name===unknown);
    assert.equal(row.category,"other");assert.equal(row.amount_cents,330411);
  }
  const catalog=parseTaxBill(residential.replace("#5-CHATHAM","Chatham Community Unit School District #5"),pin);
  assert.equal(catalog.districts[0].category,"schools");
});

test("verified county school agency numbers include the county's other school and college districts",() => {
  for (const code of ["262","213","10","5","13","4","4C","4M","23","16","34","11","8","202","14","3","3A","9","186","1","6","15","526","537"]) {
    const data=parseTaxBill(residential.replace("#5-CHATHAM","#"+code+"-DISTRICT"),pin);
    assert.equal(data.districts[0].category,"schools",code);
  }
  for (const label of ["#5260-DISTRICT","#15A-DISTRICT","#999-SCHOOL","262-DISTRICT"]) {
    assert.equal(parseTaxBill(residential.replace("#5-CHATHAM",label),pin).districts[0].category,"other",label);
  }
  assert.equal(parseTaxBill(residential.replace("CHATM CORP","ROCHESTER CORP"),pin).districts.find(row=>row.name==="ROCHESTER CORP").category,"village");
});

test("duplicate districts and duplicate or missing total rows fail closed",() => {
  assert.throws(()=>parseTaxBill(residential.replace("#526 J.C.","#5-CHATHAM"),pin),/duplicate/);
  const total=residential.match(/<tr>\s*<td[^>]*>\* TOTAL \*[\s\S]*?<\/tr>/)[0];
  assert.throws(()=>parseTaxBill(residential.replace("</tbody>",total+"</tbody>"),pin),/duplicate/);
  assert.throws(()=>parseTaxBill(residential.replace(total,""),pin),/total missing/);
});

test("changed columns, partial rows and additional tax tables do not silently shift monetary fields",() => {
  assert.throws(()=>parseTaxBill(residential.replace("Current Taxes","Balance Due"),pin),/columns changed/);
  assert.throws(()=>parseTaxBill(residential.replace('<td align="right">3304.11</td>',""),pin),/Incomplete/);
  const table=residential.match(/<table[\s\S]*<\/table>/)[0];
  assert.throws(()=>parseTaxBill(residential+table,pin),/table or year/);
});

test("non-finite, malformed and oversized monetary strings fail instead of becoming zero",() => {
  for (const bad of ["NaN","Infinity","1e3","","3304.1","3,30.11","90071992547410.00"]) {
    assert.throws(()=>parseTaxBill(residential.replace("3304.11",bad),pin));
  }
  const grouped=parseTaxBill(residential.replace("3304.11","3,304.11"),pin);
  assert.equal(grouped.districts[0].amount_cents,330411);
});

test("row differences and all monetary totals must reconcile, without adding pensions",() => {
  assert.throws(()=>parseTaxBill(residential.replace("3304.11","3304.12"),pin),/Inconsistent/);
  assert.throws(()=>parseTaxBill(residential.replace("5912.10","5912.11").replace("483.22","483.23"),pin),/do not reconcile/);
  assert.throws(()=>parseTaxBill(residential.replace("116.34","9999.99"),pin),/Inconsistent/);
});

test("comments and scripts cannot supply an alternative parsed identity or tax table",() => {
  const noise='<!-- <div id="parcelheader">Selected Parcel: 00-00.0-000-000</div> --><script><h1>No Tax Bill Details</h1></script>';
  assert.equal(parseTaxBill(noise+residential,pin).total_cents,591210);
});

test("ordinary page wrapper tables and navigation do not become duplicate bill rows",() => {
  const wrapped='<html><head><title>County tax details</title><style>table{width:100%}</style></head><body><table id="wrapper"><tr><td><nav><a href="history">Billing history</a></nav><table><tr><td>Unrelated layout</td></tr></table>'+residential+'</td></tr></table></body></html>';
  const data=parseTaxBill(wrapped,pin);
  assert.equal(data.total_cents,591210);assert.equal(data.districts.length,11);
});
