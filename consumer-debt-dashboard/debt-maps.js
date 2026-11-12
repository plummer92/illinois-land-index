/* Public county outlines are the same Census/us-atlas snapshot used by the water map. */
window.DebtMaps = (() => {
  function oriented(feature) {
    if (d3.geoArea(feature) <= 2 * Math.PI) return feature;
    const geometry = feature.geometry;
    const reversePolygon = rings => rings.map(ring => ring.slice().reverse());
    const coordinates = geometry.type === "Polygon"
      ? reversePolygon(geometry.coordinates)
      : geometry.coordinates.map(reversePolygon);
    return { ...feature, geometry: { ...geometry, coordinates } };
  }

  function createMap(id, title, features, legend) {
    const host = document.getElementById(id);
    host.replaceChildren();
    const width = 560, height = 325;
    const polygons = (features || []).map(oriented);
    if (!polygons.length) throw new Error("Map geometry is unavailable.");
    const projection = d3.geoMercator().fitExtent([[24, 10], [width - 24, height - 12]], {
      type: "FeatureCollection", features: polygons
    });
    const panel = d3.select(host).classed("debt-geography", true);
    panel.append("div").attr("class", "map-key").text(legend);
    const svg = panel.append("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "group").attr("aria-label", title);
    const layer = svg.append("g");
    const readout = panel.append("div").attr("class", "map-readout").attr("role", "status")
      .text("Select a feature to see its details.");
    const zoom = d3.zoom().scaleExtent([1, 12])
      .extent([[0, 0], [width, height]])
      .translateExtent([[-40, -40], [width + 40, height + 40]])
      .on("zoom", event => layer.attr("transform", event.transform));
    svg.call(zoom).on("wheel.zoom", null);
    const controls = panel.append("div").attr("class", "map-zoom").attr("role", "group").attr("aria-label", title + " zoom");
    for (const [label, text, action] of [
      ["Zoom in", "+", () => svg.call(zoom.scaleBy, 1.65)],
      ["Zoom out", "−", () => svg.call(zoom.scaleBy, 1 / 1.65)],
      ["Reset map", "Reset", () => svg.call(zoom.transform, d3.zoomIdentity)]
    ]) {
      controls.append("button").attr("type", "button").attr("aria-label", label).text(text).on("click", action);
    }
    return { host, projection, path: d3.geoPath(projection), polygons, layer, readout };
  }

  function interactive(selection, readout, describe, select) {
    const show = (event, item) => readout.text(describe(item));
    const activate = (event, item) => {
      show(event, item);
      if (select) select(item);
    };
    selection.attr("tabindex", 0).attr("role", "button").attr("aria-label", describe)
      .on("pointerenter focus", show).on("click", activate)
      .on("keydown", (event, item) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(event, item);
        }
      })
      .append("title").text(describe);
  }

  function areas(id, title, features, values, key, name, format, color, options = {}) {
    const [low, high] = d3.extent(Array.from(values.values()).filter(Number.isFinite));
    const domainExists = Number.isFinite(low);
    const scale = d3.scaleSequential(d3.interpolateRgb("#dcece9", color)).domain([low, high]);
    let range = "Values unavailable.";
    if (domainExists) {
      range = low === high ? `All available values: ${format(low)}.` : `${format(low)} to ${format(high)} (light to dark).`;
      if (Array.from(values.values()).some(value => !Number.isFinite(value))) range += " Gray indicates missing data.";
    }
    const map = createMap(id, title, features, range);
    const paths = map.layer.selectAll("path").data(map.polygons).join("path")
      .attr("d", map.path).attr("stroke", feature => key(feature) === options.selectedFips ? "#162e4b" : "#758b86")
      .attr("stroke-width", feature => key(feature) === options.selectedFips ? 2.5 : .7)
      .attr("fill", feature => {
        const value = values.get(key(feature));
        return Number.isFinite(value) ? scale(value) : "#e6e8e8";
      });
    paths.filter(feature => key(feature) === options.selectedFips).raise();
    interactive(paths, map.readout, feature => `${name(feature)} · ${format(values.get(key(feature)))}`,
      options.onSelect && (feature => options.onSelect(key(feature))));
  }

  let geometryRequest;
  function boundaries() {
    if (!geometryRequest) {
      geometryRequest = fetch("../infrastructure-map/data/research-map.json").then(response => {
        if (!response.ok) throw new Error("County outlines are unavailable.");
        return response.json();
      }).then(data => data.counties);
    }
    return geometryRequest;
  }

  async function counties(id, rows, format, options = {}) {
    const host = document.getElementById(id);
    try {
      const byId = new Map(rows.map(row => [row.fips, row]));
      const features = (await boundaries()).filter(feature => byId.has(feature.id));
      const values = new Map(rows.map(row => [row.fips, row.value]));
      areas(id, options.title || "County comparison", features, values, feature => feature.id,
        feature => byId.get(feature.id).name, format, options.color || "#245b9e", options);
    } catch (error) {
      host.textContent = "County map unavailable. The comparison figures are listed on this page.";
      console.warn("County map unavailable.", error);
    }
  }

  function credit(outlines, branches, lenders) {
    const map = createMap("credit-access-map", "Credit locations in Sangamon County", outlines,
      "Blue circles show full-service bank branches, gold circles show limited service and red diamonds show licensed credit locations.");
    map.layer.selectAll("path").data(map.polygons).join("path").attr("d", map.path)
      .attr("fill", "#edf3f2").attr("stroke", "#869c98");
    const dots = branches.map(row => ({
      row, color: row.service_type.toLowerCase().includes("full service") ? "#245b9e" : "#a76a07",
      symbol: d3.symbolCircle, label: `${row.institution} · ${row.branch} · ${row.service_type} · ${row.address}, ${row.city}`
    })).concat(lenders.map(row => ({
      row, color: "#aa442b", symbol: d3.symbolDiamond,
      label: `${row.name} · ${row.category} · ${row.address}, ${row.city}`
    }))).filter(({ row }) => Number.isFinite(row.longitude) && Number.isFinite(row.latitude));
    const markers = map.layer.selectAll(".credit-location").data(dots).join("path").attr("class", "credit-location")
      .attr("transform", ({ row }) => `translate(${map.projection([row.longitude, row.latitude])})`)
      .attr("d", item => d3.symbol().type(item.symbol).size(45)())
      .attr("fill", item => item.color).attr("stroke", "white").attr("stroke-width", .6);
    interactive(markers, map.readout, item => item.label);
  }

  return { areas, credit, counties, boundaries };
})();
