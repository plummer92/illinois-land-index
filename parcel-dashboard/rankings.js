(() => {
  "use strict";
  const root = document.getElementById("parcel-rankings");
  const resultRoot = document.getElementById("property-result");
  if (!root && !resultRoot) return;
  const pageSize = 25;
  const countFormat = new Intl.NumberFormat("en-US");
  const acresFormat = new Intl.NumberFormat("en-US", {maximumFractionDigits: 3});
  const minOptions = ["45", "50", "60", "70", "80", "90", "all"];
  const sortOptions = {score: "Highest score first", acres: "Most acres first", pin: "Parcel number"};
  const parcelOrder = (a, b) => a[0].localeCompare(b[0]);
  const sortMethods = {
    score: (a, b) => b[7] - a[7] || parcelOrder(a, b),
    acres: (a, b) => b[3] - a[3] || b[7] - a[7] || parcelOrder(a, b),
    pin: parcelOrder
  };
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Loading scored properties…";
  root?.append(status);

  function create(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  const mapContainer = document.getElementById("chatham-map-content");
  const middle = value => value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  function link(text,href) {
    const a = create("a",text);
    a.href = href;
    a.referrerPolicy = "no-referrer";
    return a;
  }
  function parcelScoreUrl(pin) {
    const url = new URL("./",location.href);
    url.searchParams.set("scoreDetail",pin);
    url.hash = "property-result";
    return url.href;
  }
  function readJson(url) {
    return fetch(url).then(response => {
      if (!response.ok) throw new Error("Could not load " + url);
      return response.json();
    });
  }
  // This optional detail file is fetched the first time a countywide row needs it.
  let reasonRequest;
  async function showScoreReasons(list, notice, row, sourceDate, propertyClass, top) {
    notice.textContent = "Loading the point-by-point explanation…";
    if (!reasonRequest) {
      reasonRequest = readJson("./data/score-reasons.json").catch(() => {
        reasonRequest = null;
        return null;
      });
    }
    const source = await reasonRequest;
    if (!list.isConnected) return;
    const rule = window.ParcelScoreContext.validateReasons(source,row,sourceDate);
    if (!rule) {
      notice.textContent = source ? "The detailed explanation does not match this score snapshot. Only the recorded component totals are shown." :
        "The detailed explanation could not load. Only the recorded component totals are shown. Close and reopen this section to retry.";
      return;
    }
    const [landClass,size,assessment,tax,ownerClass,holdings,otherBuy,propertyRisk,otherRisk] = rule;
    const bound = (value, max) => Math.min(max,Math.max(0,value));
    if (bound(landClass + size + assessment + tax,40) !== row[4] ||
        bound(ownerClass + holdings + otherBuy,35) !== row[5] ||
        bound(25 + propertyRisk + otherRisk,25) !== row[6]) return;
    const points = value => value + (Math.abs(value) === 1 ? " point" : " points");
    const reason = (name, value, cap, explanation) => {
      const line = create("li");
      line.append(create("strong",name + " " + value + "/" + cap + ". "),explanation);
      return line;
    };
    const land = points(landClass) + " for property class, " + points(size) + " for acreage, " + points(assessment) +
      " for assessed value per acre and " + points(tax) + " for annual tax per acre." +
      (row[3] === 0 ? " The scoring file has no positive acreage for this PIN, so it awarded no acreage or per-acre points." :
        size === 20 ? " The parcel reached all four acreage thresholds through 10 acres." : "") +
      (landClass + size + assessment + tax > 40 ? " This component is capped at 40." : "");
    const buy = top ? points(ownerClass) + (top.points.buyability.trust_estate ? " for a trust or estate, " : " for an individual owner, ") +
      points(holdings) + " for at least two parcels totaling at least 100 acres, and " + points(otherBuy) + " from the mailing-address rules." :
      points(ownerClass) + " from the ownership category, " + points(holdings) + " from recorded holdings and " +
      points(otherBuy) + " from the combined address and tax-sale rules." +
      (ownerClass + holdings + otherBuy < 0 ? " This component has a floor of zero." :
        ownerClass + holdings + otherBuy > 35 ? " This component is capped at 35." : "");
    let risk = row[6] === 25 ? "The model applied no deductions to its 25 starting points." :
      "From 25 starting points, the model deducted " + points(-propertyRisk) + " for property class or missing acreage and " +
      points(-otherRisk) + " for the ownership and tax-sale rules." +
      (25 + propertyRisk + otherRisk < 0 ? " This component has a floor of zero." : "");
    const deductions = [];
    if (row[3] === 0) deductions.push([8,"missing acreage"]);
    if (propertyClass.includes("IMPROVED RESIDENTIAL")) deductions.push([12,"the residential class rule"]);
    if (/COMMERCIAL|INDUSTRIAL/.test(propertyClass)) deductions.push([14,"commercial or industrial classification"]);
    if (propertyClass.includes("TOTALLY EXEMPT")) deductions.push([12,"tax-exempt classification"]);
    if (deductions.length && deductions.reduce((sum,[value]) => sum + value,0) === -propertyRisk) {
      if (otherRisk) deductions.push([-otherRisk,"the combined ownership and tax-sale rules"]);
      risk = "The model started at 25 and deducted " + deductions.map(([value,label]) => points(value) + " for " + label).join(" and ") + "." +
        (25 + propertyRisk + otherRisk < 0 ? " This component has a floor of zero." : "");
    }
    risk += " These are record-based deductions, not a physical-risk inspection. Full points do not establish that the property is safe from flooding or other hazards.";
    list.replaceChildren(reason("Land fit",row[4],40,land),reason("Ownership and purchase indicators",row[5],35,buy),reason("Points remaining after model deductions",row[6],25,risk));
    notice.textContent = "The explanation matches the recorded score. Zero assessment or tax points do not tell us whether the underlying value was missing or outside the model’s thresholds.";
  }
  function buildRankings(data, snapshot) {
    const sourceDate = new Date(data.source_date + "T12:00:00Z").toLocaleDateString("en-US", {month:"long", day:"numeric", year:"numeric", timeZone:"UTC"});
    const topParcels = new Map((snapshot?.sourceDate === data.source_date ? snapshot.parcels : []).map(parcel => [parcel.pin,parcel]));
    const form = create("form", undefined, "rank-controls");
    form.addEventListener("submit", e => e.preventDefault());
    function field(id, labelText, tag) {
      const label = create("label", labelText);
      const control = create(tag);
      control.id = "rank-" + id;
      label.append(control);
      form.append(label);
      return control;
    }
    const pinSearch = field("pin", "Parcel number", "input");
    pinSearch.type = "search";
    pinSearch.placeholder = "Full or partial PIN";
    pinSearch.autocomplete = "off";
    pinSearch.maxLength = 28;
    const township = field("town", "Township", "select");
    township.add(new Option("All townships", ""));
    [...data.townships].filter(Boolean).sort().forEach(name => township.add(new Option(middle(name),name)));
    const propertyClass = field("class", "Property class", "select");
    propertyClass.add(new Option("All classes",""));
    [...data.classes].filter(Boolean).sort().forEach(name => propertyClass.add(new Option(middle(name),name)));
    const acresMin = field("acres", "Minimum acres", "input");
    acresMin.type = "number"; acresMin.min = "0"; acresMin.step = "any"; acresMin.placeholder = "Any";
    const threshold = field("min", "Minimum score", "select");
    minOptions.forEach(v => threshold.add(new Option(v === "all" ? "All scores" : v + " and up",v)));
    const sort = field("sort", "Sort by", "select");
    Object.entries(sortOptions).forEach(([value,label]) => sort.add(new Option(label,value)));
    const realistic = field("realistic","Model’s target group only","input");
    realistic.type = "checkbox"; realistic.defaultChecked = true;
    realistic.parentElement.className = "rank-check";
    realistic.parentElement.prepend(realistic);

    const header = create("div", undefined, "rank-summary");
    header.append(status,create("p",countFormat.format(data.rows.length) + " scored parcels across " + data.townships.length + " Sangamon County townships · County file dated " + sourceDate,"rank-vintage"));
    const method = create("details",undefined,"rank-method");
    method.append(create("summary","What this research score measures"),
      create("p","This is a land-research priority, not a home rating, percentage or market valuation. The model favors farms and larger lots. A higher number moves a parcel up this research list; it does not establish availability for sale or an owner’s willingness to sell."),
      create("p","Land fit (up to 40 points) uses property class, acreage, assessed value and annual taxes per acre. Ownership and purchase indicators (up to 35) use ownership categories, recorded holdings, address rules and tax-sale flags. The last component starts at 25 and subtracts points under classification and record rules. More points remaining means fewer model deductions, not lower physical risk."),
      create("p","The target-group filter is a model selection, not verified sale availability. Show all properties to include parcels outside it. ‘Not recorded’ for acreage means no positive size was recorded, not a zero-size lot."),
      create("p","Known limits: the current residential classification rule deducts 12 points for both improved and unimproved residential land. Missing acreage also reduces the score. Zero tax or assessment points do not reveal whether inputs were missing, and missing tax-sale data can default to no flag. None of these is a finding about a home’s condition or its current taxes."),
      create("p","Floodplains, wetlands, drainage, soils, legal access, zoning, building condition, comparable sales and service to a utility meter have not been verified by this score."));
    const clear = create("button","Reset filters","rank-reset");
    clear.type = "button";
    const showAll = create("button","Show all " + countFormat.format(data.rows.length) + " properties","rank-reset");
    showAll.type = "button";
    const actions = create("div",undefined,"rank-links");
    actions.append(showAll,clear);
    const results = create("div",undefined,"rank-results");
    results.id = "rank-results";
    results.tabIndex = -1;
    const table = create("table",undefined,"rank-table");
    const caption = table.createCaption();
    caption.className = "rank-sr";
    caption.textContent = "Sangamon County scored properties";
    const head = table.createTHead().insertRow();
    ["Score", "Parcel and location", "Recorded acres"].forEach(label => {
      const th = create("th",label);
      th.scope = "col"; head.append(th);
    });
    const tbody = table.createTBody();
    const paging = create("div",undefined,"rank-pages");
    const prev = create("button","Previous");
    const next = create("button","Next");
    const indicator = create("span");
    prev.type = next.type = "button";
    paging.append(prev,indicator,next);
    results.append(table,paging);
    const filters = create("details",undefined,"rank-filter-panel");
    const filterSummary = create("summary","Filter and sort properties");
    filters.open = window.matchMedia("(min-width: 641px)").matches;
    filters.append(filterSummary,form,actions);
    root.replaceChildren(header,filters,method,results);

    let page = 1;
    let matches = [];
    let inputSequence = false;
    function readLocation() {
      const params = new URL(location.href).searchParams;
      pinSearch.value = (params.get("scorePin") || "").slice(0,pinSearch.maxLength);
      const t = params.get("scoreTown") || "";
      township.value = data.townships.includes(t) ? t : "";
      const c = params.get("scoreClass") || "";
      propertyClass.value = data.classes.includes(c) ? c : "";
      const acres = params.get("scoreAcres");
      acresMin.value = acres && Number.isFinite(Number(acres)) && Number(acres) >= 0 ? acres : "";
      realistic.checked = params.get("scoreTargets") !== "all";
      const m = params.get("scoreMin");
      threshold.value = minOptions.includes(m) ? m : "45";
      const s = params.get("scoreSort");
      sort.value = Object.hasOwn(sortMethods,s) ? s : "score";
      page = Math.max(1,Number(params.get("scorePage")) || 1);
      if (!Number.isSafeInteger(page)) page = 1;
    }
    function writeLocation(replace = false, anchor) {
      const url = new URL(location.href);
      const params = {scorePin: pinSearch.value.trim(), scoreTown: township.value, scoreClass:propertyClass.value,
        scoreAcres:acresMin.value, scoreTargets:realistic.checked ? "" : "all",
        scoreMin: threshold.value !== "45" ? threshold.value : "",
        scoreSort: sort.value !== "score" ? sort.value : "", scorePage: page > 1 ? page : ""};
      for (const [key,value] of Object.entries(params)) {
        if (value) url.searchParams.set(key,value);
        else url.searchParams.delete(key);
      }
      url.searchParams.delete("foundParcel");
      if (anchor) url.hash = anchor;
      if (url.href !== location.href) history[replace ? "replaceState" : "pushState"](history.state, "",url);
    }
    function filter() {
      const min = threshold.value === "all" ? 0 : Number(threshold.value);
      const query = pinSearch.value.replace(/[-\s]/g,"").toLowerCase();
      const townIndex = data.townships.indexOf(township.value);
      const classIndex = data.classes.indexOf(propertyClass.value);
      const padded = /^\d{10}$/.test(query) ? query.slice(0,4) + "0" + query.slice(4) : "";
      const exact = padded && data.rows.some(row => row[0] === padded) ? padded : "";
      matches = data.rows.filter(row => row[7] >= min && (!realistic.checked || row[8] === 1) &&
        (!township.value || row[1] === townIndex) && (!propertyClass.value || row[2] === classIndex) && row[3] >= Number(acresMin.value) &&
        (!query || (exact ? row[0] === exact : row[0].includes(query))));
      if (sort.value !== "score") matches.sort(sortMethods[sort.value]);
    }
    function render() {
      const pages = Math.max(1,Math.ceil(matches.length / pageSize));
      page = Math.min(page,pages);
      const offset = (page - 1) * pageSize;
      const shown = matches.slice(offset,offset + pageSize);
      tbody.replaceChildren();
      status.textContent = matches.length ? countFormat.format(matches.length) + " matching properties · Showing " +
        countFormat.format(offset + 1) + "–" + countFormat.format(offset + shown.length) : "No properties match these filters.";
      if (!matches.length) {
        const rawPin = pinSearch.value.replace(/[-\s]/g,"");
        const exactPin = rawPin.length === 10 ? rawPin.slice(0,4) + "0" + rawPin.slice(4) : rawPin;
        if (/^\d{11}$/.test(exactPin) && data.rows.some(row => row[0] === exactPin)) {
          status.append(" ", link("View this parcel with all scores included", parcelScoreUrl(exactPin)));
        }
      }
      clear.hidden = !pinSearch.value && !township.value && !propertyClass.value && !acresMin.value && realistic.checked && threshold.value === "45" && sort.value === "score";
      filterSummary.textContent = clear.hidden ? "Filter and sort properties" : "Filter and sort properties · filters applied";
      showAll.hidden = matches.length === data.rows.length;
      table.hidden = !matches.length;
      paging.hidden = pages === 1;
      prev.disabled = page === 1;
      next.disabled = page === pages;
      indicator.textContent = "Page " + page + " of " + countFormat.format(pages);
      for (const record of shown) {
        const [pin,town,propertyClass,acres] = record;
        const score = record[7];
        const row = tbody.insertRow();
        row.insertCell().append(create("span",String(score),"rank-score"));
        const parcelCell = create("th");
        parcelCell.scope = "row";
        const property = link(pin,parcelScoreUrl(pin));
        property.className = "rank-pin";
        property.setAttribute("aria-label","View property and score details for parcel " + pin);
        parcelCell.append(property);
        if (topParcels.has(pin)) parcelCell.append(create("span",topParcels.get(pin).road,"rank-road"));
        parcelCell.append(create("span", [data.townships[town],data.classes[propertyClass]].filter(Boolean).map(middle).join(" · "),"rank-location"));
        row.append(parcelCell);
        row.insertCell().textContent = acres > 0 ? acresFormat.format(acres) : "Not recorded";
      }
    }
    function filtersChanged(replace = false) {
      page = 1;
      filter(); render(); writeLocation(replace,"scored-properties");
    }
    pinSearch.addEventListener("input", () => { filtersChanged(inputSequence); inputSequence = true; });
    pinSearch.addEventListener("blur", () => { inputSequence = false; });
    for (const el of [township,propertyClass,acresMin,realistic,threshold,sort]) el.addEventListener("change",() => filtersChanged());
    clear.addEventListener("click", () => {
      pinSearch.value = ""; township.value = ""; threshold.value = "45"; sort.value = "score";
      propertyClass.value = ""; acresMin.value = ""; realistic.checked = true;
      filtersChanged(); pinSearch.focus();
    });
    showAll.addEventListener("click", () => {
      pinSearch.value = ""; township.value = ""; propertyClass.value = ""; acresMin.value = "";
      threshold.value = "all"; realistic.checked = false; sort.value = "score";
      filtersChanged(); results.focus({preventScroll:true});
    });
    function goPage(change) {
      page += change;
      render(); writeLocation(false,"scored-properties"); results.focus({preventScroll:true});
      results.scrollIntoView({block:"start",behavior:"instant"});
    }
    prev.addEventListener("click",() => goPage(-1));
    next.addEventListener("click",() => goPage(1));
    function restore() {
      inputSequence = false;
      readLocation(); filter(); render();
    }
    window.addEventListener("popstate",restore);
    restore();
  }

  function buildFinder(data, geography, snapshot) {
    const scores = new Map(data?.rows.map(row => [row[0],row]));
    const topParcels = new Map();
    if (data && snapshot?.sourceDate === data.source_date) {
      for (const parcel of snapshot.parcels) {
        const row = scores.get(parcel.pin);
        if (row && row[3] === parcel.ac && row[4] === parcel.land && row[5] === parcel.buy &&
            row[6] === parcel.risk && row[7] === parcel.score) topParcels.set(parcel.pin,parcel);
      }
    }
    const mappedPanel = document.getElementById("map-score-detail");
    const countyPanel = document.getElementById("result");
    const visited = new Map();
    let mapView;
    let request;
    const isMapped = pin => Boolean(mapView?.has(pin));

    function writeLocation(pin,anchor) {
      const url = new URL(location.href);
      const key = scores.has(pin) ? "scoreDetail" : "foundParcel";
      url.searchParams.delete("scoreDetail");
      url.searchParams.delete("foundParcel");
      if (pin) url.searchParams.set(key,pin);
      url.hash = anchor;
      if (url.href !== location.href) history.pushState(history.state,"",url);
    }
    const backToRow = document.getElementById("map-back-to-row");
    function clearResult() {
      if (backToRow) backToRow.hidden = true;
      request?.abort();
      request = null;
      countyPanel.replaceChildren(); mappedPanel.replaceChildren();
      countyPanel.hidden = mappedPanel.hidden = resultRoot.hidden = true;
    }
    function focusResult() {
      if (resultRoot.hidden) return;
      const target = mappedPanel.hidden ? countyPanel : mappedPanel;
      target.focus({preventScroll:true});
      target.scrollIntoView({block:"start"});
    }
    function mapPosition(entry) {
      if (!entry?.pt) return null;
      const {center,scale} = geography.projection;
      const rad = Math.PI / 180;
      return [center[0] + entry.pt[0] / scale / rad,
        Math.atan(Math.sinh(Math.asinh(Math.tan(center[1] * rad)) - entry.pt[1] / scale)) / rad];
    }
    function goToMap(pin) {
      writeLocation(pin,"chatham-map");
      const section = document.getElementById("chatham-map");
      if (section.tagName === "DETAILS") section.open = true;
      document.getElementById("chatham-map-title").focus({preventScroll:true});
      section.scrollIntoView({block:"start"});
    }
    function showResources(target,pin,position) {
      const utilities = create("div");
      target.replaceChildren(utilities);
      window.showPropertyUtilities?.(utilities,{pin,lon:position?.[0],lat:position?.[1]});
      const records = create("details",undefined,"parcel-records");
      const links = create("div",undefined,"rank-links");
      if (position) {
        const water = new URL("../infrastructure-map/",location.href);
        water.search = new URLSearchParams({lon:position[0].toFixed(7),lat:position[1].toFixed(7)});
        links.append(link("Explore nearby streams and lakes",water.href));
      }
      links.append(link("County property record","https://tax.sangamonil.gov/SangamonCountyWeb/app/displayParcelSummary.action?parcelNumber=" + pin),
        link("County parcel map","https://gismaps.co.sangamon.il.us/tpv/?pin=" + pin));
      records.append(create("summary","County records and maps"),links);
      target.append(records);
    }
    function scoreDetails(target,row) {
      const [pin,,cls,,land,buy,risk,score] = row;
      const breakdown = create("details",undefined,"score-breakdown");
      breakdown.append(create("summary","Why this research score is " + score + " / 100"));
      breakdown.append(create("p","The score uses the county file dated " + data.source_date + ". It ranks parcels for land research; it is not a percentage, a home appraisal or a prediction that an owner will sell."));
      const top = topParcels.get(pin);
      if (top) breakdown.append(create("p","#" + top.n + " in the Chatham Township top 10. " + top.label + ". " + top.village + "."));
      const reasons = create("ul",undefined,"rank-reasons");
      reasons.append(create("li","Land fit " + land + "/40"),create("li","Ownership and purchase indicators " + buy + "/35"),create("li","Points remaining after model deductions " + risk + "/25"));
      const notice = create("p",undefined,"score-source-note");
      notice.setAttribute("role","status");
      breakdown.append(reasons,notice);
      if (data.classes[cls].includes("IMPROVED RESIDENTIAL")) breakdown.append(create("p","The current rule deducts 12 points for residential classification, including vacant lots recorded as ‘unimproved residential’. This is a known limitation of the existing score, not evidence of a defect in your property."));
      target.append(breakdown);
      breakdown.addEventListener("toggle",() => {
        if (breakdown.open) showScoreReasons(reasons,notice,row,data.source_date,data.classes[cls],top);
      });
    }
    function informationDetails(target,row,entry) {
      const details = create("details",undefined,"parcel-data-details");
      details.append(create("summary","What we know and what’s missing"));
      const facts = create("dl",undefined,"parcel-data-facts");
      details.append(facts,create("h3","Checks still needed"));
      const missing = create("ul",undefined,"parcel-missing-checks");
      missing.append(
        create("li","Home value and condition: no appraisal, comparable-sale analysis, inspection or current listing status is included."),
        create("li","Land constraints: floodplain, wetlands, drainage, soils, slope, legal access, easements and zoning/buildability have not been checked by the score. Nearby water on the map does not answer these questions."),
        create("li","Utilities: the water, electricity and gas sections show their own sources and uncertainty. A service-area match does not confirm a connection or capacity at your meter."),
        create("li","Assessment and taxes: the published score file has points rather than the underlying amounts. Zero points cannot distinguish missing inputs from values outside a threshold. Tax-sale flags can be absent when their source was unavailable; check current county records.")
      );
      details.append(missing,create("p","Missing information means unverified, not that a problem exists. The score does not measure how complete this property record is.","score-source-note"));
      target.append(details);
      return function update(current,pending = false) {
        facts.replaceChildren();
        const items = window.ParcelScoreContext.facts({row,loaded:Boolean(data),sourceDate:data?.source_date,
          propertyClass:row ? middle(data.classes[row[2]]) : "",parcel:current,entry,pending});
        for (const item of items) {
          const term = create("dt",item.label);
          term.append(create("span",item.status,"parcel-data-status"));
          facts.append(term,create("dd",item.detail));
        }
      };
    }
    function showProperty(match,focus) {
      clearResult();
      const {pin,address} = match;
      const entry = geography?.parcels[pin];
      const record = scores.get(pin);
      const panel = isMapped(pin) ? mappedPanel : countyPanel;
      mapView?.select(isMapped(pin) ? pin : "");
      if (backToRow && isMapped(pin)) {
        const rankings = new URL("./rankings.html",location.href);
        rankings.search = new URLSearchParams({scorePin:pin,scoreMin:"all",scoreTargets:"all"});
        backToRow.href = rankings.href;
        backToRow.hidden = false;
      }
      resultRoot.hidden = panel.hidden = false;
      panel.append(create("h2",address || "Parcel " + pin));
      const facts = [];
      if (record) facts.push(middle(data.townships[record[1]]) + " Township",middle(data.classes[record[2]]));
      if (address) facts.push("Parcel " + pin);
      if (facts.length) panel.append(create("p",facts.join(" · "),"parcel-identity"));

      const overview = create("div",undefined,"lot-overview");
      const sketch = create("div",undefined,"county-parcel-preview");
      const summary = create("div",undefined,"lot-summary");
      const acreage = create("div");
      const size = create("strong");
      function showAcres(countyAcres) {
        const acres = countyAcres > 0 ? countyAcres : record?.[3];
        size.textContent = acres > 0 ? acresFormat.format(acres) + (acres === 1 ? " acre" : " acres") : "Unavailable";
      }
      showAcres(match.acres);
      acreage.append(create("span","Recorded lot size","lot-metric-label"),size);
      const rating = create("div");
      rating.append(create("span","Land research score","lot-metric-label"),create("strong",record ? record[7] + " / 100" : data ? "Not scored" : "Could not load","score-value"));
      const metrics = create("div",undefined,"lot-metrics");
      metrics.append(acreage,rating);
      const explanation = window.ParcelScoreContext.interpretation(record,Boolean(data));
      summary.append(metrics,create("p",explanation,"lot-interpretation"),
        create("p","Home value, condition and flood risk: not assessed.","lot-missing-summary"));
      overview.append(sketch,summary);
      panel.append(overview);
      const share = window.createPropertyShare?.(pin);
      if (share) panel.append(share);
      if (record) scoreDetails(panel,record);
      const updateInformation = informationDetails(panel,record,entry);
      if (isMapped(pin)) {
        const jump = link("Explore this neighborhood on the map","#chatham-map");
        jump.className = "lot-jump";
        jump.addEventListener("click",event => {
          if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
          event.preventDefault();
          goToMap(pin);
        });
        panel.append(jump);
      }
      const resources = create("div");
      panel.append(resources);

      function drawDetails(parcel) {
        const position = parcel.position || mapPosition(entry);
        showAcres(parcel.acres);
        updateInformation(parcel);
        if (entry?.d || (entry && !parcel.features?.length)) {
          window.showSnapshotParcelPreview(sketch,pin,geography);
        } else {
          window.showCountyParcelPreview(sketch,pin,parcel.features || [],position,parcel.geometryUnavailable);
        }
        showResources(resources,pin,position);
      }
      if (entry || match.features || match.position || match.geometryUnavailable) {
        drawDetails(match);
      } else {
        updateInformation(match,true);
        const status = create("p","Looking up the county lot outline…");
        status.setAttribute("role","status");
        sketch.append(status);
        const controller = new AbortController();
        request = controller;
        const timer = setTimeout(() => controller.abort(),15000);
        findCountyParcels(pin,null,controller.signal).then(matches => {
          if (request !== controller) return;
          const parcel = {...match,...matches[0],features:matches[0]?.features || []};
          if (record || matches.length) visited.set(pin,parcel);
          drawDetails(parcel);
        }).catch(() => {
          if (request === controller) drawDetails({...match,geometryUnavailable:true});
        }).finally(() => clearTimeout(timer));
      }
      if (focus) focusResult();
    }
    function onMapChoose(pin) {
      propertyFinder.cancel();
      if (pin) showProperty(visited.get(pin) || {pin},false);
      else clearResult();
      writeLocation(pin,"chatham-map");
    }

    if (data && geography) {
      try {
        mapView = window.createChathamScoreMap(mapContainer,{geometry:geography,top:[...topParcels.values()],scoreRows:data.rows},onMapChoose);
        const mappedPins = Object.keys(geography.parcels).filter(isMapped);
        const outlines = mappedPins.filter(pin => geography.parcels[pin].d).length;
        document.getElementById("map-vintage").textContent = countFormat.format(mappedPins.length) + " mapped properties · Scores from " + data.source_date;
        document.getElementById("coverage-note").textContent = "Coverage includes Chatham Township and parts of the Village of Chatham in Ball and Curran townships. Sangamon County provides " +
          countFormat.format(outlines) + " parcel outlines and " + countFormat.format(mappedPins.length - outlines) + " additional point locations. Parcel colors show land research scores, including zero.";
        const missing = geography.missing.filter(pin => scores.has(pin) && !isMapped(pin));
        if (missing.length) {
          const note = document.getElementById("coverage-missing");
          note.hidden = false;
          note.append(countFormat.format(missing.length) + " scored properties have no verified county map location. Open a parcel number to see its score. ");
          missing.forEach((pin,index) => {
            if (index) note.append(" · ");
            note.append(link(pin,parcelScoreUrl(pin)));
          });
        }
        document.getElementById("map-coverage").hidden = false;
      } catch {
        mapContainer.textContent = "The neighborhood map could not load. Reload to try again.";
      }
    } else {
      mapContainer.textContent = "The neighborhood map could not load. Reload to try again.";
    }
    function restore() {
      const params = new URLSearchParams(location.search);
      const pin = params.get("scoreDetail") || params.get("foundParcel");
      const focus = location.hash !== "#chatham-map";
      if (!/^\d{11}$/.test(pin || "")) {
        clearResult();
        mapView?.select("");
        return;
      }
      const known = visited.get(pin);
      if (known || scores.has(pin) || geography?.parcels[pin]) {
        showProperty(known || {pin},focus);
        return;
      }
      clearResult();
      mapView?.select("");
      const status = create("p","Checking the county record for parcel " + pin + ".");
      status.setAttribute("role","status");
      countyPanel.append(status);
      countyPanel.hidden = resultRoot.hidden = false;
      if (focus) focusResult();
      const controller = new AbortController();
      request = controller;
      const timer = setTimeout(() => controller.abort(),15000);
      findCountyParcels(pin,null,controller.signal).then(matches => {
        if (request !== controller) return;
        if (matches.length) {
          visited.set(pin,matches[0]);
          showProperty(matches[0],focus);
        } else status.textContent = "No county parcel matched " + pin + ". Check the number or search by address.";
      }).catch(() => {
        if (request !== controller) return;
        status.textContent = "The county could not verify parcel " + pin + ". Try the search again or check county GIS.";
        countyPanel.append(link("Check the county parcel map","https://gismaps.co.sangamon.il.us/tpv/?pin=" + pin));
      }).finally(() => clearTimeout(timer));
    }
    window.addEventListener("popstate",restore);
    restore();
    propertyFinder.connect({
      mapped:isMapped, scored:pin => scores.has(pin), search:query => mapView?.search(query) || [],
      show:(match,address) => {
        const parcel = {...match,address:address || visited.get(match.pin)?.address};
        if (!parcel.geometryUnavailable) visited.set(match.pin,parcel);
        writeLocation(match.pin,"property-result");
        showProperty(parcel,true);
      },
      focus:focusResult, nearby:() => mapView?.focusNearby(),
      clear:() => {
        clearResult();
        mapView?.select("");
        writeLocation("","find-property");
      }
    });
  }

  const scores = readJson("../data/sangamon-parcel-scores.json").catch(() => null);
  const snapshot = readJson("./data/chatham-top-parcels.json").catch(() => null);
  if (root) {
    Promise.all([scores,snapshot]).then(([data,top]) => {
      if (!data?.rows?.length) throw new Error("Scores unavailable");
      buildRankings(data,top);
    }).catch(() => { root.textContent = "The scored list could not load. Reload to try again."; });
  }
  if (resultRoot) {
    const geography = readJson("./data/chatham-scored-map.json").catch(() => null);
    Promise.all([scores,geography,snapshot]).then(([data,geometry,top]) => buildFinder(data,geometry,top));
  }
})();
