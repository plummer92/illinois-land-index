const endpoint = "https://sangis.co.sangamon.il.us/server/rest/services/TyleratENTParcels/MapServer/0/query";
const locator = "https://sangis.co.sangamon.il.us/server/rest/services/Sangamon_Situs_Locator/GeocodeServer/findAddressCandidates";
function normalizePin(input) {
  const digits = input.replace(/[-\s]/g, "");
  if (/^\d{11}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return digits.slice(0, 4) + "0" + digits.slice(4);
  return null;
}

// On a horizontal slice between vertex heights, crossing pairs bound interior
// intervals even when the parcel is concave or contains holes.
function interiorMapPoint(features) {
  const parts = features.flatMap(({geometry}) => geometry?.type === "Polygon" ? [geometry.coordinates] :
    geometry?.type === "MultiPolygon" ? geometry.coordinates : []);
  let widest = 0;
  let point;
  for (const rings of parts) {
    if (!rings.length) continue;
    const heights = [...new Set(rings.flat().map(vertex => vertex[1]))].sort((a, b) => a - b);
    if (heights.length < 2) continue;
    const middle = Math.floor(heights.length / 2);
    const y = (heights[middle - 1] + heights[middle]) / 2;
    const crossings = [];
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const [x1, y1] = ring[i - 1];
        const [x2, y2] = ring[i];
        if ((y1 > y) !== (y2 > y)) crossings.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 1; i < crossings.length; i += 2) {
      const width = crossings[i] - crossings[i - 1];
      if (width > widest) {
        widest = width;
        point = [(crossings[i] + crossings[i - 1]) / 2, y];
      }
    }
  }
  return point;
}

async function countyQuery(url, params, signal) {
  const response = await fetch(url + "?" + new URLSearchParams(params), {signal});
  if (!response.ok) throw new Error("County service unavailable");
  const data = await response.json();
  if (data.error) throw new Error("County query error");
  return data;
}

async function locateAddress(query, signal) {
  const data = await countyQuery(locator, {
    f: "json", SingleLine: query, outSR: "4326", locationType: "rooftop",
    outFields: "Addr_type,City,AddNum", maxLocations: 20
  }, signal);
  if (!Array.isArray(data.candidates)) throw new Error("County locator unavailable");
  const house = query.match(/^\d+[A-Za-z]?\b/i)?.[0].toUpperCase();
  const seen = new Set();
  return data.candidates.filter(candidate => {
    const key = [candidate.address,candidate.location?.x,candidate.location?.y].join("|");
    if (candidate.score !== 100 || !["PointAddress","Subaddress"].includes(candidate.attributes?.Addr_type) ||
        String(candidate.attributes.AddNum).toUpperCase() !== house || !Number.isFinite(candidate.location?.x) ||
        !Number.isFinite(candidate.location?.y) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findCountyParcels(pin, location, signal) {
  const params = {f:"geojson", outFields:"PIN,TOTACRES", returnGeometry:"true", outSR:"4326"};
  if (pin) params.where = "PIN = '" + pin + "'";
  else Object.assign(params,{geometry:location.x + "," + location.y, inSR:"4326",
    geometryType:"esriGeometryPoint", spatialRel:"esriSpatialRelIntersects"});
  const data = await countyQuery(endpoint,params,signal);
  if (!Array.isArray(data.features) || data.exceededTransferLimit) throw new Error("Incomplete county parcel search");
  const groups = new Map();
  for (const feature of data.features) {
    const found = String(feature.properties?.PIN);
    if (!/^\d{11}$/.test(found) || (pin && pin !== found)) throw new Error("Invalid county parcel number");
    if (!groups.has(found)) groups.set(found,[]);
    groups.get(found).push(feature);
  }
  return [...groups].map(([number,features]) => {
    const acres = new Set(features.map(f => f.properties.TOTACRES).filter(value => Number.isFinite(value) && value > 0));
    return {pin:number, acres:acres.size === 1 ? [...acres][0] : null, position:interiorMapPoint(features), features};
  });
}

// A full address stays in this tab and the official county geocoder request.
const propertyFinder = (() => {
  const form = document.getElementById("parcel-form");
  const input = document.getElementById("parcel-number");
  const status = document.getElementById("lookup-status");
  const choices = document.getElementById("lookup-choices");
  let current;
  let resolveTools;
  const ready = new Promise(resolve => { resolveTools = resolve; });
  function options(matches, prompt, run) {
    status.textContent = prompt;
    choices.replaceChildren();
    for (const item of matches) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = item.label;
      b.onclick = () => { choices.replaceChildren(); run(item); };
      choices.append(b);
    }
    choices.firstElementChild?.focus();
  }

  async function search() {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    const query = input.value.trim();
    if (!query) return;
    const pin = normalizePin(query);
    const active = () => current === controller && !controller.signal.aborted;
    choices.replaceChildren();
    status.textContent = "Finding your property…";
    const tools = await ready;
    if (!active()) return;
    tools.clear();
    let timer;
    function failure() {
      if (current === controller) status.textContent = "The county lookup could not finish. Try again, or search by parcel number.";
    }
    async function countyWork(task) {
      timer = setTimeout(() => controller.abort(),20000);
      try { return await task(); }
      catch { failure(); return null; }
      finally { clearTimeout(timer); }
    }
    function display(parcel, address) {
      if (!active()) return;
      status.textContent = address || "Found parcel " + parcel.pin + ".";
      tools.show(parcel,address);
    }
    async function resolveLot(match) {
      const lots = await countyWork(() => findCountyParcels(pin,match?.location,controller.signal));
      if (!active() || !lots) return;
      if (lots.length === 1) { display(lots[0],match?.address); return; }
      if (lots.length > 1) {
        options(lots.map(lot => ({...lot,label:"Parcel " + lot.pin})),"The address touches more than one parcel. Choose a parcel number.",lot => display(lot,match?.address));
      } else if (pin && tools.scored(pin)) {
        display({pin},null);
      } else status.textContent = "No parcel matched. Check the address and town, or enter the county parcel number.";
    }
    if (pin) {
      if (tools.mapped(pin)) display({pin},null);
      else await resolveLot();
      return;
    }
    if (/^\d+[a-z]?\s+\S/i.test(query)) {
      const matches = await countyWork(() => locateAddress(query,controller.signal));
      if (!active() || !matches) return;
      if (matches.length === 1) await resolveLot(matches[0]);
      else if (matches.length > 1) options(matches.map(m => ({...m,label:m.address})),"Which address did you mean?",resolveLot);
      else status.textContent = "No exact county address matched. Check the house number or add the town, for example 600 E Spruce St, Chatham.";
      return;
    }
    const matches = tools.search(query);
    function choose(match) {
      if (!active()) return;
      status.textContent = match.kind === "street" ? "Showing " + match.label + ". Choose a nearby property." : "Showing the selected parcel.";
      match.choose();
      if (match.kind === "street") tools.nearby();
      else tools.focus();
    }
    if (matches.length === 1) choose(matches[0]);
    else if (matches.length) options(matches.slice(0,25), matches.length > 25 ? "Showing the first 25 matches. Type more to narrow your search." : "Choose a match.",choose);
    else status.textContent = "No Chatham street or parcel number matched. For another Sangamon County town, enter the house number, street and town.";
  }
  form.addEventListener("submit",event => { event.preventDefault(); search(); });
  function receive() {
    let query;
    try { query = sessionStorage.getItem("ili-property-query"); sessionStorage.removeItem("ili-property-query"); } catch {}
    if (query?.trim()) { input.value = query.slice(0,input.maxLength); search(); }
  }
  receive();
  window.addEventListener("pageshow", e => { if (e.persisted) receive(); });
  window.addEventListener("popstate",() => { current?.abort(); choices.replaceChildren(); status.textContent = ""; });
  return {
    connect:resolveTools,
    cancel:() => { current?.abort(); choices.replaceChildren(); status.textContent = ""; }
  };
})();
