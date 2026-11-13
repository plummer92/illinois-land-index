window.createChathamScoreMap = function createChathamScoreMap(container, {geometry, top, scoreRows}, onChoose) {
  const root = document.createElement("div");
  root.className = "score-map";
  root.innerHTML = `
    <div class="sm-frame">
      <canvas class="sm-canvas" tabindex="0" aria-label="Parcel map, north up. Arrow keys move the map. Plus and minus zoom. Enter selects at the center. You can also choose from the nearby properties list."></canvas>
      <span class="sm-reticle" aria-hidden="true">+</span>
      <div class="sm-map-actions"><button type="button" data-action="in" aria-label="Zoom in">+</button><button type="button" data-action="out" aria-label="Zoom out">−</button></div>
      <button type="button" class="sm-fit" data-action="fit">Fit map</button>
      <div class="sm-scale" aria-hidden="true"><span></span><i></i></div>
    </div>
    <div class="sm-selection" hidden><strong></strong><button type="button" data-view="score">Score details</button><button type="button" data-view="utilities">Water, power &amp; gas</button></div>
    <div class="sm-hit-options" hidden aria-live="polite"></div>
    <details class="sm-nearby">
      <summary>Choose a nearby property</summary>
      <p class="sm-near-count" role="status"></p>
      <ul class="sm-near-list"></ul>
      <div class="sm-near-pages" hidden><button type="button" data-page="-1">Previous</button><button type="button" data-page="1">Next</button></div>
    </details>
    <div class="sm-legend" aria-label="Map legend"><strong>Score</strong><span><i></i>0–24</span><span><i></i>25–49</span><span><i></i>50–74</span><span><i></i>75–100</span><span><i class="sm-limit-key"></i>Village limits</span><span class="sm-point-legend" hidden><i class="sm-point-key"></i>Location only</span></div>
    <p class="sm-foot">Parcels and streets from <a href="https://sangis.co.sangamon.il.us/server/rest/services/TyleratENTParcels/MapServer/0" target="_blank" rel="noopener">Sangamon County GIS</a>.</p>`;
  const topList = document.createElement("details");
  topList.className = "sm-top";
  topList.innerHTML = "<summary>Top 10 in Chatham Township</summary><div></div>";
  if (top?.length) root.append(topList);
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
  const choices = find(".sm-hit-options");
  const nearby = find(".sm-nearby");
  const nearList = find(".sm-near-list");
  const nearCount = find(".sm-near-count");
  const nearPages = find(".sm-near-pages");
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
  let nearPage = 0;
  let nearTimer;
  let nearExtent = "";
  let nearRows = [];
  const nearPageSize = 6;
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
  // Use anchor points instead of bounding boxes. A lot can surround an entire
  // block or have disconnected pieces without owning the land between them.
  function updateNearby() {
    if (!nearby.open || !scale) return;
    const box = [...unproject(0, 0), ...unproject(width, height)];
    const extent = box.join(",");
    if (extent !== nearExtent) {
      nearExtent = extent;
      nearPage = 0;
      nearRows = [...parcels.values()].filter(p => p.pt[0] >= box[0] && p.pt[0] <= box[2] &&
        p.pt[1] >= box[1] && p.pt[1] <= box[3]);
      const distance = p => (p.pt[0] - center[0]) ** 2 + (p.pt[1] - center[1]) ** 2;
      nearRows.sort((a,b) => distance(a) - distance(b) || a.pin.localeCompare(b.pin));
    }
    const start = nearPage * nearPageSize;
    const rows = nearRows.slice(start, start + nearPageSize);
    nearCount.textContent = rows.length ? (start + 1) + "–" + (start + rows.length) + " of " +
      nearRows.length.toLocaleString("en-US") + " properties centered in this view, closest first." :
      "No property centers in this view. Zoom out or move the map.";
    const buttons = document.createDocumentFragment();
    for (const parcel of rows) {
      const item = document.createElement("li");
      const button = actionButton("Parcel " + parcel.pin + " · " + parcel.score + "/100", () => {
        choose(parcel.pin, true);
        focusScore();
      });
      const detail = document.createElement("span");
      const road = nearbyRoad(parcel);
      const dx = parcel.pt[0] - center[0], dy = parcel.pt[1] - center[1];
      const feet = Math.hypot(dx,dy) * 5280 / unitsPerMile;
      const direction = ["E","SE","S","SW","W","NW","N","NE"][(Math.round(Math.atan2(dy,dx) * 4 / Math.PI) + 8) % 8];
      const fromCenter = feet < 10 ? "At map center" : (feet < 1320 ? Math.round(feet / 10) * 10 + " ft" :
        (feet / 5280).toFixed(1) + " mi") + " " + direction + " of center";
      detail.textContent = [road && "Near " + road, fromCenter, parcel.path ? "" : "County location point"].filter(Boolean).join(" · ");
      if (detail.textContent) button.append(detail);
      item.append(button); buttons.append(item);
    }
    nearList.replaceChildren(buttons);
    nearPages.hidden = nearRows.length <= nearPageSize;
    nearPages.querySelector('[data-page="-1"]').disabled = start === 0;
    nearPages.querySelector('[data-page="1"]').disabled = start + rows.length === nearRows.length;
  }
  function nearbyRoad(parcel) {
    if (parcel.nearRoad !== undefined) return parcel.nearRoad;
    const [x,y] = parcel.pt;
    let best = (unitsPerMile * .35) ** 2;
    let name = "";
    for (const road of roads) {
      if (!road.name) continue;
      const dx = Math.max(road.b[0] - x, 0, x - road.b[2]);
      const dy = Math.max(road.b[1] - y, 0, y - road.b[3]);
      if (dx * dx + dy * dy >= best) continue;
      // Each county road entry is one continuous line in projected map units.
      road.vertices ??= road.d.match(/-?[\d.]+/g).map(Number);
      const coords = road.vertices;
      for (let i = 2; i < coords.length; i += 2) {
        const ax = coords[i-2], ay = coords[i-1], vx = coords[i]-ax, vy = coords[i+1]-ay;
        const length = vx*vx + vy*vy;
        const t = length ? clamp(((x-ax)*vx+(y-ay)*vy)/length,0,1) : 0;
        const distance = (x-ax-t*vx)**2 + (y-ay-t*vy)**2;
        if (distance < best) { best = distance; name = road.name; }
      }
    }
    parcel.nearRoad = name;
    return name;
  }
  function focusNearby() {
    nearby.open = true;
    updateNearby();
    nearby.querySelector("summary").focus({preventScroll:true});
    nearby.scrollIntoView({block:"start"});
  }
  nearby.addEventListener("toggle", updateNearby);
  for (const button of nearPages.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      nearPage += Number(button.dataset.page);
      updateNearby();
      nearList.querySelector("button")?.focus();
    });
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
    const labelSize = 0.875 * parseFloat(getComputedStyle(map).fontSize);
    ctx.font = "600 " + labelSize + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    function label(text, x, y, important = false) {
      const half = ctx.measureText(text).width / 2;
      const rect = [x-half-4,y-labelSize,x+half+4,y+5];
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
    if (nearby.open && box.join(",") !== nearExtent) {
      clearTimeout(nearTimer);
      nearTimer = setTimeout(updateNearby, 120);
    }
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
    topList.open = false;
    select(pin, focus);
    onChoose(pin);
  }
  function fitAll() {
    select("");
    highlightedStreet = "";
    choices.replaceChildren(); choices.hidden = true;
    center = midpoint(bounds); scale = baseScale;
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
      select.onchange = () => { if (select.value) { choose(select.value, false); focusScore(); } };
      label.append(select); choices.append(label); choices.hidden = false;
      if (document.activeElement === map && map.matches(":focus-visible")) select.focus();
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
  function focusScore() {
    const detail = document.getElementById("map-score-detail");
    if (!detail || detail.hidden) return;
    detail.focus({preventScroll:true});
    detail.scrollIntoView({block:"start"});
  }
  find('[data-view="score"]').onclick = focusScore;
  find('[data-view="utilities"]').onclick = () => {
    const panel = document.querySelector("#map-score-detail .property-utilities");
    panel?.focus({preventScroll:true});
    panel?.scrollIntoView({block:"start"});
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
    else if (event.key === "Enter") {
      hit(width/2,height/2);
      if (selected && choices.hidden) focusScore();
    }
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
    requestDraw();
  }
  function search(value) {
    const query = value.trim();
    if (!query) return [];
    const digits = query.replace(/[\s-]/g, "");
    if (/^\d+$/.test(digits)) {
      const normalized = digits.length === 10 ? digits.slice(0,4) + "0" + digits.slice(4) : digits;
      const matches = parcels.has(normalized) ? [parcels.get(normalized)] : [...parcels.values()].filter(p => p.pin.includes(digits));
      return matches.map(p => ({label: p.pin + " · " + p.score + "/100", kind:"parcel", pin:p.pin, choose: () => {
        if (selected === p.pin) { focusParcel(p); requestDraw(); }
        choose(p.pin);
      }}));
    }
    const key = normalizedName(query);
    const exact = streetNames.get(key);
    const matches = exact ? [exact] : [...streetNames.values()].filter(street => key && street.key.includes(key)).sort((a,b)=>a.name.localeCompare(b.name));
    return matches.map(street => ({label:street.name, kind:"street", choose:()=>focusStreet(street)}));
  }
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
  return {select, search, focusNearby, has: pin => parcels.has(pin)};
};
