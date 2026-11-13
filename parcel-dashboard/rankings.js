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
  let mapView;
  let onMapChoose;
  function readJson(url) {
    return fetch(url).then(response => {
      if (!response.ok) throw new Error("Could not load " + url);
      return response.json();
    });
  }
  // This optional detail file is fetched the first time a countywide row needs it.
  let reasonRequest;
  async function showScoreReasons(list, row, sourceDate) {
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
    const land = points(landClass) + " for property class, " + points(size) + " for acreage, " +
      points(assessment) + " for assessed value per acre and " + points(tax) + " for annual tax per acre." +
      (landClass + size + assessment + tax > 40 ? " This component is capped at 40." : "");
    const buy = points(ownerClass) + " from the ownership category, " + points(holdings) + " from recorded holdings and " +
      points(otherBuy) + " from the combined address and tax-sale rules." +
      (ownerClass + holdings + otherBuy < 0 ? " This component has a floor of zero." :
        ownerClass + holdings + otherBuy > 35 ? " This component is capped at 35." : "");
    const risk = row[6] === 25 ? "The model applied no deductions to its 25 starting points." :
      "From 25 starting points, the model deducted " + points(-propertyRisk) + " for property class or missing acreage and " +
      points(-otherRisk) + " for the ownership and tax-sale rules." +
      (25 + propertyRisk + otherRisk < 0 ? " This component has a floor of zero." : "");
    list.replaceChildren(reason("Land fit",row[4],40,land),reason("Buyability",row[5],35,buy),reason("Risk",row[6],25,risk));
  }
  const mapReady = readJson("./data/chatham-top-parcels.json").then(snapshot => {
    mapView = window.createChathamScoreMap(mapContainer, snapshot, pin => {
      if (onMapChoose) {
        onMapChoose(pin);
      } else {
        // A touch can arrive while the larger county ranking file is still loading.
        const url = new URL(location.href);
        if (pin) url.searchParams.set("scoreDetail",pin);
        else url.searchParams.delete("scoreDetail");
        url.hash = "chatham-map";
        if (url.href !== location.href) history.pushState(history.state,"",url);
      }
    });
    const date = new Date(snapshot.sourceDate + "T12:00:00Z").toLocaleDateString("en-US", {month:"long", day:"numeric", year:"numeric", timeZone:"UTC"});
    document.getElementById("map-vintage").textContent = "Scores from " + date + " · Ties ordered by parcel number";
    mapView.select(new URLSearchParams(location.search).get("scoreDetail") || "");
    return snapshot;
  }).catch(() => {
    mapContainer.textContent = "The Chatham map could not load. Select a property in the ranked list to see its county map.";
    return null;
  });

  function build(data, snapshot) {
    if (!Array.isArray(data.rows) || !data.rows.length || !Array.isArray(data.townships) || !Array.isArray(data.classes)) {
      throw new Error("Invalid ranking data");
    }
    const middle = value => value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    const sourceDate = new Date(data.source_date + "T12:00:00Z").toLocaleDateString("en-US", {month:"long", day:"numeric", year:"numeric", timeZone:"UTC"});
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
    // Connect the dated field-level explanations only to the matching ranked record.
    const mapped = new Map();
    if (snapshot?.sourceDate === data.source_date) {
      for (const parcel of snapshot.parcels) {
        const row = data.rows.find(item => item[0] === parcel.pin);
        if (row && data.townships[row[1]] === "CHATHAM" && row[3] === parcel.ac && row[4] === parcel.land && row[5] === parcel.buy &&
            row[6] === parcel.risk && row[7] === parcel.score) mapped.set(parcel.pin,parcel);
      }
    }
    let currentMapPin;
    function syncMap() {
      const pin = mapped.has(selected) ? selected : "";
      if (currentMapPin !== pin) mapView?.select(pin);
      currentMapPin = pin;
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
          selected = opened ? "" : pin;
          const showMap = selected === pin && mapped.has(pin);
          writeLocation(false, showMap ? "chatham-map" : "scored-properties");
          render();
          if (showMap) goToMap();
          else tbody.querySelector('[aria-label="Score details for parcel ' + pin + '"]').focus({preventScroll:true});
        });
        parcelCell.append(button);
        if (mapped.has(pin)) parcelCell.append(create("span",mapped.get(pin).road,"rank-road"));
        parcelCell.append(create("span", [data.townships[town],data.classes[propertyClass]].filter(Boolean).map(middle).join(" · "),"rank-location"));
        row.append(parcelCell);
        row.insertCell().textContent = acres > 0 ? acresFormat.format(acres) : "—";
        if (opened) {
          const detail = tbody.insertRow().insertCell();
          detail.colSpan = 3;
          detail.className = "rank-detail";
          detail.append(create("p","Land fit " + land + "/40 · Buyability " + buyability + "/35 · Risk " + risk + "/25"));
          const links = create("div",undefined,"rank-links");
          if (mapped.has(pin)) {
            detail.append(create("p", mapped.get(pin).label + ". " + mapped.get(pin).village + "."));
            const outline = create("button","View outline and scoring reasons","rank-reset rank-preview-link");
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
            showScoreReasons(reasons,record,data.source_date);
          }
          links.append(link("County property record","https://tax.sangamonil.gov/SangamonCountyWeb/app/displayParcelSummary.action?parcelNumber=" + pin),
            link("County parcel map","https://gismaps.co.sangamon.il.us/tpv/?pin=" + pin));
          const lookupForm = document.getElementById("parcel-form");
          const number = document.getElementById("parcel-number");
          if (lookupForm && number) {
            const lookup = create("button","Look up parcel & water map","rank-reset");
            lookup.type = "button";
            lookup.addEventListener("click",() => {
              number.value = pin;
              lookupForm.requestSubmit();
              number.focus();
              lookupForm.scrollIntoView({block:"center"});
            });
            links.append(lookup);
          }
          detail.append(links);
        }
      }
    }
    function filtersChanged(replace = false) {
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
        township.value = "CHATHAM"; realistic.checked = true;
        threshold.value = "45"; sort.value = "score";
        filter();
        index = matches.findIndex(row => row[0] === pin);
      }
      if (index >= 0) page = Math.floor(index / pageSize) + 1;
    }
    onMapChoose = pin => {
      if (pin && !mapped.has(pin)) return;
      currentMapPin = pin;
      selected = pin;
      revealMappedRow(pin);
      render();
      writeLocation(false,"chatham-map");
    };
    backToRow?.addEventListener("click",() => {
      const button = tbody.querySelector('.rank-pin[aria-expanded="true"]');
      if (!button) return;
      writeLocation(false,"scored-properties");
      button.focus({preventScroll:true});
      button.scrollIntoView({block:"center"});
    });
    function restore() {
      inputSequence = false;
      readLocation(); filter();
      if (location.hash === "#chatham-map" && mapped.has(selected)) revealMappedRow(selected);
      render();
    }
    window.addEventListener("popstate",restore);
    restore();
    const lookupResult = document.querySelector("#result");
    const lookupScore = document.querySelector("#lookup-score");
    if (lookupResult && lookupScore) {
      function showLookupScore() {
        const pin = lookupResult.dataset.parcelNumber;
        if (!pin) return;
        const row = data.rows.find(item => item[0] === pin);
        lookupScore.replaceChildren();
        if (row) {
          lookupScore.append(link("Opportunity score " + row[7] + "/100 · View breakdown", parcelScoreUrl(pin)));
        } else {
          lookupScore.textContent = "This parcel falls outside the current list of scored properties.";
        }
        lookupScore.hidden = false;
      }
      lookupResult.addEventListener("parcel-found",showLookupScore);
      showLookupScore();
    }
  }

  Promise.all([readJson("../data/sangamon-parcel-scores.json"),mapReady])
    .then(([data,snapshot]) => build(data,snapshot)).catch(() => {
      status.textContent = "The scored list could not load. Reload this page to try again.";
    });
})();
