(() => {
  "use strict";
  const root = document.getElementById("parcel-rankings");
  if (!root) return;
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
  root.append(status);

  function create(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  const mapContainer = document.getElementById("chatham-map-content");
  const backToRow = document.getElementById("map-back-to-row");
  function readJson(url) {
    return fetch(url).then(response => {
      if (!response.ok) throw new Error("Could not load " + url);
      return response.json();
    });
  }
  // This optional detail file is fetched the first time a countywide row needs it.
  let reasonRequest;
  async function showScoreReasons(list, row, sourceDate, propertyClass, top) {
    if (!reasonRequest) {
      reasonRequest = readJson("./data/score-reasons.json").catch(() => {
        reasonRequest = null;
        return null;
      });
    }
    const source = await reasonRequest;
    if (!list.isConnected || source?.source_date !== sourceDate || !Array.isArray(source.patterns) || !source.rows) return;
    const rule = source.patterns[source.rows[row[0]]];
    if (!Array.isArray(rule) || rule.length !== 9 || !rule.every(Number.isInteger)) return;
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
    if (row[6] === 25 && top) risk += " Drainage, road access and utilities require separate checks.";
    list.replaceChildren(reason("Land fit",row[4],40,land),reason("Ownership and purchase indicators",row[5],35,buy),reason("Record checks",row[6],25,risk));
  }
  const mapData = Promise.all([
    readJson("./data/chatham-scored-map.json"),
    readJson("./data/chatham-top-parcels.json").catch(() => null)
  ]).catch(() => null);

  function build(data, scoresAvailable = true) {
    if (!Array.isArray(data.rows) || (scoresAvailable && !data.rows.length) || !Array.isArray(data.townships) || !Array.isArray(data.classes)) {
      throw new Error("Invalid ranking data");
    }
    const middle = value => value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    const sourceDate = new Date(data.source_date + "T12:00:00Z").toLocaleDateString("en-US", {month:"long", day:"numeric", year:"numeric", timeZone:"UTC"});
    const byPin = new Map(data.rows.map(row => [row[0],row]));
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
    const realistic = field("realistic","Realistic targets only","input");
    realistic.type = "checkbox"; realistic.defaultChecked = true;
    realistic.parentElement.className = "rank-check";
    realistic.parentElement.prepend(realistic);

    const header = create("div", undefined, "rank-summary");
    header.append(status,create("p",countFormat.format(data.rows.length) + " scored parcels across " + data.townships.length + " Sangamon County townships · County file dated " + sourceDate,"rank-vintage"));
    const method = create("details",undefined,"rank-method");
    method.append(create("summary","How the opportunity score works"),
      create("p","Each parcel earns up to 100 points across three parts. Higher scores move a parcel up the research list. The score does not establish that a property is available to buy."),
      create("p","Land fit (40 points) uses acreage, property class, assessed value and taxes per acre. Buyability (35 points) uses ownership categories, holdings and tax-sale indicators. Risk (25 points) uses property class, acreage, ownership and tax-sale indicators. More risk points means fewer deductions."));
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
    ["Score", "Parcel and location", "Acres"].forEach(label => {
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
    root.replaceChildren(form,actions,header,method,results);

    let page = 1;
    let selected = "";
    let matches = [];
    let inputSequence = false;
    let mapView;
    let geometry;
    const topParcels = new Map();
    const isMapped = pin => Boolean(mapView?.has(pin));
    const panel = document.getElementById("map-score-detail");
    const resultRoot = document.getElementById("property-result");
    const countyPanel = document.getElementById("result");
    let lookupMatch;
    let restoringPin;

    function locationOf(pin) {
      if (lookupMatch?.pin === pin && lookupMatch.position) return lookupMatch.position;
      const pt = geometry?.parcels[pin]?.pt;
      if (!pt) return null;
      const {center,scale} = geometry.projection;
      const rad = Math.PI / 180;
      return [center[0] + pt[0] / scale / rad,
        Math.atan(Math.sinh(Math.asinh(Math.tan(center[1] * rad)) - pt[1] / scale)) / rad];
    }
    function showScore(target,record) {
      const [pin,town,cls,acres,land,buy,risk,score] = record;
      const top = topParcels.get(pin);
      const residence = data.classes[cls].includes("RESIDENTIAL");
      target.append(create("p","Land research score","score-label"),create("h3",score + " out of 100","score-value"));
      const facts = [middle(data.classes[cls]), middle(data.townships[town]) + " Township", "Parcel " + pin];
      if (acres > 0) facts.push(acresFormat.format(acres) + " recorded acres");
      target.append(create("p",facts.join(" · "),"map-score-facts"));
      target.append(create("p",residence ?
        "This index gives extra points to farms and larger lots. A home can score low even in excellent condition. The score does not measure the home’s value or condition." :
        "This score ranks land for further research. Farms and larger lots earn extra points. Property value and availability for sale need separate checks."));
      if (top) target.append(create("p","#" + top.n + " in the Chatham Township top 10. " + top.label + ". " + top.village + "."));
      const breakdown = create("details",undefined,"score-breakdown");
      breakdown.append(create("summary","How this property earned " + score + " points"));
      const reasons = create("ul",undefined,"rank-reasons");
      reasons.append(create("li","Land fit " + land + "/40"),create("li","Ownership and purchase indicators " + buy + "/35"),create("li","Record checks " + risk + "/25"));
      breakdown.append(reasons); target.append(breakdown);
      showScoreReasons(reasons,record,data.source_date,data.classes[cls],top);
    }
    function showResources(target,pin) {
      const pos = locationOf(pin);
      const utilities = create("div");
      target.append(utilities);
      window.showPropertyUtilities?.(utilities,{pin,lon:pos?.[0],lat:pos?.[1]});
      const links = create("div",undefined,"rank-links");
      if (pos) {
        const water = new URL("../infrastructure-map/",location.href);
        water.search = new URLSearchParams({lon:pos[0].toFixed(7),lat:pos[1].toFixed(7)});
        links.append(link("Explore nearby streams and lakes",water.href));
      }
      links.append(link("County property record","https://tax.sangamonil.gov/SangamonCountyWeb/app/displayParcelSummary.action?parcelNumber=" + pin),
        link("County parcel map","https://gismaps.co.sangamon.il.us/tpv/?pin=" + pin));
      target.append(links);
    }
    function utilityJump(target) {
      const button = create("button","See water, power and gas","utility-jump");
      button.type = "button";
      button.addEventListener("click",() => {
        const utilities = target.querySelector(".property-utilities");
        utilities?.focus({preventScroll:true});
        utilities?.scrollIntoView({block:"start"});
      });
      return button;
    }
    function showParcelPanel(pin) {
      panel.hidden = !pin;
      panel.replaceChildren();
      resultRoot.hidden = !pin && countyPanel.hidden;
      if (!pin) return;
      countyPanel.hidden = true;
      const entry = geometry.parcels[pin];
      const address = lookupMatch?.pin === pin && lookupMatch.address;
      const heading = create("h2",address || "Selected property");
      panel.append(heading);
      const jump = link(entry.d ? "See this lot on the map ↓" : "See this location on the map ↓","#chatham-map");
      jump.className = "lot-jump";
      jump.addEventListener("click",event => {
        if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault(); writeLocation(false,"chatham-map"); goToMap();
      });
      const actions = create("div",undefined,"property-jumps");
      actions.append(jump,utilityJump(panel));
      panel.append(actions);
      if (!entry.d) panel.append(create("p","The county provides a point location for this parcel. A separate lot outline is unavailable."));
      showScore(panel,byPin.get(pin));
      showResources(panel,pin);
    }
    function clearFound() {
      restoringPin?.abort(); restoringPin = null;
      lookupMatch = null;
      countyPanel.hidden = true; countyPanel.replaceChildren();
    }
    function focusResult() {
      const target = panel.hidden ? countyPanel : panel;
      if (target.hidden) return;
      target.focus({preventScroll:true});
      target.scrollIntoView({block:"start"});
    }
    let currentMapPin;
    function syncMap() {
      const pin = isMapped(selected) ? selected : "";
      if (currentMapPin !== pin) {
        mapView?.select(pin);
        showParcelPanel(pin);
      }
      currentMapPin = pin;
      resultRoot.hidden = panel.hidden && countyPanel.hidden;
      if (backToRow) backToRow.hidden = !pin;
    }
    function goToMap() {
      document.getElementById("chatham-map-title").focus({preventScroll:true});
      document.getElementById("chatham-map").scrollIntoView({block:"start"});
    }
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
      selected = params.get("scoreDetail") || "";
    }
    function writeLocation(replace = false, anchor) {
      const url = new URL(location.href);
      const params = {scorePin: pinSearch.value.trim(), scoreTown: township.value, scoreClass:propertyClass.value,
        scoreAcres:acresMin.value, scoreTargets:realistic.checked ? "" : "all",
        scoreMin: threshold.value !== "45" ? threshold.value : "",
        scoreSort: sort.value !== "score" ? sort.value : "", scorePage: page > 1 ? page : "", scoreDetail: selected};
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
    function link(text,href) {
      const a = create("a",text);
      a.href = href;
      a.referrerPolicy = "no-referrer";
      return a;
    }
    function parcelScoreUrl(pin) {
      const url = new URL(location.pathname, location.origin);
      url.search = new URLSearchParams({scorePin:pin, scoreMin:"all", scoreTargets:"all", scoreDetail:pin});
      url.hash = "scored-properties";
      return url.href;
    }
    function render() {
      const pages = Math.max(1,Math.ceil(matches.length / pageSize));
      page = Math.min(page,pages);
      const offset = (page - 1) * pageSize;
      const shown = matches.slice(offset,offset + pageSize);
      if (!shown.some(row => row[0] === selected)) selected = "";
      syncMap();
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
      showAll.hidden = matches.length === data.rows.length;
      table.hidden = !matches.length;
      paging.hidden = pages === 1;
      prev.disabled = page === 1;
      next.disabled = page === pages;
      indicator.textContent = "Page " + page + " of " + countFormat.format(pages);
      for (const record of shown) {
        const [pin,town,propertyClass,acres,land,buyability,risk,score] = record;
        const row = tbody.insertRow();
        row.insertCell().append(create("span",String(score),"rank-score"));
        const parcelCell = create("th");
        parcelCell.scope = "row";
        const button = create("button",pin,"rank-pin");
        button.type = "button";
        button.setAttribute("aria-label","Score details for parcel " + pin);
        const opened = selected === pin;
        button.setAttribute("aria-expanded",String(opened));
        button.addEventListener("click",() => {
          clearFound(); propertyFinder.cancel();
          selected = opened ? "" : pin;
          const showMap = selected === pin && isMapped(pin);
          writeLocation(false, showMap ? "chatham-map" : "scored-properties");
          render();
          if (showMap) focusResult();
          else tbody.querySelector('[aria-label="Score details for parcel ' + pin + '"]').focus({preventScroll:true});
        });
        parcelCell.append(button);
        if (topParcels.has(pin)) parcelCell.append(create("span",topParcels.get(pin).road,"rank-road"));
        parcelCell.append(create("span", [data.townships[town],data.classes[propertyClass]].filter(Boolean).map(middle).join(" · "),"rank-location"));
        row.append(parcelCell);
        row.insertCell().textContent = acres > 0 ? acresFormat.format(acres) : "—";
        if (opened) {
          const detail = tbody.insertRow().insertCell();
          detail.colSpan = 3;
          detail.className = "rank-detail";
          detail.append(create("p","Land fit " + land + "/40 · Buyability " + buyability + "/35 · Risk " + risk + "/25"));
          const links = create("div",undefined,"rank-links");
          if (isMapped(pin)) {
            const top = topParcels.get(pin);
            if (top) detail.append(create("p", top.label + ". " + top.village + "."));
            const outline = create("button","View property on map and see scoring reasons","rank-reset rank-preview-link");
            outline.type = "button";
            outline.addEventListener("click",() => {
              writeLocation(false,"chatham-map");
              goToMap();
            });
            links.append(outline);
          } else {
            const preview = create("div");
            detail.append(preview);
            window.showCountyParcelPreview?.(preview,pin);
            const reasons = create("ul",undefined,"rank-reasons");
            reasons.append(create("li",acresFormat.format(acres) + " recorded acres · " + middle(data.classes[propertyClass]) + ". The land score also considers assessed value and annual tax per acre."));
            reasons.append(create("li","Ownership and tax-sale rules produced " + buyability + " of 35 buyability points. The risk calculation " + (risk === 25 ? "applied no deductions." : "deducted " + (25-risk) + " of its 25 starting points.") ));
            detail.append(reasons);
            showScoreReasons(reasons,record,data.source_date,data.classes[propertyClass]);
          }
          links.append(link("County property record","https://tax.sangamonil.gov/SangamonCountyWeb/app/displayParcelSummary.action?parcelNumber=" + pin),
            link("County parcel map","https://gismaps.co.sangamon.il.us/tpv/?pin=" + pin));
          const lookupForm = document.getElementById("parcel-form");
          const number = document.getElementById("parcel-number");
          if (lookupForm && number) {
            const lookup = create("button","Open property and utility information","rank-reset");
            lookup.type = "button";
            lookup.addEventListener("click",() => {
              number.value = pin;
              lookupForm.requestSubmit();

            });
            links.append(lookup);
          }
          detail.append(links);
        }
      }
    }
    function filtersChanged(replace = false) {
      clearFound();
      page = 1; selected = "";
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
      page += change; selected = "";
      render(); writeLocation(false,"scored-properties"); results.focus({preventScroll:true});
      results.scrollIntoView({block:"start",behavior:"instant"});
    }
    prev.addEventListener("click",() => goPage(-1));
    next.addEventListener("click",() => goPage(1));
    function revealMappedRow(pin) {
      if (!pin) return;
      let index = matches.findIndex(row => row[0] === pin);
      if (index < 0) {
        form.reset();
        pinSearch.value = acresMin.value = propertyClass.value = "";
        township.value = data.townships[byPin.get(pin)[1]]; realistic.checked = false;
        threshold.value = "all"; sort.value = "score";
        filter();
        index = matches.findIndex(row => row[0] === pin);
      }
      if (index >= 0) page = Math.floor(index / pageSize) + 1;
    }
    function onMapChoose(pin) {
      clearFound(); propertyFinder.cancel();
      if (pin && !isMapped(pin)) return;
      selected = pin;
      revealMappedRow(pin);
      render();
      writeLocation(false,"chatham-map");
    }
    backToRow?.addEventListener("click",() => {
      const button = tbody.querySelector('.rank-pin[aria-expanded="true"]');
      if (!button) return;
      writeLocation(false,"scored-properties");
      button.focus({preventScroll:true});
      button.scrollIntoView({block:"center"});
    });
    function restore() {
      clearFound();
      inputSequence = false;
      readLocation(); filter();
      if (["#chatham-map","#property-result"].includes(location.hash) && byPin.has(selected)) revealMappedRow(selected);
      render();
      const countyPin = new URLSearchParams(location.search).get("foundParcel");
      if (location.hash === "#property-result" && /^\d{11}$/.test(countyPin || "")) {
        const controller = new AbortController();
        restoringPin = controller;
        const timeout = setTimeout(() => controller.abort(),15000);
        findCountyParcels(countyPin,null,controller.signal).then(matches => {
          if (restoringPin !== controller || controller.signal.aborted) return;
          if (matches.length || byPin.has(countyPin)) showFound(matches[0] || {pin:countyPin},null);
          else document.getElementById("lookup-status").textContent = "No county parcel matched " + countyPin + ". Try the address or parcel number above.";
        }).catch(() => {
          if (restoringPin !== controller) return;
          if (byPin.has(countyPin)) showFound({pin:countyPin},null);
          else document.getElementById("lookup-status").textContent = "The county could not load this property. Try the search again.";
        }).finally(() => clearTimeout(timeout));
      }
    }
    window.addEventListener("popstate",restore);
    restore();
    function showFound(match,address) {
      clearFound();
      lookupMatch = {...match,address};
      if (isMapped(match.pin)) {
        selected = match.pin; currentMapPin = undefined;
        revealMappedRow(selected); render(); writeLocation(false,"property-result");
      } else {
        selected = ""; render();
        const url = new URL(location.href);
        url.searchParams.delete("scoreDetail");
        url.searchParams.set("foundParcel",match.pin);
        url.hash = "property-result";
        if (url.href !== location.href) history.pushState(history.state,"",url);
        countyPanel.replaceChildren(create("h2",address || "Parcel " + match.pin));
        countyPanel.append(utilityJump(countyPanel));
        countyPanel.hidden = resultRoot.hidden = false;
        if (match.features?.length || match.position) {
          const sketch = create("div");
          countyPanel.append(sketch);
          window.showCountyParcelPreview?.(sketch,match.pin,match.features);
        }
        const record = byPin.get(match.pin);
        if (record) showScore(countyPanel,record);
        else countyPanel.append(create("p",scoresAvailable ? "This county parcel has no published land index score." : "The land score could not load. Reload the page to try again."));
        showResources(countyPanel,match.pin);
      }
      focusResult();
    }
    mapData.then(assets => {
      if (!assets || !scoresAvailable) throw new Error("Map data unavailable");
      const [geography, snapshot] = assets;
      geometry = geography;
      if (snapshot?.sourceDate === data.source_date) {
        for (const parcel of snapshot.parcels) {
          const row = byPin.get(parcel.pin);
          if (row && row[3] === parcel.ac && row[4] === parcel.land && row[5] === parcel.buy && row[6] === parcel.risk &&
              row[7] === parcel.score && geometry.parcels[parcel.pin]) topParcels.set(parcel.pin,parcel);
        }
      }
      mapView = window.createChathamScoreMap(mapContainer,{geometry,top:[...topParcels.values()],scoreRows:data.rows},onMapChoose);
      const mappedPins = Object.keys(geometry.parcels).filter(isMapped);
      const outlineCount = mappedPins.filter(pin => geometry.parcels[pin].d).length;
      document.getElementById("map-vintage").textContent = countFormat.format(mappedPins.length) + " mapped properties · Scores from " + sourceDate;
      const note = document.getElementById("coverage-note");
      note.textContent = "The map includes scored properties throughout Chatham Township and in the parts of the Village of Chatham that fall in Ball and Curran townships. The county supplies " +
        countFormat.format(outlineCount) + " parcel outlines and " + countFormat.format(mappedPins.length - outlineCount) +
        " additional properties with point locations. The colors show opportunity scores, including zero. A low score on a home can reflect the model’s preference for farms and large lots.";
      const missing = geometry.missing.filter(pin => byPin.has(pin) && !isMapped(pin));
      if (missing.length) {
        const missingNote = document.getElementById("coverage-missing");
        missingNote.hidden = false;
        missingNote.append(countFormat.format(missing.length) + " scored properties have no verified county map location. Open a parcel number to see its score. ");
        missing.forEach((pin,index) => {
          if (index) missingNote.append(" · ");
          missingNote.append(link(pin,parcelScoreUrl(pin)));
        });
      }
      document.getElementById("map-coverage").hidden = false;
      restore();

    }).catch(() => {
      mapContainer.textContent = "The Chatham map could not load. Reload to try again, or select a property in the ranked list for its county map.";
    }).finally(() => {
      if (!scoresAvailable) root.textContent = "The scored list could not load. Reload to try again.";
      propertyFinder.connect({
        mapped:isMapped, scored:pin => byPin.has(pin), search:query => mapView?.search(query) || [],
        show:showFound, focus:focusResult, nearby:() => mapView?.focusNearby(),
        clear:() => { clearFound(); selected = ""; render(); writeLocation(false,"find-property"); }
      });
    });
  }

  readJson("../data/sangamon-parcel-scores.json").then(build).catch(() => {
      build({rows:[],classes:[],townships:[],source_date:null},false);
    });
})();
