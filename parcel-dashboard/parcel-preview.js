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
    // Leave at least ~270 m of north-south context around even small urban lots.
    const degreesPerPixel = Math.max((east - west) * lonScale / width * 1.5, (north - south) / height * 1.5, .0025 / height);
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

  window.showCountyParcelPreview = async function (container, pin, existingFeatures) {
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const current = () => active === controller && container.isConnected;
    container.replaceChildren();
    if (!/^\d{11}$/.test(pin)) return;
    container.classList.add("county-parcel-preview");
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Loading county parcel outline…";
    const link = document.createElement("a");
    link.href = "https://gismaps.co.sangamon.il.us/tpv/?pin=" + pin;
    link.textContent = "Open this parcel in county GIS";
    container.append(status);
    const timer = setTimeout(() => controller.abort(), 15000);
    let map;
    try {
      const features = existingFeatures || await query("TyleratENTParcels/MapServer/0", {where:"PIN = '" + pin + "'", outFields:"PIN"}, controller.signal);
      if (!current()) return;
      if (!features.length || features.some(f => String(f.properties?.PIN) !== pin)) throw new Error("No matching parcel");
      const polygons = features.flatMap(({geometry}) => geometry?.type === "MultiPolygon" ? geometry.coordinates :
        geometry?.type === "Polygon" ? [geometry.coordinates] : []);
      const {envelope, project} = mapFrame(polygons);
      map = svgElement("svg", {viewBox:"0 0 360 200", role:"img", "aria-label":"Sangamon County boundary for parcel " + pin + ", north up"});
      const roads = svgElement("g", {class:"preview-roads"});
      map.append(roads);
      for (const rings of polygons) {
        map.append(svgElement("path", {class:"preview-outline", "fill-rule":"evenodd", d:rings.map(ring => pathData(ring, project) + "Z").join("")}));
      }
      const north = svgElement("text", {x:"346", y:"19", "text-anchor":"end", class:"preview-north"});
      north.textContent = "↑ N";
      map.append(north);
      container.prepend(map);
      status.textContent = "County parcel outline · loading nearby roads…";
      const streets = await query("SangamonCountyStreets/MapServer/2", {
        geometry:envelope, geometryType:"esriGeometryEnvelope", inSR:"4326",
        spatialRel:"esriSpatialRelIntersects", outFields:"DISPTEXT"
      }, controller.signal);
      if (!current()) return;
      const names = streetLayer(streets, roads, project);
      status.textContent = "Sangamon County GIS · Parcel outline" + (names.length ? " · Nearby roads: " + names.join(", ") : "");
    } catch {
      if (!current()) return;
      status.textContent = map ? "Sangamon County GIS · Parcel outline. Nearby roads could not load." : "The county parcel outline could not load.";
      if (!map) container.append(link);
    } finally {
      clearTimeout(timer);
    }
  };
})();
