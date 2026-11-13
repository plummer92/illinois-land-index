(() => {
  const county = "https://sangis.co.sangamon.il.us/server/rest/services/";
  const width = 360;
  const height = 200;
  let active;

  async function query(layer, parameters, signal) {
    const url = new URL(county + layer + "/query");
    url.search = new URLSearchParams({f:"geojson", outSR:"4326", returnGeometry:"true", ...parameters});
    const response = await fetch(url, {signal});
    if (!response.ok) throw new Error("County service unavailable");
    const data = await response.json();
    if (!Array.isArray(data.features) || data.exceededTransferLimit) throw new Error("Incomplete county data");
    return data.features;
  }

  function svgElement(tag, attributes) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  }

  function mapFrame(polygons) {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const rings of polygons) {
      for (const ring of rings) {
        for (const [x, y] of ring) {
          west = Math.min(west, x); east = Math.max(east, x);
          south = Math.min(south, y); north = Math.max(north, y);
        }
      }
    }
    if (!(west < east && south < north)) throw new Error("No parcel outline");
    const lon = (west + east) / 2, lat = (south + north) / 2;
    const lonScale = Math.cos(lat * Math.PI / 180);
    // Match east-west and north-south ground distances at this parcel's latitude.
    const degreesPerPixel = Math.max((east - west) * lonScale / (width * .75), (north - south) / (height * .74));
    const dx = width / 2 * degreesPerPixel / lonScale, dy = height / 2 * degreesPerPixel;
    return {
      envelope: [lon - dx, lat - dy, lon + dx, lat + dy].join(","),
      project: ([x, y]) => [width / 2 + (x - lon) * lonScale / degreesPerPixel, height / 2 - (y - lat) / degreesPerPixel]
    };
  }

  function pathData(points, project) {
    return points.map((point, i) => {
      const [x, y] = project(point);
      return (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    }).join("");
  }

  function streetLayer(features, group, project) {
    const names = new Map();
    for (const {geometry, properties} of features) {
      const lines = geometry?.type === "MultiLineString" ? geometry.coordinates :
        geometry?.type === "LineString" ? [geometry.coordinates] : [];
      if (!lines.length) continue;
      group.append(svgElement("path", {d: lines.map(line => pathData(line, project)).join("")}));
      const name = properties?.DISPTEXT?.trim();
      if (!name) continue;
      // Distance to the segment, including streets with both endpoints outside the view.
      for (const line of lines) {
        let last;
        for (const vertex of line) {
          const [x, y] = project(vertex);
          if (last) {
            const dx = x - last[0], dy = y - last[1];
            const denominator = dx * dx + dy * dy;
            const t = denominator ? Math.max(0, Math.min(1, ((width / 2 - last[0]) * dx + (height / 2 - last[1]) * dy) / denominator)) : 0;
            const px = last[0] + t * dx, py = last[1] + t * dy;
            if (px >= 0 && px <= width && py >= 0 && py <= height) {
              const distance = Math.hypot(px - width / 2, py - height / 2);
              if (distance < (names.get(name) ?? Infinity)) names.set(name, distance);
            }
          }
          last = [x, y];
        }
      }
    }
    return [...names].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([name]) => name);
  }

  function caption(container, message) {
    const status = document.createElement("p");
    status.className = "lot-caption";
    status.textContent = message;
    container.append(status);
    return status;
  }

  function makeMap(pin, hasOutline) {
    return svgElement("svg", {viewBox:"0 0 " + width + " " + height, role:"img",
      "aria-label":(hasOutline ? "Lot outline" : "Location point") + " for parcel " + pin + ", north up"});
  }
  function pointMark(map) {
    map.append(svgElement("circle",{class:"preview-point",cx:width / 2,cy:height / 2,r:5}));
  }
  function northArrow(map) {
    const north = svgElement("text", {x:width - 12, y:19, "text-anchor":"end", class:"preview-north"});
    north.textContent = "↑ N";
    map.append(north);
  }

  window.showSnapshotParcelPreview = function(container,pin,geometry) {
    active?.abort();
    const parcel = geometry.parcels[pin];
    const [left,top,right,bottom] = parcel.b;
    const hasOutline = Boolean(parcel.d);
    // Use a fixed neighborhood extent only for a point. Every boundary fits the frame.
    const unitsPerPixel = hasOutline ? Math.max((right-left)/(width*.75),(bottom-top)/(height*.74)) : geometry.unitsPerMile*.12/width;
    const cx = hasOutline ? (left+right)/2 : parcel.pt[0], cy = hasOutline ? (top+bottom)/2 : parcel.pt[1];
    const x = cx-width*unitsPerPixel/2, y = cy-height*unitsPerPixel/2;
    const overlaps = ([l,t,r,b]) => r >= x && l <= x+width*unitsPerPixel && b >= y && t <= y+height*unitsPerPixel;
    const map = makeMap(pin,hasOutline);
    const world = svgElement("g",{transform:"scale(" + (1/unitsPerPixel) + ") translate(" + -x + " " + -y + ")"});
    // Combine paths to keep large rural parcels lightweight on a phone.
    const neighbors = Object.entries(geometry.parcels)
      .filter(([id,p]) => id !== pin && p.d && overlaps(p.b)).map(([,p]) => p.d).join("");
    const roads = geometry.roads.filter(road => overlaps(road.b)).map(road => road.d).join("");
    world.append(svgElement("path",{class:"preview-neighbors",d:neighbors,"vector-effect":"non-scaling-stroke"}),
      svgElement("path",{class:"preview-roads",d:roads,"vector-effect":"non-scaling-stroke"}));
    if (hasOutline) {
      world.append(svgElement("path",{class:"preview-outline",d:parcel.d,"fill-rule":"evenodd","vector-effect":"non-scaling-stroke"}));
    }
    map.append(world);
    if (!hasOutline) pointMark(map);
    northArrow(map);
    container.replaceChildren(map);
    caption(container,hasOutline ? "Lot outline · Sangamon County GIS" : "County location point only. A lot outline is unavailable.");
  };

  window.showCountyParcelPreview = async function(container,pin,features,position,unavailable) {
    active?.abort();
    container.replaceChildren();
    const controller = new AbortController();
    active = controller;
    const current = () => active === controller && container.isConnected;
    const matching = features.filter(f => String(f.properties?.PIN) === pin);
    const polygons = matching.flatMap(({geometry}) => geometry?.type === "MultiPolygon" ? geometry.coordinates :
      geometry?.type === "Polygon" ? [geometry.coordinates] : []);
    const point = position || matching.find(f => f.geometry?.type === "Point")?.geometry.coordinates;
    if (!polygons.length && !point?.every(Number.isFinite)) {
      caption(container,unavailable ? "The county lot outline could not load." : "No lot outline or location point is available for this parcel.");
      return;
    }
    const hasOutline = polygons.length > 0;
    const map = makeMap(pin,hasOutline);
    const roads = svgElement("g",{class:"preview-roads"});
    map.append(roads);
    // Provide a street frame around a point without drawing an inferred boundary.
    const localFrame = hasOutline ? polygons : [[[[point[0]-.0007,point[1]-.0005],[point[0]+.0007,point[1]+.0005]]]];
    const {envelope,project} = mapFrame(localFrame);
    if (hasOutline) {
      for (const rings of polygons) {
        map.append(svgElement("path",{class:"preview-outline","fill-rule":"evenodd",d:rings.map(ring => pathData(ring,project) + "Z").join("")}));
      }
    } else pointMark(map);
    northArrow(map);
    container.append(map);
    const label = hasOutline ? "Lot outline · Sangamon County GIS" : "County location point only. A lot outline is unavailable.";
    const status = caption(container,label);
    const timer = setTimeout(() => controller.abort(),10000);
    try {
      const streets = await query("SangamonCountyStreets/MapServer/2", {
        geometry:envelope, geometryType:"esriGeometryEnvelope", inSR:"4326",
        spatialRel:"esriSpatialRelIntersects", outFields:"DISPTEXT"
      },controller.signal);
      if (!current()) return;
      const names = streetLayer(streets,roads,project);
      if (names.length) status.append(" · Nearby roads: " + names.join(", "));
    } catch {
      // Road context is optional. The county outline or point is already visible.
    } finally {
      clearTimeout(timer);
    }
  };
})();
