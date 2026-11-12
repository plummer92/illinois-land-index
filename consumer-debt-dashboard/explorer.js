(() => {
  "use strict";
  const root = document.getElementById("county-explorer");
  const countySelect = root.querySelector("#compare-county");
  const metricSelect = root.querySelector("#compare-metric");
  const status = root.querySelector("#comparison-status");
  const table = root.querySelector("#comparison-table");
  const download = root.querySelector("#comparison-csv");
  const pct = new Intl.NumberFormat("en-US", {style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1});
  const dollars = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 0});
  const cents = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"});
  const points = new Intl.NumberFormat("en-US", {maximumFractionDigits: 2});
  let downloadUrl;

  function element(tag, text) {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  }

  function valueText(value, unit) {
    if (!Number.isFinite(value)) return "—";
    if (unit === "rate") return pct.format(value);
    return (Number.isInteger(value) ? dollars : cents).format(value);
  }

  function changeText(before, after, unit) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) return "—";
    const diff = after - before;
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    return sign + (unit === "rate" ? points.format(Math.abs(diff) * 100) + " pp" : valueText(Math.abs(diff), unit));
  }

  function metricDownload(rows, metric, key, first, last) {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    const header = ["place","geography","measure","unit",first,last,"change","change_unit","source","data_license"];
    const lines = rows.map(({place, before, after}) => {
      const rate = metric.unit === "rate";
      const multiplier = rate ? 100 : 1;
      const number = v => Number.isFinite(v) ? Number((v * multiplier).toFixed(6)) : "";
      const delta = Number.isFinite(before) && Number.isFinite(after) ? after - before : null;
      return [place.name, place.type, metric.label, rate ? "percent" : "USD", number(before), number(after), number(delta), rate ? "percentage points" : "USD", "Urban Institute, Debt in America 2025 and 2026", "https://opendatacommons.org/licenses/by/1-0/"];
    });
    const csv = [header, ...lines].map(row => row.map(v => '"' + String(v).replaceAll('"','""') + '"').join(",")).join("\r\n");
    downloadUrl = URL.createObjectURL(new Blob([csv + "\r\n"], {type:"text/csv;charset=utf-8"}));
    download.href = downloadUrl;
    download.download = "illinois-debt-" + key + "-" + first + "-to-" + last + ".csv";
    download.hidden = false;
  }

  function start(data) {
    const counties = data.places.filter(p => p.type === "county");
    const [first, last] = data.periods;
    for (const p of counties) countySelect.add(new Option(p.name, p.id));
    for (const [key, metric] of Object.entries(data.metrics)) metricSelect.add(new Option(metric.label, key));
    countySelect.value = "17167";
    metricSelect.value = "collections_rate";
    root.querySelector(".explorer-controls").hidden = false;
    root.querySelector("#comparison-results").hidden = false;
    status.hidden = true;

    function render() {
      const selected = countySelect.value;
      const key = metricSelect.value;
      const metric = data.metrics[key];
      const rows = data.places.map(place => ({
        place, before: place.values[first]?.[key], after: place.values[last]?.[key]
      }));
      const county = rows.find(r => r.place.id === selected);
      const benchmarks = rows.filter(r => r.place.type !== "county");
      const ranked = rows.filter(r => r.place.type === "county").sort((a,b) =>
        (b.after ?? -Infinity) - (a.after ?? -Infinity) || a.place.name.localeCompare(b.place.name));
      const definition = metric.definition + (metric.unit === "rate" ? " Change is in percentage points (pp)." : " Change is in dollars.");
      root.querySelector("#measure-description").textContent = definition;
      const cards = root.querySelector("#comparison-cards");
      cards.replaceChildren();
      for (const r of [county, ...benchmarks]) {
        const item = document.createElement("div");
        item.append(element("span", r.place.name), element("strong", valueText(r.after, metric.unit)),
          element("small", changeText(r.before, r.after, metric.unit) + " since August 2025"));
        cards.append(item);
      }
      table.caption.textContent = metric.label + " in August 2025 and August 2026, ranked by 2026 value";
      const body = table.tBodies[0];
      body.replaceChildren();
      for (const r of [...ranked, ...benchmarks]) {
        const tr = document.createElement("tr");
        if (r.place.id === selected) tr.className = "focus-county";
        const th = element("th",r.place.name.replace(/ County$/, ""));
        th.scope = "row";
        tr.append(th, element("td",valueText(r.before, metric.unit)), element("td",valueText(r.after, metric.unit)),
          element("td",changeText(r.before, r.after, metric.unit)));
        body.append(tr);
      }
      if (window.DebtMaps?.counties) {
        const mapRows = ranked.map(r => ({fips:r.place.id, name:r.place.name, value:r.after}));
        Promise.resolve(window.DebtMaps.counties("comparison-map", mapRows, v => valueText(v, metric.unit), {
          selectedFips:selected, title:metric.label, color:"#00796b", onSelect:fips => {
            if (countySelect.value !== fips) { countySelect.value = fips; render(); }
          }
        })).catch(() => { root.querySelector("#comparison-map").textContent = "Map unavailable. All county figures appear in the comparison table."; });
      } else {
        root.querySelector("#comparison-map").textContent = "Map unavailable. All county figures appear in the comparison table.";
      }
      metricDownload([...ranked, ...benchmarks], metric, key, first, last);
    }
    countySelect.addEventListener("change",render);
    metricSelect.addEventListener("change",render);
    render();
  }
  fetch("./data/processed/urban_county_comparison.json").then(r => {
    if (!r.ok) throw new Error("County data unavailable");
    return r.json();
  }).then(start).catch(() => {
    status.hidden = false;
    status.textContent = "The comparison could not load. Reload the page or use the Urban Institute source links below.";
  });
})();

(() => {
  const table = document.querySelector("#court-table");
  const select = document.querySelector("#court-measure");
  const status = document.querySelector("#court-status");

  async function loadFilings() {
    const response = await fetch("./data/processed/county_bankruptcies.json");
    if (!response.ok) throw new Error("Court figures unavailable");
    const {periods} = await response.json();
    const [previous, latest] = periods;
    const earlier = new Map(previous.counties.map(row => [row.fips, row]));
    function render() {
      const key = select.value;
      const rows = [...latest.counties].sort((a,b) => b[key] - a[key] || a.county.localeCompare(b.county));
      table.tBodies[0].replaceChildren();
      for (const county of rows) {
        const tr = table.tBodies[0].insertRow();
        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = county.county.replace(/ County$/, "");
        tr.append(th);
        const before = earlier.get(county.fips)?.[key];
        const delta = county[key] - before;
        tr.insertCell().textContent = before ?? "—";
        tr.insertCell().textContent = county[key];
        tr.insertCell().textContent = Number.isFinite(delta) ? (delta > 0 ? "+" : "") + delta : "—";
      }
      table.hidden = false;
      status.hidden = true;
    }
    select.addEventListener("change", render);
    render();
  }
  loadFilings().catch(() => {
    status.textContent = "Court figures could not load. The two federal court tables below contain the original counts.";
  });
})();
