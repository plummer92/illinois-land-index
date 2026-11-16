(() => {
  const epaMap = "https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas";
  const countySystems = "https://water.epa.state.il.us/dww/JSP/WaterSystems.jsp?PointOfContactType=none&county=Sangamon&name=&number=";
  const villageOffice = "https://www.chathamil.gov/community?anchorUtility";
  const imea = "https://www.imea.org/IMEA%20Power%20Resources.html";
  const electricNames = {
    "3405":"Village of Chatham", "16420":"Rural Electric Convenience Cooperative (RECC)",
    "56697":"Ameren Illinois", "17828":"Springfield City Water, Light & Power (CWLP)",
    "16092":"Village of Riverton", "12395":"Menard Electric Cooperative", "17040":"Shelby Electric Cooperative",
    "17697":"Southwestern Electric Cooperative", "9209":"Illinois Rural Electric Cooperative"
  };
  const waterSources = {
    IL1670050:{
      name:"City of Auburn", supply:"Auburn buys treated water from the Otter Lake Water Commission, which draws surface water from Otter Lake."
    },
    IL1671000:{
      name:"Village of Rochester", supply:"Rochester buys drinking water from Springfield City Water, Light & Power, which treats water from Lake Springfield."
    },
    IL1670300:{
      name:"Chatham", supply:"Chatham normally buys well water from the South Sangamon Water Commission. Springfield’s City Water, Light & Power provides emergency backup.",
      label:"Chatham’s 2025 water report", url:"https://www.chathamil.gov/files/manual/2302/2025ChathamCCR.pdf"
    },
    IL1671200:{
      name:"Springfield City Water, Light & Power", supply:"CWLP draws water from Lake Springfield and treats it at its water purification plant.",
      label:"CWLP’s water source", url:"https://www.cwlp.com/departments/waterdepthome/WaterInformation/Purification.aspx"
    }
  };
  function text(tag, str) {
    const el = document.createElement(tag);
    el.textContent = str;
    return el;
  }
  function source(label, url) {
    const link = text("a", label);
    link.href = url;
    link.referrerPolicy = "no-referrer";
    return link;
  }
  function dateLabel(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(value + "T00:00:00Z");
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) return null;
    return new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(parsed);
  }
  function evidenceText({sourceName, checked, checkedLabel = "Map checked", sourceDate} = {}) {
    const date = dateLabel(checked);
    return {
      summary: sourceName ? sourceName + " · " + (date ? checkedLabel + " " + date : "Check date unavailable") : "Source unavailable",
      dates: (sourceDate || "Source date unavailable") + ". " + (date ? checkedLabel + " " + date + "." : "Check date unavailable.")
    };
  }
  window.UtilitySourceContext = {dateLabel,evidenceText};
  // Every geometry is GeoJSON in longitude/latitude. Evaluate holes in each
  // polygon separately so a point in an excluded area doesn't pick up service.
  function inRing(x, y, ring) {
    let inside = false;
    for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
      const [ax,ay] = ring[j], [bx,by] = ring[i];
      if ((ay>y) !== (by>y) && x < (bx-ax)*(y-ay)/(by-ay)+ax) inside = !inside;
    }
    return inside;
  }
  function within(x, y, g) {
    const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return polygons.some(rings => inRing(x,y,rings[0]) && !rings.slice(1).some(r => inRing(x,y,r)));
  }
  let groupNumber = 0;

  function utilityRow(panel, group, kind, title, coords) {
    const row = document.createElement("details");
    row.className = "utility-row";
    row.name = group;
    row.dataset.utility = kind;
    const summary = document.createElement("summary");
    const label = text("strong",title);
    const line = document.createElement("span");
    line.className = "utility-summary-line";
    const provider = text("span","Checking service records…");
    const qualifier = text("span","");
    qualifier.className = "utility-qualifier";
    line.append(provider,qualifier);
    const sourceLine = text("span","");
    sourceLine.className = "utility-source-summary";
    sourceLine.hidden = true;
    summary.append(label,line,sourceLine);
    const body = document.createElement("div");
    body.className = "utility-body";
    const details = document.createElement("div");
    const map = document.createElement("div");
    map.className = "property-source-location";
    const records = document.createElement("div");
    const evidence = document.createElement("p");
    evidence.className = "utility-evidence";
    evidence.hidden = true;
    body.append(evidence,details,map,records);
    row.append(summary,body);
    panel.append(row);

    let mapData = null;
    let mapDirty = false;
    function drawMap() {
      if (!row.open || !mapDirty) return;
      mapDirty = false;
      window.showUtilitySourceMap?.(map,{...coords,preferredKind:kind,...mapData});
    }
    row.addEventListener("toggle",drawMap);
    return {
      details, records,
      describe(name,coverage) {
        provider.textContent = name;
        qualifier.textContent = coverage ? " · " + coverage : "";
      },
      setEvidence(info) {
        const wording = evidenceText(info);
        sourceLine.textContent = wording.summary;
        sourceLine.hidden = false;
        evidence.replaceChildren();
        evidence.hidden = !info?.sourceName;
        if (info?.sourceName) {
          evidence.append("Source: ",info.url ? source(info.sourceName,info.url) : info.sourceName,
            text("span",wording.dates));
        }
      },
      setMap(data) {
        mapData = data;
        mapDirty = true;
        drawMap();
      }
    };
  }

  function billChoice(card, label, options, onChange) {
    const field = document.createElement("label");
    field.className = "utility-bill-choice";
    const select = document.createElement("select");
    select.append(new Option("Choose a supplier",""));
    for (const [value,name] of options) select.append(new Option(name,value));
    select.addEventListener("change",() => onChange(select.value));
    field.append(text("span",label),select);
    card.append(field);
  }

  function waterDetails(row,id) {
    const details = waterSources[id];
    if (details) {
      row.details.append(text("p",details.supply));
      if (!window.addWaterReport?.(row.details,id)) {
        row.records.append(source(details.label || "Look up the water system",details.url || countySystems));
      }
    } else {
      const lookup = new URL(countySystems);
      lookup.searchParams.set("county","");
      lookup.searchParams.set("number",id);
      row.records.append(text("p","We haven’t summarized this system’s annual water report yet."),
        source("Find this system’s testing records at Illinois EPA",lookup.href));
    }
  }

  function showWater(row, areas, data) {
    row.setEvidence({sourceName:"EPA service-area map",url:data.sources.water,checked:data.checked,
      sourceDate:"Boundary update date unavailable"});
    const sitesFor = id => ({sites:window.propertyWaterSites?.(id) || []});
    if (areas.length === 1) {
      const [area] = areas;
      const sites = sitesFor(area.id);
      const name = waterSources[area.id]?.name || area.name;
      const normal = sites.sites.find(site => site.role === "normal");
      row.describe(normal ? name + " · " + normal.name : name,
        area.boundary === "Modeled" ? "Estimated service area" : "Mapped service area");
      row.details.append(text("p",area.boundary === "Modeled" ? "EPA estimates this system’s service area includes this location. Check the name on your water bill to confirm." :
        (area.boundary === "System Sourced" ? "The water system’s published service area includes this location. This does not confirm a connection at the meter; check your water bill." : "EPA’s published service area includes this location. This does not confirm a connection at the meter; check your water bill.")));
      waterDetails(row,area.id);
      row.setMap(sites);
      return;
    }

    const summary = areas.length ? "Overlapping water systems" : "Water supplier unknown";
    const coverage = areas.length ? "Confirm on bill" : "No mapped system";
    row.describe(summary,coverage);
    row.details.append(text("p",areas.length ? "EPA’s service areas overlap here. Check the water supplier on the bill for this address." :
      "EPA’s map has no community water system at this point. A smaller system or a private well may supply the property."));
    row.records.append(source("Look up a Sangamon County water system",countySystems));
    if (areas.length) {
      const options = areas.map(area => [area.id,waterSources[area.id]?.name || area.name]);
      const supply = document.createElement("div");
      const report = document.createElement("div");
      billChoice(row.details,"Water supplier on your bill",options,id => {
        supply.replaceChildren();
        report.replaceChildren();
        if (id) waterDetails({details:supply,records:report},id);
        row.describe(options.find(([key]) => key === id)?.[1] || summary,id ? "Selected from bill" : coverage);
        row.setMap(sitesFor(id));
      });
      row.details.append(supply);
      row.records.prepend(report);
    }
    row.setMap({sites:[]});
  }

  function showPower(row, data, lon, lat) {
    const office = () => source("Contact the village utility office",villageOffice);
    const part = row.details;
    const portfolioEvidence = text("p","");
    portfolioEvidence.className = "utility-evidence";
    const setPortfolio = id => {
      const sites = window.propertyPowerSites?.(id) || [];
      row.setMap({sites});
      portfolioEvidence.textContent = sites.length ? "Generating-plant locations: U.S. EIA inventory, September 2026. Supply relationships: linked utility records; their update dates are not recorded here. This is a supply portfolio, not a live generation reading." : "";
      if (sites.length) part.append(portfolioEvidence);
    };
    const areas = data.power.filter(area => within(lon,lat,area.geometry));
    const years = [...new Set(areas.map(area => area.sourceYear).filter(year => Number.isInteger(year) && year > 1900 && year < 2100))].sort();
    row.setEvidence({sourceName:"Regional electric territory map",url:data.sources.power,checked:data.checked,
      sourceDate:areas.length && areas.every(area => Number.isInteger(area.sourceYear)) && years.length ? "Source record year" + (years.length > 1 ? "s: " : ": ") + years.join(", ") : "Territory source date unavailable"});
    function choices(ids,name,coverage) {
      const portfolios = {"3405":"imea","17828":"cwlp","16092":"imea"};
      const options = [...new Set(ids)].map(id => [id,electricNames[id] || areas.find(a => a.id === id)?.name || id]);
      options.push(["other","Another supplier or unsure"]);
      const status = text("p","");
      status.setAttribute("role","status");
      billChoice(part,"Electric delivery company on your bill",options,id => {
        setPortfolio(portfolios[id]);
        const selected = id && id !== "other";
        row.describe(selected ? options.find(([key]) => key === id)[1] : name,selected ? "Selected from bill" : coverage);
        status.textContent = id && !portfolios[id] ? "We haven’t verified generating plants for this selection." : "";
      });
      part.append(status);
    }

    if (within(lon,lat,data.plan.interior)) {
      row.setEvidence({sourceName:"Village electric map",url:data.sources.plan,checked:data.checked,
        sourceDate:"2041 plan is the planning horizon; map update date unavailable"});
      row.describe("Village of Chatham · IMEA power","Mapped service area");
      part.append(text("p","The village’s published map places this point inside its distribution area. Confirm the meter’s provider on your bill. The village buys power from the Illinois Municipal Electric Agency (IMEA). Its power mix includes coal, wind, solar and hydropower."),
        source("IMEA’s power sources",imea), document.createTextNode(" · "), office());
      setPortfolio("imea");
      return;
    }
    setPortfolio();
    if (within(lon,lat,data.plan.vicinity)) {
      row.setEvidence({sourceName:"Village electric map",url:data.sources.plan,checked:data.checked,
        sourceDate:"2041 plan is the planning horizon; map update date unavailable"});
      const name = "Near Chatham’s electric boundary";
      row.describe(name,"Provider uncertain");
      part.append(text("p","The published map is too approximate to tell which side serves this property. Your electric bill names the company that delivers power to the meter."),office());
      choices(["3405",...areas.map(area => area.id)],name,"Provider uncertain");
    } else if (areas.length > 1) {
      const name = "Overlapping electric territories";
      row.describe(name,"Confirm on bill");
      part.append(text("p","Published electric territories overlap here. Check the delivery company on the electric bill for this address."));
      choices(areas.map(area => area.id),name,"Confirm on bill");
    } else if (areas.length === 1) {
      const {id,name} = areas[0];
      const provider = electricNames[id] || name;
      row.describe(provider,"Mapped service area");
      part.append(text("p","The regional service map lists this delivery company at the parcel point. Confirm the meter’s provider on your bill."));
      if (id === "16420") part.append(text("p","RECC says it buys wholesale electricity through NextEra Energy Marketing."),
        source("RECC’s power supply","https://www.recc.coop/news-info/sangamon-county-data-center-your-questions-answered/"));
      if (id === "56697") part.append(text("p","For Ameren customers, the bill lists the retail electricity supplier separately from delivery."),
        source("Illinois electricity supply choices","https://plugin.illinois.gov/your-available-choices.html"));
      if (id === "17828") setPortfolio("cwlp");
      if (id === "16092") {
        part.append(text("p","Riverton buys electricity from the Illinois Municipal Electric Agency (IMEA)."),
          source("IMEA’s member sales (PDF)","https://www.imea.org/Documents/IMEA%20Annual%20Reports/2025AnnualReport.pdf"));
        setPortfolio("imea");
      }
      if (id === "3405") choices([id],provider,"Mapped service area");
    } else {
      row.describe("Electric provider unknown","No mapped territory");
      part.append(text("p","The regional electric map has no match for this location. Check the delivery company on the electric bill."));
    }
  }

  function serviceRecords(row, label, note, links) {
    const info = document.createElement("details");
    const records = document.createElement("p");
    links.forEach(([label,url],i) => {
      if (i) records.append(" · ");
      records.append(source(label,url));
    });
    info.append(text("summary",label),text("p",note),records);
    row.records.append(info);
  }

  let request;
  function loadAreas() {
    if (!request) request = fetch("./data/sangamon-utility-areas.json").then(async response => {
      if (!response.ok) throw new Error("Utility map unavailable");
      return response.json();
    }).catch(error => { request = null; throw error; });
    return request;
  }

  window.showPropertyUtilities = async function(container, {pin,lon,lat}={}) {
    const panel = document.createElement("section");
    panel.className = "property-utilities";
    panel.tabIndex = -1;
    panel.setAttribute("aria-label","Utilities");
    panel.append(text("h3","Utilities"));
    container.replaceChildren(panel);
    const coords = {pin,lon,lat};
    const group = "property-utilities-" + ++groupNumber;
    const water = utilityRow(panel,group,"water","Drinking water",coords);
    const power = utilityRow(panel,group,"power","Electricity",coords);
    const gas = utilityRow(panel,group,"gas","Natural gas",coords);

    if (window.showPropertyGas) {
      window.showPropertyGas(gas.details,coords,within,(match,coverage,evidence) => {
        if (panel.parentNode !== container) return;
        gas.describe(match?.provider || "Gas provider unknown",coverage);
        gas.setEvidence(evidence);
        gas.setMap({gas:match});
      });
    } else {
      gas.describe("Gas provider unknown","Records unavailable");
      gas.setEvidence();
      gas.details.append(text("p","Check the delivery company on a gas bill for this address."));
      gas.setMap({});
    }

    async function matchService() {
      for (const row of [water,power]) {
        row.describe("Checking service records…","");
        row.records.replaceChildren();
        row.details.replaceChildren(text("p","Checking service records…"));
      }
      let data;
      try {
        data = await loadAreas();
      } catch {
        if (panel.parentNode !== container) return;
        for (const row of [water,power]) {
          row.describe("Provider unknown","Service map unavailable");
          row.setEvidence();
          const retry = text("button","Retry service lookup");
          retry.type = "button";
          retry.addEventListener("click",matchService);
          row.details.replaceChildren(text("p","The published service areas could not load."),retry);
          row.setMap({sites:[]});
        }
        water.records.append(source("Sangamon County water systems",countySystems));
        return;
      }
      if (panel.parentNode !== container) return;
      water.details.replaceChildren();
      power.details.replaceChildren();
      const [west,south,east,north] = data.bounds;
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < west || lat < south || lon > east || lat > north || !within(lon,lat,data.county)) {
        for (const row of [water,power]) {
          row.describe("Provider unknown",Number.isFinite(lon) && Number.isFinite(lat) ? "Outside lookup area" : "Location unavailable");
          row.setEvidence();
          row.details.append(text("p","A mapped parcel location in Sangamon County is needed to match service. Your utility bill can identify the supplier."));
          row.setMap({sites:[]});
        }
        water.records.append(source("Sangamon County water systems",countySystems));
        return;
      }
      showWater(water,data.water.filter(area => within(lon,lat,area.geometry)),data);
      showPower(power,data,lon,lat);
      serviceRecords(water,"Water service-area records","The lookup compares a point on the property with published water service areas. A parcel can cross a boundary. The provider or a utility bill can confirm service at the meter.",[["EPA water service areas",epaMap]]);
      serviceRecords(power,"Electric service-area records","The Chatham electric outline was traced from Figure 4.3 of the village’s 2041 Comprehensive Plan. Locations within about 300 feet of the traced edge are uncertain. The regional map uses older utility records. Boundaries can change and a parcel can cross a boundary.",
        [["Village electric map, page 38",data.sources.plan],["Regional electric territories",data.sources.power]]);
    }
    await matchService();
  };
})();
