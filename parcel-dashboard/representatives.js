(() => {
  "use strict";
  const version = "20261115-cyrusone-comments";
  const officialLocator = "https://www.elections.il.gov/ElectionOperations/ElectedOfficials.aspx";
  const normalize = value => String(value || "").trim().toUpperCase().replace(/\s+/g," ");
  const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
  const unique = values => [...new Set(values.filter(value => value !== null && value !== undefined && value !== "").map(String))];
  const one = value => { const values = unique(Array.isArray(value) ? value : [value]); return values.length === 1 ? values[0] : null; };
  let dataRequest, countyVoteRequest;
  const voteLabels = {yes:"Yes",no:"No",abstain:"Abstained",not_voting:"Did not vote"};
  const sameName = (a,b) => normalize(a).replace(/[.,"'’]/g,"") === normalize(b).replace(/[.,"'’]/g,"");
  function validCountyVote(value) {
    if (value?.vote_date !== "2026-04-07" || !value.records || !value.tally || !value.source?.url?.startsWith("https://sangamondepartments.blob.core.windows.net/") ||
      !Array.isArray(value.source.pages) || !value.source.pages.length || !value.source.pages.every(page => Number.isInteger(page) && page > 0)) return null;
    const counts = {yes:0,no:0,abstain:0,not_voting:0};
    const identities = new Map();
    if (Object.keys(value.records).length !== 29) return null;
    for (let district = 1; district <= 29; district++) {
      const record = value.records[String(district)];
      if (typeof record?.member_at_vote !== "string" || !record.member_at_vote.trim() || !Object.hasOwn(counts,record.vote) || !Array.isArray(record.identity_aliases) ||
        !record.identity_aliases.every(name => typeof name === "string" && name.trim())) return null;
      for (const name of [record.member_at_vote,...record.identity_aliases]) {
        const key = normalize(name).replace(/[.,"'’]/g,"");
        if (identities.has(key) && identities.get(key) !== district) return null;
        identities.set(key,district);
      }
      counts[record.vote]++;
    }
    if (!Object.entries(counts).every(([key,count]) => value.tally[key] === count) || counts.yes !== 17 || counts.no !== 10 || counts.abstain !== 1 || counts.not_voting !== 1) return null;
    return value;
  }
  function countyVoteContext(value,district,official) {
    const ledger = validCountyVote(value);
    if (!ledger) return {status:"unavailable"};
    const record = ledger.records[String(district)];
    if (!record) return {status:"unresolved"};
    const matches = official?.name && [record.member_at_vote,...record.identity_aliases].some(name => sameName(name,official.name));
    return {status:matches ? "current" : official?.name ? "previous" : "historical",record,label:voteLabels[record.vote]};
  }
  function countyCommentary(ledger,record) {
    const review = ledger?.comment_review;
    const commentary = record?.commentary;
    if (!review || !Array.isArray(review.meeting_dates) || review.meeting_dates.join(",") !== "2026-03-23,2026-04-07" || !commentary ||
      commentary.member_at_vote !== record.member_at_vote || !Array.isArray(commentary.entries)) return {status:"unavailable"};
    const sources = ledger.comment_sources;
    for (const date of review.meeting_dates) {
      const source = sources?.[date];
      if (!source || typeof source.url !== "string" || !source.url.startsWith("https://sangamondepartments.blob.core.windows.net/dnnfiles/Clerk/County-Board/Minutes/") ||
        source.date !== date || !Number.isInteger(source.page_count) || source.page_count < 1 || !source.label) return {status:"unavailable"};
    }
    const entries = commentary.entries;
    if (!entries.every(entry => entry && typeof entry === "object")) return {status:"unavailable"};
    if (new Set(entries.map(entry => entry.date)).size !== entries.length) return {status:"unavailable"};
    for (const entry of entries) {
      const source = sources[entry.date];
      if (!review.meeting_dates.includes(entry.date) || !source || typeof entry.summary !== "string" || !entry.summary.trim() ||
        !["substantive_comment","questions_or_procedure_only"].includes(entry.kind) || typeof entry.explicit_vote_reason !== "boolean" ||
        (entry.explicit_vote_reason && (entry.kind !== "substantive_comment" || entry.date !== ledger.vote_date)) ||
        !Array.isArray(entry.pages) || !entry.pages.length || !entry.pages.every(page => Number.isInteger(page) && page > 0 && page <= source.page_count)) return {status:"unavailable"};
    }
    return {status:entries.length ? "recorded" : "not_recorded",entries:[...entries].sort((a,b) => b.date.localeCompare(a.date)),sources};
  }
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
  function showCountyVote(container,ledger,district,official) {
    const context = countyVoteContext(ledger,district,official);
    const section = create("section",undefined,"county-project-vote");
    section.append(create("h4","CyrusOne zoning vote"));
    if (context.status === "unavailable") {
      section.append(create("p","The recorded vote could not load. Close and reopen “Who represents this property?” to retry; an unavailable record is not a No vote."),link("County meeting minutes","https://sangamonil.gov/departments/a-c/county-clerk/vital-records/county-board/written-minutes"));
      container.append(section); return;
    }
    if (context.status === "current") {
      section.append(create("strong",context.record.member_at_vote + " — " + context.label,"county-vote-result"));
    } else if (context.status === "previous" || context.status === "historical") {
      section.append(create("strong",context.status === "previous" ? "Vote by the previous representative" : "Recorded vote for this district","county-vote-result"));
      section.append(create("p",context.record.member_at_vote + " represented District " + district + " at this vote: " + context.label + "."));
      section.append(create("p",official?.name ? "The current directory lists " + official.name + ". This recorded vote belongs to " + context.record.member_at_vote + "; it does not establish " + official.name + "’s position." : "The current officeholder could not be verified. This is the member recorded at the meeting."));
    } else section.append(create("p","Your county district is unresolved, so no member’s vote has been assigned to this property. The complete roll call is below."));
    section.append(create("p","April 7, 2026 · " + ledger.title));
    section.append(create("p","Approved: 17 Yes, 10 No and 1 abstention. The chair did not vote. This was the final zoning decision; it was not a building permit or a vote on a motion to delay."));
    if (context.record?.vote === "not_voting") section.append(create("p","The chair is listed present, but no vote is recorded for him on the final zoning roll call. “Did not vote” is not an abstention or an absence."));
    const source = ledger.source.url.split("#")[0] + "#page=" + ledger.source.pages[0];
    section.append(link("Official minutes · page " + ledger.source.pages.join(", "),source));
    if (context.record) showMemberComments(section,ledger,context.record);
    const all = create("details",undefined,"county-vote-rollcall");
    all.append(create("summary","See all 29 votes and comments"),create("p","Members listed below held these seats at the April 7 meeting. Later officeholders are not assigned their votes or comments."));
    const list = create("ol");
    for (let number = 1; number <= 29; number++) {
      const record = ledger.records[String(number)];
      const item = create("li",undefined,String(number) === String(district) ? "selected-vote-district" : "");
      item.append(create("strong","District " + number + " · " + record.member_at_vote),create("span",voteLabels[record.vote]));
      showMemberComments(item,ledger,record);
      list.append(item);
    }
    all.append(list);
    if (ledger.district_source?.url) all.append(link("Districts and members at the time · NPR Illinois",ledger.district_source.url));
    section.append(all); container.append(section);
    if (context.record) {
      const preview = context.status === "current" ? "CyrusOne: " + context.label + " · April 7, 2026" : context.status === "previous" ? "CyrusOne: previous member’s vote" : "CyrusOne: recorded district vote";
      container.querySelector("summary").append(create("span",preview,"county-vote-preview"));
    }
  }
  function showMemberComments(container,ledger,record) {
    const result = countyCommentary(ledger,record);
    const details = create("details",undefined,"county-member-comments");
    details.append(create("summary","What " + record.member_at_vote + " said"));
    if (result.status === "unavailable") {
      details.append(create("p","The comments review is unavailable. Use the official meeting minutes; this does not mean no comments were made."),link("Official meeting minutes",ledger.source.url));
      container.append(details); return;
    }
    details.append(create("p","Summarized from the March 23 and April 7, 2026 minutes. Project claims are the speakers’ views.","county-comment-scope"));
    if (result.status === "not_recorded") {
      details.append(create("p","No explanation of this member’s CyrusOne vote was found in those minutes. A recorded vote alone does not tell us their reasons."));
      for (const date of ledger.comment_review.meeting_dates) details.append(link("Review " + result.sources[date].label + " minutes",result.sources[date].url));
    }
    for (const entry of result.entries) {
      const source = result.sources[entry.date];
      const article = create("article",undefined,"county-comment-entry");
      const type = entry.explicit_vote_reason ? "Stated reasons" : entry.kind === "questions_or_procedure_only" ? "Questions / procedure" : "Recorded comments";
      article.append(create("strong",source.label + " · " + type),create("p",entry.summary));
      if (!entry.explicit_vote_reason) article.append(create("p","These remarks do not explicitly explain the April 7 final vote.","county-comment-scope"));
      article.append(link("Read " + source.label + " minutes · " + (entry.pages.length === 1 ? "page " : "pages ") + entry.pages.join(", "),source.url.split("#")[0] + "#page=" + entry.pages[0]));
      details.append(article);
    }
    container.append(details);
  }
  function render(container,data,matches,point,countyVote) {
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
    showCountyVote(county,countyVote,boardNumber,countyOfficial);
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
        if (!countyVoteRequest) countyVoteRequest = read("./data/cyrusone-county-vote.json?v=" + version).then(value => {
          if (!validCountyVote(value)) throw new Error("Vote record did not validate");
          return value;
        }).catch(() => { countyVoteRequest=null; return null; });
        const [data,countyVote] = await Promise.all([dataRequest,countyVoteRequest]);
        const matches = await districts(data,position);
        if (!details.isConnected) return;
        render(body,data,matches,position,countyVote);
        const districtsLoaded = !validPoint(position) || Object.values(matches).every(value => value.ok);
        loaded = districtsLoaded && Boolean(countyVote);
        if (!districtsLoaded) body.append(create("p","Some county layers could not load. Close and reopen this section to retry.","score-source-note"));
      } catch { body.replaceChildren(create("p","District records could not load. Close and reopen to retry, or use the official lookup."),link("Find your elected officials",officialLocator)); }
      finally { loading = false; }
    });
  };
  window.ParcelRepresentatives = {normalize,validPoint,one,resolved,validCountyVote,countyVoteContext,countyCommentary};
})();
