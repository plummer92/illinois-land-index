const endpoint = "https://sangis.co.sangamon.il.us/server/rest/services/TyleratENTParcels/MapServer/0/query";
const locator = "https://sangis.co.sangamon.il.us/server/rest/services/Sangamon_Situs_Locator/GeocodeServer/findAddressCandidates";
const form = document.querySelector("#parcel-form");
const numberInput = document.querySelector("#parcel-number");
const result = document.querySelector("#result");
const statusLine = document.querySelector("#lookup-status");
let currentRequest;

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

async function locateAddress(address, city, signal) {
  const data = await countyQuery(locator, {
    f: "json", SingleLine: address, outSR: "4326", locationType: "rooftop",
    outFields: "Addr_type,City,AddNum", maxLocations: "10"
  }, signal);
  if (!Array.isArray(data.candidates)) throw new Error("County locator unavailable");
  const house = address.match(/^\d+[A-Za-z]?\b/)[0].toUpperCase();
  return data.candidates.filter(candidate =>
    candidate.score === 100 &&
    ["PointAddress", "Subaddress"].includes(candidate.attributes.Addr_type) &&
    String(candidate.attributes.AddNum).toUpperCase() === house &&
    candidate.attributes.City?.trim().toUpperCase() === city &&
    Number.isFinite(candidate.location?.x) && Number.isFinite(candidate.location?.y)
  );
}

async function lookup() {
  currentRequest?.abort();
  const controller = new AbortController();
  currentRequest = controller;
  history.replaceState(null, "");
  result.hidden = true;
  delete result.dataset.parcelNumber;
  document.querySelector("#lookup-score").hidden = true;
  numberInput.removeAttribute("aria-invalid");
  const input = numberInput.value.trim();
  const pin = normalizePin(input);
  const city = input.split(",")[1]?.trim().replace(/\s+(?:ILLINOIS|IL)(?:\s+\d{5})?$/i, "").toUpperCase();
  if (!pin && !(city && /^\d+[a-z]?\s+\S/i.test(input))) {
    numberInput.setAttribute("aria-invalid", "true");
    statusLine.textContent = "Enter a PIN with 10 or 11 digits, or a street address followed by a comma and city.";
    numberInput.focus();
    return;
  }
  statusLine.textContent = "Looking up the parcel in Sangamon County GIS…";
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const params = {f: "geojson", outFields: "PIN,TOTACRES", returnGeometry: "true", outSR: "4326"};
    let matchedAddress;
    if (pin) {
      params.where = "PIN = '" + pin + "'";
    } else {
      const matches = await locateAddress(input, city, controller.signal);
      if (currentRequest !== controller) return;
      if (matches.length !== 1) {
        statusLine.textContent = "The county could not identify one exact street address in that city. Check the address or use the county property search below.";
        return;
      }
      const match = matches[0];
      matchedAddress = match.address;
      Object.assign(params, {
        geometry: match.location.x + "," + match.location.y, inSR: "4326",
        geometryType: "esriGeometryPoint", spatialRel: "esriSpatialRelIntersects"
      });
    }
    const data = await countyQuery(endpoint, params, controller.signal);
    if (currentRequest !== controller) return;
    if (data.error || !Array.isArray(data.features)) throw new Error("County query error");
    const features = data.features;
    if (!features.length) {
      statusLine.textContent = "No parcel matched this search. Check the PIN or use the county property search below.";
      return;
    }
    const pins = new Set(features.map(feature => String(feature.properties?.PIN)));
    if (pins.size !== 1) {
      statusLine.textContent = "The county returned more than one parcel number. Confirm the PIN using the county property search below.";
      return;
    }
    const [matchedPin] = pins;
    if (!/^\d{11}$/.test(matchedPin) || (pin && pin !== matchedPin)) throw new Error("Invalid county PIN");
    // Separate shapes for one PIN can each repeat the full parcel acreage.
    const acreages = new Set(features.map(feature => feature.properties.TOTACRES).filter(value => Number.isFinite(value) && value > 0));
    const [acres] = acreages;
    document.querySelector("#result-title").textContent = "Parcel " + matchedPin;
    document.querySelector("#acreage").textContent = acreages.size === 1
      ? "County acreage · " + acres.toLocaleString(undefined, {maximumFractionDigits: 3}) + " acres"
      : acreages.size ? "County boundary records give different acreage figures. See the county tax record." : "The county record has no acreage figure.";
    const position = interiorMapPoint(features);
    document.querySelector("#county-tax").href = "https://tax.sangamonil.gov/SangamonCountyWeb/app/displayParcelSummary.action?parcelNumber=" + matchedPin;
    document.querySelector("#county-map").href = "https://gismaps.co.sangamon.il.us/tpv/?pin=" + matchedPin;
    const mapLink = document.querySelector("#open-map");
    mapLink.hidden = !position;
    if (position) {
      const url = new URL("../infrastructure-map/", location.href);
      url.searchParams.set("lon", position[0].toFixed(7));
      url.searchParams.set("lat", position[1].toFixed(7));
      mapLink.href = url.href;
    }
    result.hidden = false;
    result.dataset.parcelNumber = matchedPin;
    result.dispatchEvent(new Event("parcel-found"));
    history.replaceState({parcelLookupPin: matchedPin}, "");
    statusLine.textContent = matchedAddress
      ? "The county address point for " + matchedAddress + " falls on this parcel. Confirm the boundary in the county viewer."
      : "Found one county parcel.";
    if (!position) statusLine.textContent += " The county did not supply a usable boundary.";
  } catch {
    if (currentRequest === controller) {
      statusLine.textContent = "The county parcel service could not complete this lookup. Try again or open Sangamon County GIS below.";
    }
  } finally {
    clearTimeout(timer);
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  lookup();
});
document.querySelector("#example").addEventListener("click", () => {
  numberInput.value = "33290200001";
  lookup();
});
if (performance.getEntriesByType("navigation")[0]?.type === "back_forward" && history.state?.parcelLookupPin) {
  numberInput.value = history.state.parcelLookupPin;
  lookup();
}
