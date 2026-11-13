window.createChathamScoreMap = function createChathamScoreMap(container, data, onChoose) {
  const root = document.createElement("div");
  root.className = "score-map";
  root.innerHTML = `
    <div class="sm-controls">
      <label class="sm-picker">Find a mapped property
        <select><option value="">Show all ten properties</option></select>
      </label>
      <div class="sm-actions">
        <button type="button" data-action="out" aria-label="Zoom out">−</button>
        <button type="button" data-action="in" aria-label="Zoom in">+</button>
        <button type="button" data-action="fit">Fit all</button>
      </div>
    </div>
    <svg class="sm-canvas" role="img" aria-label="Map of ten Chatham Township properties. Use the property selector above to select the same parcels by keyboard.">
      <g class="sm-world"><path class="sm-town"/><path class="sm-waterbody"/><path class="sm-stream"/><path class="sm-streets"/><path class="sm-roads"/><path class="sm-highway"/><g class="sm-fields"></g></g>
      <g class="sm-labels"></g><g class="sm-markers"></g><g class="sm-scale"><path/><text text-anchor="middle"></text></g>
    </svg>
    <div class="sm-legend"><span><i class="sm-field-key"></i>Scored parcel</span><span><i class="sm-town-key"></i>Village limits</span><span>North ↑</span></div>
    <div class="sm-detail" aria-live="polite" hidden>
      <h3></h3><p class="sm-location"></p><p class="sm-facts"></p><ul class="sm-reasons"></ul>
      <a class="sm-county" target="_blank" rel="noopener">County parcel map ↗</a>
    </div>
    <p class="sm-foot">Boundaries and roads from <a target="_blank" rel="noopener" href="https://sangis.co.sangamon.il.us/server/rest/services/TyleratENTParcels/MapServer/0">Sangamon County GIS</a>.</p>`;
  container.replaceChildren(root);
  const find = selector => root.querySelector(selector);
  const map = find(".sm-canvas");
  const choose = find("select");
  const parcels = new Map(data.parcels.map(parcel => [parcel.pin, parcel]));
  const acres = value => Number(value).toLocaleString("en-US", {maximumFractionDigits: 2});
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const roadPriority = ["IL 4", "W Plummer Blvd", "Hemberger Rd", "E Loami Rd", "Union School Rd", "Curran Rd", "Snell Rd"];
  const priority = label => roadPriority.includes(label.name) ? roadPriority.indexOf(label.name) : 100;
  const labels = [{name: "Chatham", xy: data.ct, city: true}, ...data.labels.slice().sort((a, b) => priority(a) - priority(b))];
  let selected = "";
  let width = 0;
  let height = 0;
  let scale = 1;
  let baseScale = 1;
  let center = [0, 0];

  function svg(tag, attrs, parent) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    parent.appendChild(node);
    return node;
  }

  const layers = {
    town: data.town, waterbody: data.water.body, stream: data.water.creek,
    streets: data.roads.street, roads: data.roads.road, highway: data.roads.highway
  };
  for (const [name, path] of Object.entries(layers)) find(".sm-" + name).setAttribute("d", path || "");
  for (const parcel of data.parcels) {
    choose.add(new Option("#" + parcel.n + " · " + parcel.road + " · " + parcel.score + "/100", parcel.pin));
    svg("path", {d: parcel.geo, "data-pin": parcel.pin}, find(".sm-fields"));
  }

  function viewScale(bounds, padding) {
    return Math.min((width - 2 * padding) / Math.max(bounds[1][0] - bounds[0][0], 1),
      (height - 2 * padding) / Math.max(bounds[1][1] - bounds[0][1], 1));
  }

  function fit() {
    if (!width || !height) return;
    baseScale = viewScale(data.bounds, 27);
    const bounds = parcels.get(selected)?.bounds || data.bounds;
    center = bounds[0].map((value, i) => (value + bounds[1][i]) / 2);
    scale = selected ? clamp(viewScale(bounds, 47), baseScale, baseScale * 12) : baseScale;
  }

  function screenPoint([x, y]) {
    return [(x - center[0]) * scale + width / 2, (y - center[1]) * scale + height / 2];
  }

  function visibleMarkers() {
    const points = [];
    for (const parcel of data.parcels) {
      const [x, y] = screenPoint(parcel.pt);
      if (x >= 0 && x <= width && y >= 0 && y <= height) points.push({parcel, x, y, mx: x, my: y});
    }
    // Spread neighboring badges while keeping a leader line to each parcel.
    for (let pass = 0; pass < 10; pass++) {
      points.forEach((a, index) => {
        for (const b of points.slice(index + 1)) {
          const dx = b.mx - a.mx;
          const dy = b.my - a.my;
          const distance = Math.hypot(dx, dy);
          if (distance >= 32) continue;
          const shift = (32 - distance) / 2;
          const sx = distance ? shift * dx / distance : shift;
          const sy = distance ? shift * dy / distance : 0;
          a.mx -= sx;
          a.my -= sy;
          b.mx += sx;
          b.my += sy;
        }
      });
      for (const point of points) {
        point.mx = clamp(point.mx, 15, width - 15);
        point.my = clamp(point.my, 15, height - 15);
      }
    }
    return points;
  }

  function draw() {
    if (!width || !height) return;
    find(".sm-world").setAttribute("transform", "translate(" + width/2 + " " + height/2 + ") scale(" + scale + ") translate(" + -center[0] + " " + -center[1] + ")");
    const points = visibleMarkers();
    const markers = find(".sm-markers");
    markers.replaceChildren();
    for (const point of points) {
      if (Math.hypot(point.x - point.mx, point.y - point.my) > 2) {
        svg("line", {x1: point.x, y1: point.y, x2: point.mx, y2: point.my}, markers);
      }
    }
    for (const {parcel, mx, my} of points) {
      const marker = svg("g", {"data-pin": parcel.pin, class: parcel.pin === selected ? "selected" : "", transform: "translate(" + mx + " " + my + ")"}, markers);
      svg("circle", {r: 13}, marker);
      svg("text", {x: 0, y: 0}, marker).textContent = parcel.n;
    }
    const occupied = points.map(({mx, my}) => [mx - 16, my - 16, mx + 16, my + 16]);
    const miles = [.025, .05, .1, .25, .5, 1, 2, 5].filter(value => value * data.unitsPerMile * scale <= Math.min(95, width * .22)).pop() || .025;
    const length = miles * data.unitsPerMile * scale;
    const bar = find(".sm-scale");
    bar.setAttribute("transform", "translate(12 " + (height - 10) + ")");
    bar.querySelector("path").setAttribute("d", "M0,-4V0H" + length + "V-4");
    const text = bar.querySelector("text");
    text.setAttribute("x", length / 2);
    text.setAttribute("y", -5);
    text.textContent = miles + " mi";
    occupied.push([0, height - 30, length + 22, height]);
    const layer = find(".sm-labels");
    layer.replaceChildren();
    for (const label of labels) {
      const [x, y] = screenPoint(label.xy);
      if (x < 2 || x > width - 2 || y < 15 || y > height - 10) continue;
      const labelWidth = label.name.length * 6.5 + 6;
      const left = clamp(x - labelWidth / 2, 3, width - labelWidth - 3);
      const rect = [left, y - 12, left + labelWidth, y + 4];
      if (occupied.some(b => b[0] < rect[2] && b[2] > rect[0] && b[1] < rect[3] && b[3] > rect[1])) continue;
      occupied.push(rect);
      svg("text", {x: left + labelWidth / 2, y, "text-anchor": "middle", class: label.city ? "sm-city" : ""}, layer).textContent = label.name;
    }
  }

  function addReason(title, explanation) {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = title + ". ";
    item.append(heading, document.createTextNode(explanation));
    find(".sm-reasons").append(item);
  }

  function select(pin) {
    selected = parcels.has(pin) ? pin : "";
    const parcel = parcels.get(selected);
    choose.value = selected;
    find(".sm-detail").hidden = !parcel;
    root.querySelectorAll(".sm-fields path").forEach(path => path.classList.toggle("selected", path.dataset.pin === selected));
    if (parcel) {
      const points = parcel.points;
      const land = points.land;
      const size = land.at_least_1_acre + land.at_least_2_acres + land.at_least_5_acres + land.at_least_10_acres;
      const buy = points.buyability;
      const holdings = buy.owner_parcel_count_at_least_2 + buy.holdings_at_least_20_acres + buy.holdings_at_least_100_acres;
      const addresses = buy.mail_and_site_string_difference + buy.mail_string_excludes_chatham;
      const ownerType = buy.trust_estate ? buy.trust_estate + " for a trust or estate" : buy.individual_owner + " for an individual owner";
      find(".sm-detail h3").textContent = "#" + parcel.n + " · " + parcel.road + " · " + parcel.score + "/100";
      find(".sm-location").textContent = parcel.label + ". " + parcel.village + ".";
      find(".sm-facts").textContent = acres(parcel.ac) + " acres · " + parcel.cls + " · PIN " + parcel.pin;
      find(".sm-reasons").replaceChildren();
      addReason("Land fit " + parcel.land + "/40", land.farm_vacant_unimproved + " points for farmland, " + size + " for reaching all acreage thresholds through 10 acres, " + land.assessment_per_acre_under_or_at_5000 + " for assessed value of $5,000 or less per acre, and " + land.annual_tax_per_acre_under_or_at_150 + " for annual tax of $150 or less per acre.");
      addReason("Buyability " + parcel.buy + "/35", holdings + " points because the records group at least two parcels and 100 acres together, " + addresses + " because the mailing and site address text differs and the mailing text omits Chatham, and " + ownerType + ". Availability for sale is unverified.");
      addReason("Risk " + parcel.risk + "/25", "The model kept all " + points.risk.base + " starting points after checking the available property and tax records. Drainage, road access and utilities need separate verification.");
      find(".sm-county").href = "https://gismaps.co.sangamon.il.us/tpv/?pin=" + encodeURIComponent(parcel.pin);
    }
    fit();
    draw();
  }

  function userSelect(pin) {
    select(pin);
    onChoose(selected);
  }

  function zoomAt(factor, x = width / 2, y = height / 2) {
    const next = clamp(scale * factor, baseScale * .8, baseScale * 18);
    center = [center[0] + (x - width / 2) * (1 / scale - 1 / next), center[1] + (y - height / 2) * (1 / scale - 1 / next)];
    scale = next;
    draw();
  }

  choose.addEventListener("change", () => userSelect(choose.value));
  find("[data-action=fit]").addEventListener("click", () => userSelect(""));
  find("[data-action=in]").addEventListener("click", () => zoomAt(1.55));
  find("[data-action=out]").addEventListener("click", () => zoomAt(1/1.55));
  const touches = new Map();
  let drag = null;
  function touchSpan() {
    const [a, b] = [...touches.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  map.addEventListener("pointerdown", event => {
    if (event.button !== 0 || touches.size >= 2) return;
    map.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, [event.clientX, event.clientY]);
    drag = touches.size === 1
      ? {x: event.clientX, y: event.clientY, center: [...center], pin: event.target.closest("[data-pin]")?.dataset.pin, moved: false}
      : {span: touchSpan(), moved: true};
  });
  map.addEventListener("pointermove", event => {
    if (!touches.has(event.pointerId) || !drag) return;
    touches.set(event.pointerId, [event.clientX, event.clientY]);
    if (touches.size === 2) {
      const span = touchSpan();
      const [a,b] = [...touches.values()];
      const rect = map.getBoundingClientRect();
      if (drag.span > 0 && span > 0) zoomAt(span / drag.span, (a[0]+b[0])/2-rect.left, (a[1]+b[1])/2-rect.top);
      drag.span = span;
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) <= 5 && !drag.moved) return;
    drag.moved = true;
    map.classList.add("dragging");
    center = [drag.center[0] - dx / scale, drag.center[1] - dy / scale];
    draw();
  });
  function endTouch(event) {
    if (!touches.delete(event.pointerId) || !drag) return;
    if (event.type === "pointerup" && !drag.moved && drag.pin) userSelect(drag.pin);
    if (touches.size) {
      const [[x, y]] = [...touches.values()];
      drag = {x, y, center: [...center], moved: true};
    } else {
      map.classList.remove("dragging");
      drag = null;
    }
  }
  map.addEventListener("pointerup", endTouch);
  map.addEventListener("pointercancel", endTouch);
  map.addEventListener("wheel", event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = map.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * .007), event.clientX - rect.left, event.clientY - rect.top);
  }, {passive: false});
  function resize() {
    const rect = map.getBoundingClientRect();
    if (!rect.width || !rect.height || (width === rect.width && height === rect.height)) return;
    width = rect.width;
    height = rect.height;
    map.setAttribute("viewBox", "0 0 " + width + " " + height);
    fit();
    draw();
  }
  resize();
  new ResizeObserver(resize).observe(map);
  return {select};
};
