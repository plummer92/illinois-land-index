// Source format checked against three public parcel records and a prior-year bill.
// Category names: county clerk's official Tax Extension & Levy & Rate Information.
// https://sangamonil.gov/departments/a-c/county-clerk/tax-assessment-delinquent-taxes/tax-extension-levy-rate-information
// Preserve unfamiliar district labels as "other" rather than guessing their type.
const categories = new Map();
const key = value => value.replace(/\s+/g," ").trim().toUpperCase();
function names(category, values) { for (const value of values) categories.set(key(value),category); }
names("schools",[
  "#5-CHATHAM","#186-SPFLD","#526 J.C.",
  "A-C Central School District #262","Athens Community Unit School District #213",
  "Auburn Community Unit School District #10","Chatham Community Unit School District #5",
  "Divernon School Dist. #13 Bonds","Edinburg Community Unit School District #4",
  "Mt. Pulaski Community Unit School District #23","New Berlin Community Unit School District #16",
  "North Mac Community Unit School District #34","Pawnee Community Unit School District #11",
  "Pleasant Pls Community Unit School District #8","Porta Community Unit School District #202",
  "Riverton Community Unit School District #14","Rochester Community Unit School District #3A",
  "Sang. Valley Community Unit School District #9","Spfld School District #186",
  "Tri-City Community Unit School District #1","Virden Community Unit School District #4",
  "Waverly Community Unit School District #6","Wville Community Unit School District #15",
  "Lincoln Land Community College #526","Richland Community College #537"
]);
names("village",[
  "CHATM CORP","SPFLD CORP",
  ...["Auburn","Berlin","Buffalo","Cantrall","Chatham","Clearlake","Dawson","Divernon",
    "Grandview","Illiopolis","Jerome","Leland Grove","Loami","Mechanicsburg","New Berlin",
    "Pawnee","Pleasant Plains","Riverton","Rochester","Sherman","Southern View","Spaulding",
    "Springfield","Thayer","Virden","Williamsville"].map(place => place + " Corporation")
]);
names("county",["COUNTY","Sangamon County"]);
// The county catalog assigns these agency numbers to schools and community colleges.
// Edinburg/Virden use 004C/004M; Rochester's formal school name includes #3A.
// A number must be complete and followed by a separator: #5260 is not #526.
const schoolCodes = new Set(["262","213","10","5","13","4","4C","4M","23","16","34","11","8","202","14","3","3A","9","186","1","6","15","526","537"]);
const municipalityNames = new Set([...categories].filter(([,category]) => category === "village")
  .map(([name]) => name.endsWith(" CORPORATION") ? name.slice(0,-12) : null).filter(Boolean));
function classify(name) {
  const normalized=key(name), exact=categories.get(normalized);
  if (exact) return exact;
  const school=normalized.match(/^#(\d+[A-Z]?)(?=[\s-]|$)/);
  if (school && schoolCodes.has(school[1].replace(/^0+(?=\d)/,""))) return "schools";
  if (normalized.endsWith(" CORP") && municipalityNames.has(normalized.slice(0,-5))) return "village";
  return "other";
}

const expectedHeaders = ["Taxing District","Previous Year Rate","Current Rate","Previous Year Taxes","Current Taxes","Difference","Pensions"];
const voidTags = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
const entity = {amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "};
function decode(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_match,code) => {
    if (!code.startsWith("#")) return entity[code.toLowerCase()];
    const number = parseInt(code.slice(code[1].toLowerCase() === "x" ? 2 : 1),code[1].toLowerCase() === "x" ? 16 : 10);
    if (!Number.isInteger(number) || number === 0 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) throw new Error("Invalid character in county response");
    return String.fromCodePoint(number);
  });
}
function text(node) { return typeof node === "string" ? decode(node) : node.children.map(text).join(" "); }
function clean(node) { return text(node).replace(/\s+/g," ").trim(); }
function descendants(node,tag) {
  const found=[];
  for (const child of node.children || []) if (typeof child !== "string") {
    if (child.tag === tag) found.push(child);
    found.push(...descendants(child,tag));
  }
  return found;
}
function children(node,tag) { return node.children.filter(child => typeof child !== "string" && child.tag === tag); }

// Small, non-executing HTML reader: works in Workers and browsers without DOMParser.
// It reads structure and text only. Nothing from the source is rendered as HTML.
function documentTree(html) {
  if (typeof html !== "string" || html.length > 1000000) throw new Error("Invalid county response size");
  const source=html.replace(/<!--[\s\S]*?-->/g,"").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"");
  const root={tag:"root",children:[]}, stack=[root];
  let count=0;
  const tokens=source.matchAll(/<![^>]*>|<\/?[a-z][\w:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>|[^<]+/gi);
  for (const match of tokens) {
    const token=match[0];
    if (token.startsWith("<!")) continue;
    if (!token.startsWith("<")) {stack[stack.length-1].children.push(token);continue;}
    const tag=token.match(/^<\/?([\w:-]+)/)[1].toLowerCase();
    if (token.startsWith("</")) {
      const at=stack.map(node => node.tag).lastIndexOf(tag);
      if (at>0) stack.length=at;
      continue;
    }
    if (++count>50000 || stack.length>100) throw new Error("County response structure too complex");
    const id=token.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const node={tag,id:id ? decode(id[1] ?? id[2] ?? id[3]) : undefined,children:[]};
    stack[stack.length-1].children.push(node);
    if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(node);
  }
  return root;
}
function money(value) {
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(value)) throw new Error("Invalid county monetary value");
  const negative=value.startsWith("-"), unsigned=value.replace(/^-/,"").replace(/,/g,"");
  const [whole,fraction]=unsigned.split(".");
  const cents=(BigInt(whole)*100n+BigInt(fraction))*(negative ? -1n : 1n);
  if (cents>BigInt(Number.MAX_SAFE_INTEGER) || cents<BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("County amount exceeds supported range");
  return Number(cents);
}
function rate(value) {
  if (!/^\d+\.\d{4}%$/.test(value) || !Number.isFinite(Number(value.slice(0,-1)))) throw new Error("Invalid county rate");
}
function safeSum(values) {
  const sum=values.reduce((total,value) => total+BigInt(value),0n);
  if (sum>BigInt(Number.MAX_SAFE_INTEGER) || sum<BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("County total exceeds supported range");
  return Number(sum);
}

export function parseTaxBill(html,expectedPin) {
  if (typeof expectedPin !== "string" || !/^\d{11}$/.test(expectedPin)) throw new Error("Expected an 11-digit parcel number");
  const tree=documentTree(html);
  const headers=descendants(tree,"div").filter(node => node.id === "parcelheader");
  if (headers.length !== 1) throw new Error("Missing or duplicate county parcel identity");
  const selected=clean(headers[0]).match(/Selected Parcel:\s*([\d.\-]+)/i);
  if (!selected || selected[1].replace(/\D/g,"") !== expectedPin) throw new Error("County response parcel mismatch");
  const headings=descendants(tree,"h1").map(clean);
  if (headings.length !== 1) throw new Error("Missing or ambiguous county bill heading");
  const tables=descendants(tree,"table").filter(table => {
    const thead=children(table,"thead");
    return thead.some(head => descendants(head,"th").map(clean).includes("Taxing District"));
  });
  if (headings[0] === "No Tax Bill Details") {
    if (tables.length || !clean(tree).includes("No tax bill details for this parcel in this tax year.")) throw new Error("Ambiguous missing-bill response");
    return {status:"no_bill",pin:expectedPin};
  }
  const yearMatch=headings[0].match(/^(?:Current Tax Bill Details \(Year (\d{4})\)|Tax Bill Details For Year (\d{4}))$/);
  if (!yearMatch || tables.length !== 1) throw new Error("County tax table or year unavailable");
  const year=Number(yearMatch[1] || yearMatch[2]);
  if (year<1900 || year>2100) throw new Error("Invalid county tax year");
  const table=tables[0];
  const thead=children(table,"thead"), tbody=children(table,"tbody");
  if (thead.length!==1 || tbody.length!==1 || descendants(table,"table").length) throw new Error("Unexpected county table structure");
  const actualHeaders=descendants(thead[0],"th").map(clean);
  if (actualHeaders.length!==7 || actualHeaders.some((label,index) => label!==expectedHeaders[index])) throw new Error("County tax columns changed");
  const records=children(tbody[0],"tr");
  if (records.length<2 || records.length>101) throw new Error("Invalid county tax row count");
  const rows=[], seen=new Set();
  let total;
  for (const record of records) {
    const cells=children(record,"td");
    if (cells.length!==7) throw new Error("Incomplete county tax row");
    const values=cells.map(clean), name=values[0], normalized=key(name);
    if (!name || name.length>100 || /[\u0000-\u001f\u007f<>]/.test(name) || seen.has(normalized)) throw new Error("Invalid or duplicate county tax district");
    seen.add(normalized);
    rate(values[1]);rate(values[2]);
    const [previous,amount,difference,pension]=values.slice(3).map(money);
    if (previous<0 || amount<0 || pension<0 || pension>amount || safeSum([amount,-previous])!==difference) throw new Error("Inconsistent county tax row amounts");
    const row={name,amount_cents:amount,previous_cents:previous,difference_cents:difference,pension_cents:pension};
    if (normalized === "* TOTAL *") {
      if (total) throw new Error("Duplicate county tax total");
      total=row;
    } else rows.push(row);
  }
  if (!total || !rows.length) throw new Error("County tax total missing");
  for (const field of ["amount_cents","previous_cents","difference_cents","pension_cents"]) {
    if (safeSum(rows.map(row => row[field]))!==total[field]) throw new Error("County tax amounts do not reconcile");
  }
  return {status:"ok",pin:expectedPin,tax_year:year,total_cents:total.amount_cents,
    districts:rows.map(row => ({name:row.name,amount_cents:row.amount_cents,category:classify(row.name)}))};
}
