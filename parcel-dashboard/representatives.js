(() => {
  "use strict";
  const version = "20261114-civic-v1";
  const officialLocator = "https://www.elections.il.gov/ElectionOperations/ElectedOfficials.aspx";
  const normalize = value => String(value || "").trim().toUpperCase().replace(/\s+/g," ");
  const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
  const unique = values => [...new Set(values.filter(value => value !== null && value !== undefined && value !== "").map(String))];
  const one = value => { const values = unique(Array.isArray(value) ? value : [value]); return values.length === 1 ? values[0] : null; };
  let dataRequest;
  const results = new Map();
  const create = (tag,text,className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function link(label,url) {
    const item = create("a",label);
    try { if (new URL(url).protocol !== "https:") return create("span",label); } catch { return create("span",label); }
    item.href = url; item.referrerPolicy = "no-referrer";
    return item;
  }
  async function read(url,signal) {
    const response = await fetch(url,{signal});
    if (!response.ok) throw new Error("Record unavailable");
    const value = await response.json();
    if (value.error || value.exceededTransferLimit) throw new Error("Incomplete county result");
    return value;
  }
  async function districts(data,point) {
    if (!validPoint(point)) return {};
    const key = point.join(",");
    if (results.has(key)) return results.get(key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),12000);
    const request = Promise.all(Object.entries(data.gis.endpoints || data.gis).map(async ([kind,endpoint]) => {
      try {
        const url = new URL(endpoint.url.replace(/\/$/,"") + "/query");
        url.search = new URLSearchParams({f:"json",where:"1=1",geometry:JSON.stringify({x:point[0],y:point[1],spatialReference:{wkid:4326}}),geometryType:"esriGeometryPoint",inSR:"4326",spatialRel:"esriSpatialRelIntersects",outFields:Array.isArray(endpoint.fields) ? endpoint.fields.join(",") : endpoint.fields,returnGeometry:"false"});
        const response = await read(url.href,controller.signal);
        if (!Array.isArray(response.features)) throw new Error("Missing features");
        return [kind,{ok:true,records:response.features.map(feature => feature.attributes)}];
      } catch { return [kind,{ok:false,records:[]}]; }
    })).then(entries => {
      const value = Object.fromEntries(entries);
      if (entries.some(([,result]) => !result.ok)) results.delete(key);
      return value;
    }).finally(() => clearTimeout(timer));
    results.set(key,request);
    return request;
  }
  function resolved(match,field) {
    return match?.ok ? one(match.records.map(row => row[field])) : null;
  }
  function officials(container,records) {
    for (const official of records || []) {
      const item = create("div",undefined,"representative-person");
      item.append(create("strong",official.name),create("span",(official.office || "") + (official.district ? " · District " + official.district : "")));
      const links = create("div",undefined,"rank-links");
      if (official.contact_url || official.source_url) links.append(link("Official profile / contact",official.contact_url || official.source_url));
      if (official.votes_url) links.append(link("Meeting / voting records",official.votes_url));
      item.append(links); container.append(item);
    }
  }
  function card(parent,title,description) {
    const section = create("details",undefined,"representative-card");
    section.append(create("summary",title),create("p",description));
    parent.append(section); return section;
  }
  function unresolved(section,text,url=officialLocator) {
    section.append(create("p",text),link("Check the official directory",url));
  }
  async function selectedVotes(container) {
    const details = create("details",undefined,"representative-votes");
    details.append(create("summary","Selected Chatham votes we’ve reviewed"));
    const content = create("div"); details.append(content); container.append(details);
    let loaded = false;
    details.addEventListener("toggle",async () => {
      if (!details.open || loaded) return;
      loaded = true; content.textContent = "Loading reviewed decisions…";
      try {
        const data = await read("./data/chatham-reviewed-votes.json?v=" + version);
        if (!details.isConnected) return;
        content.replaceChildren(create("p",data.scope));
        for (const vote of data.records) {
          const record = create("article",undefined,"representative-vote");
          record.append(create("h5",vote.date + " · " + vote.item));
          record.append(create("p",vote.board_tally));
          const values = create("dl");
          for (const [name,result] of Object.entries(vote.votes)) values.append(create("dt",name),create("dd",result));
          record.append(values,create("p",vote.note),link("Read the official vote record",vote.source_url));
          content.append(record);
        }
      } catch { loaded = false; content.textContent = "Reviewed decisions could not load. Use the official meeting records above or reopen this section to retry."; }
    });
  }
  function render(container,data,matches,point) {
    const sources = Object.fromEntries(data.sources.map(source => [source.id,source.url]));
    container.replaceChildren(create("p","Local to federal: this order shows levels of government, not a rating of politicians. These records do not affect the land score."));
    container.append(create("p",validPoint(point) ? "Districts are matched to this parcel’s map point. A lot can cross a boundary; confirm the resident’s voting address with the election office. Multiple matches are left unresolved." : "This parcel has no usable map point, so its districts cannot be assigned here."));
    const municipal = resolved(matches.municipal,"Corp_Name");
    const village = card(container,"1. City or village" + (municipal ? " · " + municipal : " · Check assignment"),"Local services, utility rates, streets, zoning and municipal spending.");
    const local = data.local.municipalities[normalize(municipal)];
    if (local) {
      village.append(create("p",local.name || municipal)); officials(village,local.officials);
      if (local.meetings_url) village.append(link("Board agendas and recorded votes",local.meetings_url));
      if (normalize(municipal) === "CHATHAM") selectedVotes(village);
    } else unresolved(village,municipal ? "Map match: " + municipal + ". Its officials have not been added to this directory." : matches.municipal?.ok && matches.municipal.records.length === 0 ? "No municipal boundary matched this point. That can indicate an unincorporated location; confirm with the county." : "Municipal assignment could not be resolved.",sources.local);
    const schoolName = resolved(matches.school,"SchoolDistrict");
    const school = card(container,"2. School board" + (schoolName ? " · " + schoolName : " · Check assignment"),"School budgets, staffing policy, facilities and district decisions. School boundaries differ from village boundaries.");
    const district = data.local.schools[normalize(schoolName)];
    if (district) { school.append(create("p",district.name || schoolName)); if (district.note) school.append(create("p",district.note,"score-source-note")); officials(school,district.officials); if (district.meetings_url) school.append(link("School board meeting records",district.meetings_url)); }
    else unresolved(school,schoolName ? "Map match: " + schoolName + ". Consult the official school-board roster for current members." : "School district assignment could not be resolved.",sources.schools);
    const boardNumber = resolved(matches.county_board,"DISTRICT");
    const county = card(container,"3. County board" + (boardNumber ? " · District " + boardNumber : " · Check assignment"),"County budgets, the jail, public health and county land-use decisions.");
    const countyOfficial = data.county_board[boardNumber];
    if (countyOfficial) { county.append(create("p","Sangamon County Board District " + boardNumber)); officials(county,[countyOfficial]); }
    else unresolved(county,"County board district could not be resolved.",sources.county);
    const precinct = resolved(matches.precinct,"Precinct");
    const legislative = data.precinct_districts[normalize(precinct)];
    const state = card(container,"4. Illinois legislature","State laws, appropriations and state taxes.");
    for (const chamber of ["house","senate"]) {
      const id = one(legislative?.[chamber]);
      const official = id && data.state[chamber][id];
      if (official) officials(state,[official]);
      else unresolved(state,"Illinois " + (chamber === "house" ? "House" : "Senate") + " district is unresolved" + (precinct ? " for precinct " + precinct : "") + ". Some precincts are split between legislative districts.");
    }
    const federal = card(container,"5. U.S. Congress","Federal laws, spending and oversight.");
    const congress = one(legislative?.congress);
    const member = congress && data.federal.house[congress];
    if (member) officials(federal,[member]); else unresolved(federal,"U.S. House district could not be resolved from the precinct match.");
    // This dashboard's district services cover Sangamon County, Illinois only.
    if (boardNumber) officials(federal,data.federal.senators);
    container.append(create("p","Roster sources checked " + data.checked_at.slice(0,10) + " (UTC). Legislative districts use the county's precinct chart dated " + data.precinct_chart_date + ". An election win does not itself start a new term. Township, fire, library and other special-district officials are not yet mapped here.","score-source-note"));
    container.append(link("Verify your elected officials",officialLocator));
  }
  window.showPropertyRepresentatives = function(target,{position}) {
    const details = create("details",undefined,"parcel-representatives");
    details.append(create("summary","Who represents this property?"));
    const body = create("div",undefined,"representative-content"); details.append(body); target.append(details);
    let loading = false, loaded = false;
    details.addEventListener("toggle",async () => {
      if (!details.open || loading || loaded) return;
      loading = true; body.textContent = "Checking public district records…";
      try {
        if (!dataRequest) dataRequest = read("./data/representatives.json?v=" + version).catch(error => {dataRequest=null;throw error;});
        const data = await dataRequest;
        const matches = await districts(data,position);
        if (!details.isConnected) return;
        render(body,data,matches,position);
        loaded = !validPoint(position) || Object.values(matches).every(value => value.ok);
        if (!loaded) body.append(create("p","Some county layers could not load. Close and reopen this section to retry.","score-source-note"));
      } catch { body.replaceChildren(create("p","District records could not load. Close and reopen to retry, or use the official lookup."),link("Find your elected officials",officialLocator)); }
      finally { loading = false; }
    });
  };
  window.ParcelRepresentatives = {normalize,validPoint,one,resolved};
})();
