window.createChathamScoreMap = function createChathamScoreMap(container, {geometry, top, scoreRows}, onChoose) {
  const root = document.createElement("div");
  root.className = "score-map";
  root.innerHTML = `
    <form class="sm-search" role="search" aria-label="Find a place on the parcel map">
      <label for="sm-find">Street name or parcel number</label>
      <div><input id="sm-find" type="search" autocomplete="off" placeholder="e.g. Savannah Rd" maxlength="100"><button>Find</button></div>
      <p class="sm-search-status" role="status"></p>
      <div class="sm-search-results"></div>
    </form>
    <div class="sm-shortcuts">
      <a href="#parcel-lookup">Find by street address</a>
      <details class="sm-top"><summary>Top 10 in Chatham Township</summary><div></div></details>
    </div>
    <div class="sm-frame">
      <canvas class="sm-canvas" tabindex="0" aria-label="Parcel map, north up. Use the street or parcel search to choose a location. Use arrow keys to pan and plus or minus to zoom."></canvas>
      <div class="sm-map-actions"><button type="button" data-action="in" aria-label="Zoom in">+</button><button type="button" data-action="out" aria-label="Zoom out">−</button></div>
      <button type="button" class="sm-fit" data-action="fit">Fit map</button>
      <div class="sm-scale" aria-hidden="true"><span></span><i></i></div>
    </div>
    <div class="sm-selection" hidden><strong></strong><button type="button">Score details ↓</button></div>
    <div class="sm-hit-options" hidden aria-live="polite"></div>
    <div class="sm-legend" aria-label="Map legend"><strong>Score</strong><span><i></i>0–24</span><span><i></i>25–49</span><span><i></i>50–74</span><span><i></i>75–100</span><span><i class="sm-limit-key"></i>Village limits</span><span class="sm-point-legend" hidden><i class="sm-point-key"></i>Location only</span></div>
    <p class="sm-foot">Parcels and streets from <a href="https://sangis.co.sangamon.il.us/server/rest/services/TyleratENTParcels/MapServer/0" target="_blank" rel="noopener">Sangamon County GIS</a>.</p>`;
  container.replaceChildren(root);
  const find = selector => root.querySelector(selector);
  const map = find("canvas");
  const ctx = map.getContext("2d");
  const hitContext = document.createElement("canvas").getContext("2d");
  const colors = ["#e1dfc5", "#afcba5", "#70a78b", "#34795f"];
  const scores = new Map(scoreRows.map(row => [row[0], row[7]]));
  const parcels = new Map();
  const points = [];
  for (const [pin, geom] of Object.entries(geometry.parcels)) {
    if (!scores.has(pin)) continue;
    const parcel = {pin, ...geom, score: scores.get(pin)};
    if (geom.d) parcel.path = new Path2D(geom.d);
    else if (geom.pt) points.push(parcel);
    else continue;
    parcels.set(pin, parcel);
  }
  find(".sm-point-legend").hidden = points.length === 0;
  const polygons = [...parcels.values()].filter(parcel => parcel.path);
  const roads = geometry.roads.map(road => ({...road, path: new Path2D(road.d)}));
  const streetWords = {boulevard:"blvd", road:"rd", drive:"dr", court:"ct", lane:"ln", avenue:"ave", street:"st", circle:"cir", parkway:"pkwy", place:"pl", trail:"trl", north:"n", south:"s", east:"e", west:"w", route:"rt"};
  const normalizedName = name => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).map(word => streetWords[word] || word).join(" ");
  const streetNames = new Map();
  for (const road of roads) {
    if (!road.name) continue;
    const key = normalizedName(road.name);
    if (!streetNames.has(key)) streetNames.set(key, {key, name: road.name, roads: []});
    streetNames.get(key).roads.push(road);
  }
  const village = new Path2D(geometry.village?.d || "");
  const unitsPerMile = geometry.unitsPerMile || 500000 * 1609.344 / (6371008.8 * Math.cos(39.657 * Math.PI / 180));
  const bounds = geometry.bounds;
  const midpoint = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const overlaps = (a, b) => a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const input = find("#sm-find");
  const searchResults = find(".sm-search-results");
  const searchStatus = find(".sm-search-status");
  const choices = find(".sm-hit-options");
  const actionButton = (text, callback) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", callback);
    return button;
  };
  let width = 0, height = 0, scale = 0, baseScale = 0, pixelRatio = 1;
  let center = midpoint(bounds);
  let selected = "";
  let highlightedStreet = "";
  let frameQueued = false;
  function project([x, y]) {
    return [(x - center[0]) * scale + width / 2, (y - center[1]) * scale + height / 2];
  }
  function unproject(x, y) {
    return [(x - width / 2) / scale + center[0], (y - height / 2) / scale + center[1]];
  }
  function setScale(value) {
    scale = clamp(value, baseScale * 0.8, baseScale * 1200);
  }
  function requestDraw() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => { frameQueued = false; draw(); });
  }
  function drawScale() {
    const maxFeet = Math.min(95, width * .26) * 5280 / (unitsPerMile * scale);
    const feet = [1,5,10,25,50,100,250,500,1000,1320,2640,5280,10560,26400].filter(v => v <= maxFeet).pop() || 1;
    find(".sm-scale span").textContent = feet >= 1320 ? feet / 5280 + " mi" : feet + " ft";
    find(".sm-scale i").style.width = (feet / 5280 * unitsPerMile * scale) + "px";
  }
  function draw() {
    if (!scale) return;
    const box = [...unproject(0,0), ...unproject(width,height)];
    const zoom = scale / baseScale;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = "#f7f5eb";
    ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-center[0], -center[1]);
    ctx.fillStyle = "#edeada";
    ctx.fill(village, "evenodd");
    // Separate world paths ensure holes and every piece of multipart parcels stay selectable.
    const visible = polygons.filter(parcel => overlaps(parcel.b, box));
    ctx.lineJoin = "round";
    ctx.lineWidth = (zoom < 2 ? 0.28 : zoom < 12 ? .55 : .85) / scale;
    ctx.strokeStyle = zoom < 3 ? "#899783" : "#76897b";
    for (const parcel of visible) {
      ctx.fillStyle = colors[Math.min(3, Math.floor(parcel.score / 25))];
      ctx.fill(parcel.path, "evenodd"); ctx.stroke(parcel.path);
    }
    const visibleRoads = roads.filter(road => overlaps(road.b, box));
    const roadWidth = cls => Number(cls) <= 40 ? 2.2 : Number(cls) <= 70 ? 1.4 : .9;
    for (const road of visibleRoads) {
      ctx.lineWidth = roadWidth(road.cls) / scale;
      ctx.strokeStyle = Number(road.cls) <= 40 ? "#9e8668" : "#a7a99a";
      ctx.stroke(road.path);
    }
    ctx.setLineDash([5 / scale, 4 / scale]);
    ctx.lineWidth = 1.1 / scale;
    ctx.strokeStyle = "#946c40"; ctx.stroke(village);
    ctx.setLineDash([]);
    for (const road of streetNames.get(highlightedStreet)?.roads || []) {
      ctx.lineWidth = 2.5 / scale; ctx.strokeStyle = "#875c27"; ctx.stroke(road.path);
    }
    if (selected && parcels.get(selected).path) {
      const path = parcels.get(selected).path;
      ctx.fillStyle = "rgba(255,201,62,.42)"; ctx.fill(path, "evenodd");
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4.2 / scale; ctx.stroke(path);
      ctx.strokeStyle = "#563a12"; ctx.lineWidth = 2.3 / scale; ctx.stroke(path);
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    for (const point of points) {
      if (!overlaps(point.b, box)) continue;
      const [x, y] = project(point.pt);
      ctx.beginPath(); ctx.arc(x, y, point.pin === selected ? 6 : 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = point.pin === selected ? "#f6a920" : "#475c83"; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "white"; ctx.stroke();
    }
    const labels = visibleRoads.filter(road => road.name && road.pt)
      .sort((a,b) => Number(a.cls) - Number(b.cls));
    const drawn = new Set();
    const occupied = [[width-60, 0, width, 108], [0,height-45,110,height], [width-88,height-50,width,height]];
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    function label(text, x, y, important = false) {
      const half = ctx.measureText(text).width / 2;
      const rect = [x-half-4,y-12,x+half+4,y+5];
      if (rect[0] < 4 || rect[2] > width-4 || rect[1] < 4 || rect[3] > height-4 || occupied.some(b => overlaps(b,rect))) return;
      occupied.push(rect);
      ctx.strokeStyle = "#fffdf6"; ctx.lineWidth = 3.4; ctx.strokeText(text, x, y);
      ctx.fillStyle = important ? "#254331" : "#424b40"; ctx.fillText(text, x, y);
      drawn.add(text);
    }
    if (zoom < 4 && geometry.village?.b) label("Chatham", ...project(midpoint(geometry.village.b)), true);
    for (const road of labels) {
      if (drawn.has(road.name)) continue;
      if (zoom < 3 && Number(road.cls) > 70) continue;
      label(road.name, ...project(road.pt));
    }
    drawScale();
  }
  function focusParcel(parcel) {
    const b = parcel.b;
    center = midpoint(b);
    // Keep neighboring lots visible when centering a small urban parcel.
    const spanX = Math.max(b[2]-b[0], unitsPerMile * .065);
    const spanY = Math.max(b[3]-b[1], unitsPerMile * .065);
    setScale(Math.min(width * .62 / spanX, height * .58 / spanY));
  }
  function select(pin, focus = true) {
    const value = parcels.has(pin) ? pin : "";
    if (value === selected) return;
    selected = value;
    find(".sm-selection").hidden = !value;
    if (value) find(".sm-selection strong").textContent = value + " · " + scores.get(value) + "/100";
    highlightedStreet = "";
    choices.replaceChildren(); choices.hidden = true;
    if (selected && focus) focusParcel(parcels.get(selected));
    requestDraw();
  }
  function choose(pin, focus = true) {
    find(".sm-top").open = false;
    select(pin, focus);
    onChoose(pin);
  }
  function fitAll() {
    select("");
    highlightedStreet = "";
    choices.replaceChildren(); choices.hidden = true;
    center = midpoint(bounds); scale = baseScale;
    input.value = ""; searchResults.replaceChildren(); searchStatus.textContent = "";
    onChoose(""); requestDraw();
  }
  function hit(x, y) {
    const [gx, gy] = unproject(x, y);
    const picked = polygons.filter(p => gx >= p.b[0] && gx <= p.b[2] && gy >= p.b[1] && gy <= p.b[3] && hitContext.isPointInPath(p.path, gx, gy, "evenodd"));
    for (const p of points) {
      const [px, py] = project(p.pt);
      if (Math.hypot(px - x, py - y) <= 8) picked.push(p);
    }
    choices.replaceChildren(); choices.hidden = true;
    if (picked.length === 1) {
      choose(picked[0].pin, scale < baseScale * 3);
    } else if (picked.length) {
      const label = document.createElement("label");
      label.textContent = picked.length + " parcels at this location";
      const select = document.createElement("select");
      select.add(new Option("Choose a parcel", ""));
      for (const p of picked) select.add(new Option(p.pin + " · " + p.score + "/100", p.pin));
      select.onchange = () => { if (select.value) choose(select.value, false); };
      label.append(select); choices.append(label); choices.hidden = false;
    } else {
      choose("", false);
      choices.textContent = "No mapped scored parcel at this spot."; choices.hidden = false;
    }
  }
  function zoom(factor, x = width/2, y = height/2) {
    const anchor = unproject(x, y);
    setScale(scale * factor);
    center = [anchor[0] - (x-width/2)/scale, anchor[1] - (y-height/2)/scale];
    requestDraw();
  }
  find("[data-action=in]").onclick = () => zoom(2);
  find("[data-action=out]").onclick = () => zoom(.5);
  find("[data-action=fit]").onclick = fitAll;
  find(".sm-selection button").onclick = () => {
    const detail = document.getElementById("map-score-detail");
    detail?.focus({preventScroll:true});
    detail?.scrollIntoView({block:"start"});
  };
  const contacts = new Map();
  let start, pinch, moved = false;
  function local(event) {
    const rect = map.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }
  function touchPair() {
    const [a,b] = [...contacts.values()];
    return {mid: [(a[0]+b[0])/2,(a[1]+b[1])/2], distance: Math.hypot(a[0]-b[0],a[1]-b[1])};
  }
  map.addEventListener("pointerdown", event => {
    if (event.button !== 0 || contacts.size >= 2) return;
    const p = local(event);
    contacts.set(event.pointerId, p); map.setPointerCapture(event.pointerId);
    if (contacts.size === 1) {
      moved = false; start = {p, center:[...center]};
    } else {
      moved = true;
      const pair = touchPair();
      pinch = {anchor: unproject(...pair.mid), scale, distance: pair.distance};
    }
  });
  map.addEventListener("pointermove", event => {
    if (!contacts.has(event.pointerId)) return;
    const p = local(event);
    contacts.set(event.pointerId, p);
    if (contacts.size === 2 && pinch) {
      const pair = touchPair();
      if (pinch.distance > 0) setScale(pinch.scale * pair.distance / pinch.distance);
      center = [pinch.anchor[0] - (pair.mid[0]-width/2)/scale, pinch.anchor[1] - (pair.mid[1]-height/2)/scale];
    } else if (start) {
      const dx = p[0]-start.p[0], dy = p[1]-start.p[1];
      if (!moved && Math.hypot(dx,dy) < 5) return;
      moved = true;
      center = [start.center[0]-dx/scale, start.center[1]-dy/scale];
    }
    requestDraw();
  });
  function endPointer(event) {
    if (!contacts.delete(event.pointerId)) return;
    if (!moved && event.type === "pointerup") hit(...local(event));
    if (contacts.size === 1) {
      start = {p:[...contacts.values()][0], center:[...center]}; moved = true;
    }
    pinch = null;
  }
  map.addEventListener("pointerup", endPointer); map.addEventListener("pointercancel", endPointer);
  map.addEventListener("wheel", event => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    zoom(Math.exp(-clamp(delta,-200,200)*.004), ...local(event));
  }, {passive:false});
  map.addEventListener("dblclick", event => { event.preventDefault(); zoom(2, ...local(event)); });
  map.addEventListener("keydown", event => {
    const directions = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    const direction = directions[event.key];
    if (direction) {
      center = [center[0]+direction[0]*width*.22/scale,center[1]+direction[1]*height*.22/scale]; requestDraw();
    } else if (event.key === "+" || event.key === "=") zoom(2);
    else if (event.key === "-") zoom(.5);
    else if (event.key === "Home") fitAll();
    else return;
    event.preventDefault();
  });
  function focusStreet(street) {
    choose("", false); highlightedStreet = street.key;
    const visible = street.roads.filter(r => overlaps(r.b, bounds));
    const segments = visible.length ? visible : street.roads;
    const extent = [Math.min(...segments.map(r=>r.b[0])),Math.min(...segments.map(r=>r.b[1])),
                    Math.max(...segments.map(r=>r.b[2])),Math.max(...segments.map(r=>r.b[3]))];
    const mid = midpoint(extent);
    const nearest = segments.reduce((best,road) =>
      Math.hypot(road.pt[0]-mid[0],road.pt[1]-mid[1]) < Math.hypot(best.pt[0]-mid[0],best.pt[1]-mid[1]) ? road : best);
    center = [...nearest.pt];
    setScale(Math.min(width,height) / (unitsPerMile * .24));
    searchResults.replaceChildren(); searchStatus.textContent = "Showing " + street.name + ". Tap a parcel.";
    requestDraw();
  }
  find(".sm-search").addEventListener("submit", event => {
    event.preventDefault(); searchResults.replaceChildren();
    let query = input.value.trim();
    if (!query) { input.focus(); searchStatus.textContent = "Enter a street name or parcel number."; return; }
    let results;
    const digits = query.replace(/[\s-]/g, "");
    if (/^\d+$/.test(digits)) {
      const normalized = digits.length === 10 ? digits.slice(0,4) + "0" + digits.slice(4) : digits;
      if (geometry.missing?.includes(normalized)) {
        searchStatus.textContent = "The county has no mapped location for this scored parcel.";
        const link = document.createElement("a");
        const url = new URL(location.pathname, location.origin);
        url.search = new URLSearchParams({scorePin:normalized, scoreTargets:"all", scoreMin:"all", scoreDetail:normalized});
        url.hash = "scored-properties";
        link.href = url.href;
        link.textContent = "View the score for " + normalized;
        searchResults.append(link);
        return;
      }
      const matches = parcels.has(normalized) ? [parcels.get(normalized)] : [...parcels.values()].filter(p => p.pin.includes(digits));
      results = matches.map(p => ({text: p.pin + " · " + p.score + "/100", select: () => {
        if (selected === p.pin) { focusParcel(p); requestDraw(); }
        choose(p.pin); searchResults.replaceChildren(); searchStatus.textContent = "Showing parcel " + p.pin + ".";
      }}));
    } else {
      query = normalizedName(query);
      const exact = streetNames.get(query);
      const matches = exact ? [exact] : [...streetNames.values()].filter(street => query && street.key.includes(query)).sort((a,b)=>a.name.localeCompare(b.name));
      results = matches.map(street => ({text:street.name, select:()=>focusStreet(street)}));
    }
    if (results.length === 1) { results[0].select(); return; }
    if (results.length === 0) {
      searchStatus.textContent = "No mapped street or parcel number matched. For a house number, use Find by street address."; return;
    }
    searchStatus.textContent = results.length > 12 ? "Showing 12 of " + results.length + " matches. Enter more characters to narrow the list." : "Choose a match.";
    for (const result of results.slice(0,12)) searchResults.append(actionButton(result.text, result.select));
  });
  for (const parcel of top || []) {
    if (!parcels.has(parcel.pin)) continue;
    find(".sm-top div").append(actionButton("#" + parcel.n + " · " + parcel.road + " · " + scores.get(parcel.pin) + "/100", () => {
      focusParcel(parcels.get(parcel.pin)); choose(parcel.pin); requestDraw();
    }));
  }
  function resize() {
    const rect = map.getBoundingClientRect();
    if (!rect.width || !rect.height || (rect.width === width && rect.height === height)) return;
    const factor = baseScale ? scale / baseScale : 1;
    width = rect.width; height = rect.height;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    map.width = Math.round(width * pixelRatio); map.height = Math.round(height * pixelRatio);
    baseScale = Math.min((width-24)/(bounds[2]-bounds[0]),(height-24)/(bounds[3]-bounds[1]));
    setScale(baseScale * factor); requestDraw();
  }
  resize();
  new ResizeObserver(resize).observe(map);
  return {select, has: pin => parcels.has(pin)};
};
