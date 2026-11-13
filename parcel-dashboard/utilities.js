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
  function utilityCard(panel, label, name) {
    const part = document.createElement("section");
    part.append(text("h4",label),text("strong",name));
    panel.append(part);
    return part;
  }
  function billChoice(card, label, options, onChange) {
    const field = document.createElement("label");
    field.className = "utility-bill-choice";
    const select = document.createElement("select");
    select.append(new Option("Choose a supplier",""));
    for (const [value,name] of options) select.append(new Option(name,value));
    const view = text("button","Show on the source map");
    view.type = "button";
    view.hidden = true;
    view.onclick = () => {
      const map = card.closest(".property-utilities").querySelector(".property-source-location");
      map.focus({preventScroll:true});
      map.scrollIntoView({block:"start"});
    };
    select.addEventListener("change",() => { view.hidden = !onChange(select.value); });
    field.append(text("span",label),select);
    card.append(field,view);
  }
  function showWater(panel, areas, onChoice) {
    if (areas.length !== 1) {
      const part = utilityCard(panel,"Drinking water",areas.length ? "More than one mapped water system" : "Water system unconfirmed");
      part.append(text("p",areas.length ? "EPA’s service areas overlap here. Check the water supplier on the bill for this address." :
        "EPA’s map has no community water system at this point. A smaller system or a private well may supply the property."),
        source("Look up a Sangamon County water system",countySystems));
      if (areas.length) {
        const report = document.createElement("div");
        billChoice(part,"Water supplier on your bill",areas.map(area => [area.id,waterSources[area.id]?.name || area.name]),id => {
          report.replaceChildren();
          if (id) waterDetails(report,id);
          onChoice(id);
          return Boolean(window.propertyWaterSites?.(id).length);
        });
        part.append(report);
      }
      return;
    }
    const [area] = areas;
    const details = waterSources[area.id];
    const part = utilityCard(panel,"Drinking water",details?.name || area.name);
    part.append(text("p",area.boundary === "Modeled" ? "EPA estimates this system’s service area includes this location. Check the name on your water bill to confirm." :
      (area.boundary === "System Sourced" ? "The water system’s published service area includes this location." : "EPA’s published service area includes this location.")));
    waterDetails(part,area.id);
    return area.id;
  }
  function waterDetails(part,id) {
    const details = waterSources[id];
    if (details) {
      part.append(text("p",details.supply));
      if (!window.addWaterReport?.(part,id)) part.append(source(details.label || "Look up the water system",details.url || countySystems));
    } else {
      const lookup = new URL(countySystems);
      lookup.searchParams.set("county","");
      lookup.searchParams.set("number",id);
      part.append(text("p","We haven’t summarized this system’s annual water report yet."),
        source("Find this system’s testing records at Illinois EPA",lookup.href));
    }
  }
  function showPower(panel, data, lon, lat, onChoice) {
    const office = () => source("Contact the village utility office",villageOffice);
    if (within(lon,lat,data.plan.interior)) {
      const part = utilityCard(panel,"Electricity","Village of Chatham distribution area");
      part.append(text("p","The village’s published map places this point inside its distribution area. The village buys its power from the Illinois Municipal Electric Agency (IMEA). Its power mix includes coal, wind, solar and hydropower."),
        source("IMEA’s power sources",imea), document.createTextNode(" · "), office());
      return "imea";
    }
    if (within(lon,lat,data.plan.vicinity)) {
      const part = utilityCard(panel,"Electricity","Near the village’s electric service boundary");
      part.append(text("p","The published map is too approximate to tell which side serves this property. Your electric bill names the company that delivers power to the meter."),office());
      const ids = new Set(["3405",...data.power.filter(a => within(lon,lat,a.geometry)).map(a => a.id)]);
      powerBillChoice(part,ids,onChoice);
      return;
    }
    const areas = data.power.filter(area => within(lon,lat,area.geometry));
    const names = areas.map(a => electricNames[a.id] || a.name);
    const part = utilityCard(panel,"Electricity",areas.length === 1 ? names[0] + " mapped area" : "Electric provider unconfirmed");
    if (areas.length > 1) {
      part.append(text("p","Published electric territories overlap here. Check the delivery company on the electric bill for this address."));
      const candidates = document.createElement("details");
      candidates.append(text("summary","Which utilities appear on the regional map?"),text("p",names.join(" · ")));
      part.append(candidates);
      powerBillChoice(part,areas.map(area => area.id),onChoice);
    } else if (areas.length === 1) {
      const {id} = areas[0];
      part.append(text("p","The regional service map lists this delivery company at the parcel point. Confirm the meter’s provider on your bill."));
      if (id === "16420") part.append(text("p","RECC says it buys wholesale electricity through NextEra Energy Marketing."),
        source("RECC’s power supply", "https://www.recc.coop/news-info/sangamon-county-data-center-your-questions-answered/"));
      if (id === "56697") part.append(text("p","For Ameren customers, the bill lists the retail electricity supplier separately from delivery."),
        source("Illinois electricity supply choices","https://plugin.illinois.gov/your-available-choices.html"));
      if (id === "17828") return "cwlp";
      if (id === "16092") {
        part.append(text("p","Riverton buys electricity from the Illinois Municipal Electric Agency (IMEA)."),
          source("IMEA’s member sales (PDF)","https://www.imea.org/Documents/IMEA%20Annual%20Reports/2025AnnualReport.pdf"));
        return "imea";
      }
      if (id === "3405") powerBillChoice(part,[id],onChoice);
    } else part.append(text("p","The regional electric map has no match for this location. Check the delivery company on the electric bill."));
  }
  function powerBillChoice(part,ids,onChoice) {
    const portfolios = {"3405":"imea","17828":"cwlp","16092":"imea"};
    if (![...ids].some(id => portfolios[id])) return;
    const options = [...ids].map(id => [id,electricNames[id]]);
    options.push(["other","Another supplier or unsure"]);
    const status = text("p","");
    status.setAttribute("role","status");
    billChoice(part,"To see power plants, select the electric utility on your bill",options,id => {
      const provider = portfolios[id];
      onChoice(provider);
      status.textContent = id && !provider ? "We haven’t verified generating plants for this selection." : "";
      return Boolean(provider);
    });
    part.append(status);
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
    panel.setAttribute("aria-label","Water, electricity and natural gas");
    panel.append(text("h3","Water, electricity and natural gas"));
    const status = text("p","Checking the service maps…");
    panel.append(status);
    container.replaceChildren(panel);
    const gas = document.createElement("div");
    gas.className = "gas-service";
    panel.append(gas);
    let gasMatch;
    let updateGasMap;
    if (window.showPropertyGas) {
      window.showPropertyGas(gas,{pin,lon,lat},within,match => {
        gasMatch = match;
        updateGasMap?.(match);
      });
    }
    try {
      const data = await loadAreas();
      if (panel.parentNode !== container) return;
      const [west,south,east,north] = data.bounds;
      status.remove();
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < west || lat < south || lon > east || lat > north || !within(lon,lat,data.county)) {
        gas.before(text("p","A mapped parcel location in Sangamon County is needed to match water and electric service. Your utility bill can identify your suppliers."),source("Sangamon County water systems",countySystems));
        return;
      }
      const mapPlace = document.createElement("div");
      mapPlace.className = "property-source-location";
      mapPlace.tabIndex = -1;
      panel.querySelector("h3").after(mapPlace);
      function drawSources(preferredKind) {
        const sites = [...(window.propertyWaterSites?.(waterSystem) || []), ...(window.propertyPowerSites?.(powerSystem) || [])];
        updateGasMap = window.showUtilitySourceMap?.(mapPlace,{pin,lon,lat,sites,preferredKind,gas:gasMatch});
      }
      let waterSystem = showWater(panel,data.water.filter(area => within(lon,lat,area.geometry)),id => {
        waterSystem = id;
        drawSources("water");
      });
      let powerSystem = showPower(panel,data,lon,lat,id => {
        powerSystem = id;
        drawSources("power");
      });
      panel.append(gas);
      drawSources();
      const info = document.createElement("details");
      const links = document.createElement("p");
      links.append(source("EPA water service areas",epaMap),document.createTextNode(" · "),
        source("Village electric map, page 38",data.sources.plan),document.createTextNode(" · "),
        source("Regional electric territories",data.sources.power));
      info.append(text("summary","How these service areas were matched"),
        text("p","The lookup compares a point on the property with published service areas. A utility bill or the provider can confirm a connection at the meter. A parcel can cross a boundary."),
        text("p","The village electric outline was traced from Figure 4.3 of the Chatham 2041 Comprehensive Plan. Points within about 300 feet of the traced edge are marked uncertain. The regional electric map uses older utility records; boundaries can change."),links);
      panel.append(info);
    } catch {
      if (panel.parentNode !== container) return;
      if (!status.isConnected) panel.append(status);
      status.textContent = "The water and electric maps could not load.";
      const retry = text("button","Try the utility maps again");
      retry.type = "button";
      retry.addEventListener("click",() => window.showPropertyUtilities(container,{pin,lon,lat}));
      panel.append(retry,source("Sangamon County water systems",countySystems));
    }
  };
})();
