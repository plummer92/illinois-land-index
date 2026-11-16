(() => {
  "use strict";
  const countyBase = "https://tax.sangamonil.gov/SangamonCountyWeb/app/";
  const municipalLayer = "https://sangis.co.sangamon.il.us/server/rest/services/Sangamon_MajorBoundaries/MapServer/6";
  const normalize = value => String(value || "").trim().toUpperCase().replace(/\s+/g," ");
  const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
  function taxLinks(pin) {
    if (!/^\d{11}$/.test(String(pin))) return null;
    const route = name => countyBase + name + ".action?" + new URLSearchParams({parcelNumber:String(pin)});
    return {breakdown:route("taxBillDetails"),pdf:route("propertyTaxBill"),history:route("billingHistoryList")};
  }
  function municipality(value) {
    if (!value || value.error || value.exceededTransferLimit || !Array.isArray(value.features)) return {status:"unknown"};
    if (!value.features.length) return {status:"no_match"};
    const names = value.features.map(feature => normalize(feature?.attributes?.Corp_Name));
    if (names.some(name => !name) || new Set(names).size !== 1) return {status:"unknown"};
    return {status:names[0] === "CHATHAM" ? "chatham" : "other",name:names[0]};
  }
  const cache = new Map();
  async function locateMunicipality(point) {
    if (!validPoint(point)) return {status:"unknown"};
    const key = point.join(",");
    if (cache.has(key)) return cache.get(key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),10000);
    try {
      const url = new URL(municipalLayer + "/query");
      url.search = new URLSearchParams({f:"json",where:"1=1",geometry:JSON.stringify({x:point[0],y:point[1],spatialReference:{wkid:4326}}),geometryType:"esriGeometryPoint",inSR:"4326",spatialRel:"esriSpatialRelIntersects",outFields:"Corp_Name",returnGeometry:"false"});
      const response = await fetch(url.href,{signal:controller.signal});
      if (!response.ok) return {status:"unknown"};
      const result = municipality(await response.json());
      if (result.status !== "unknown") cache.set(key,result);
      return result;
    } catch { return {status:"unknown"}; }
    finally { clearTimeout(timer); }
  }
  function scopeText(result) {
    if (result.status === "chatham") return "The parcel’s map point falls inside Chatham’s municipal boundary. The research below concerns village decisions; utility service and taxing districts must still be checked separately.";
    if (result.status === "other") return "The parcel’s map point falls inside " + result.name + ", rather than Chatham. The links below are general Chatham research; they do not establish charges or decisions applying to this property.";
    if (result.status === "no_match") return "The county map returned no municipality at this parcel’s map point. The Chatham research below is general information; a Chatham postal address alone does not establish village residency or utility service.";
    return "We could not verify this parcel’s municipality. The Chatham research below is general information; a postal address alone does not establish village residency or utility service.";
  }
  const create = (tag,text,className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function link(label,href) {
    const node = create("a",label);
    node.href = href;
    node.referrerPolicy = "no-referrer";
    return node;
  }
  function section(parent,title) {
    const node = create("section",undefined,"local-decision-card");
    node.append(create("h3",title)); parent.append(node); return node;
  }
  function showPropertyLocalDecisions(target,{pin,position} = {}) {
    const details = create("details",undefined,"parcel-local-decisions");
    const summary = create("summary","Taxes and local decisions");
    const body = create("div",undefined,"local-decisions-body");
    details.append(summary,body); target.append(details);
    const taxes = section(body,"Where this property’s taxes go");
    const urls = taxLinks(pin);
    if (urls) {
      taxes.append(create("p","Open the county’s bill breakdown for parcel " + pin + " to see each taxing district and its dollar share."));
      const primary = link("See my property-tax breakdown",urls.breakdown);
      primary.className = "local-tax-button";
      const secondary = create("div",undefined,"local-decision-links");
      secondary.append(link("Open bill PDF",urls.pdf),link("Compare previous years",urls.history));
      taxes.append(primary,secondary);
    } else {
      taxes.append(create("p","A valid county parcel number is needed for a property-specific bill."),link("Search the official county tax records",countyBase + "searchByParcelNumber.action"));
    }
    taxes.append(create("p","Read the tax year at the top, then the Current Taxes column. That column shows district shares of the bill. Remaining balance, payments and penalties are separate; the Pensions column is not an extra amount to add to the total."));
    taxes.append(create("p","The county holds the live bill; amounts are not imported here. A missing bill is not evidence that no tax is owed. The bill shows which districts levy taxes, not the projects each tax dollar funded.","local-decision-note"));
    const source = create("p",undefined,"local-decision-source");
    source.append(link("Source: Sangamon County Treasurer", "https://sangamonil.gov/departments/s-z/treasurer"),document.createTextNode(" · Bill links checked November 15, 2026. Tax year 2025 is payable in 2026; use the year shown on your bill."));
    taxes.append(source);
    const local = section(body,"Chatham rates and spending");
    const scope = create("p",validPoint(position) ? "Open this section to check the parcel’s municipality." : scopeText({status:"unknown"}),"local-decision-scope");
    const boundarySource = create("p",undefined,"local-decision-source");
    local.append(scope,boundarySource);
    const topics = [
      ["Utility-rate changes","Compare the posted electricity, water and sewer rates. These apply to Village of Chatham utility customers; this map does not verify your provider.","utility-rates"],
      ["Utility administration and village hall","See the administration appropriations, approved village-hall financing and the cost-allocation records still needed.","administration"],
      ["Roads and recurring contracts","Compare Plummer and Bristol/Hastings awards with warrant entries, and review the posted Springbrook software order.","roads"]
    ];
    for (const [title,description,anchor] of topics) {
      const topic = create("div",undefined,"local-decision-topic");
      topic.append(link(title,"../chatham-spending/#" + anchor),create("p",description));
      local.append(topic);
    }
    local.append(link("Read all Chatham spending research","../chatham-spending/"),create("p","Property taxes, utility charges and sales taxes are different revenue sources. An approved budget or spending limit is not proof of payment.","local-decision-note"));
    let checked = false, checking = false;
    details.addEventListener("toggle",async () => {
      if (!details.open || checked || checking || !validPoint(position)) return;
      checking = true; scope.textContent = "Checking the county’s municipal boundary map…";
      const result = await locateMunicipality(position);
      checking = false;
      if (!details.isConnected) return;
      checked = result.status !== "unknown";
      scope.textContent = scopeText(result);
      boundarySource.replaceChildren(link("Source: county municipal-boundary layer",municipalLayer),document.createTextNode(result.status === "unknown" ? " · Lookup unavailable. Close and reopen this section to retry." : " · Checked for this map point during this browser session; boundary publication date not supplied by this lookup."));
    });
    return details;
  }
  window.ParcelLocalDecisions = {taxLinks,municipality,validPoint,scopeText,locateMunicipality};
  window.showPropertyLocalDecisions = showPropertyLocalDecisions;
})();
