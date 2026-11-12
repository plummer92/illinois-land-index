(() => {
  "use strict";
  const container = document.getElementById("listing-export-tool");
  if (!container) return;

  const required = ["listing_id", "county_fips", "status", "list_date", "list_price", "close_date", "close_price", "cdom"];
  const agentFields = ["listing_agent_id", "listing_agent_name", "co_list_agent_id", "co_list_agent_name"];
  const fields = [...required, ...agentFields];
  const bands = ["Under $150,000", "$150,000–<$250,000", "$250,000–<$350,000", "$350,000–<$500,000", "$500,000 and up"];
  const ceilings = [150000, 250000, 350000, 500000, Infinity];
  const money = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 0});
  const numbers = new Intl.NumberFormat("en-US");
  const day = 86400000;

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function inputLabel(parent, title, type) {
    const label = element("label", title);
    const input = element("input");
    input.type = type;
    label.append(input);
    parent.append(label);
    return input;
  }

  container.append(element("p", "Use a residential listing export for Sangamon County. Choose the date the file was produced. The active listing ages and closed sales below reflect that snapshot."));
  const format = element("details");
  format.append(element("summary", "CSV columns and definitions"));
  format.append(element("p", "Use one row per residential listing as of the snapshot. Include these column headers in any order. Blank cells are allowed where a field does not apply."));
  format.append(element("code", required.join(",")));
  format.append(element("p", "Use a stable listing ID and county FIPS 17167. Accepted statuses are Active or Closed. Use YYYY-MM-DD dates and positive dollar prices. For active listings, enter the original list date and current ask. For closings, enter the close date, sale price and reported cumulative days on market (cdom). Leave cdom blank if unknown."));
  format.append(element("p", "Optional individual listing-agent columns for closed sales"));
  format.append(element("code", agentFields.join(",")));
  format.append(element("p", "Include all four agent columns for that view. Use stable individual IDs, a primary agent and up to one co-listing agent. Leave both co-list cells blank for a sole listing agent. An agent summary requires complete credits on every qualifying closing and your confirmation that teams and offices have been excluded."));
  container.append(format);
  const controls = element("div");
  controls.className = "explorer-controls";
  const fileInput = inputLabel(controls, "Residential listing CSV", "file");
  fileInput.accept = ".csv,text/csv";
  const snapshot = inputLabel(controls, "Snapshot date (closed period ends)", "date");
  const since = inputLabel(controls, "Closed period begins", "date");
  const today = new Date();
  const todayIso = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  snapshot.max = since.max = todayIso;
  container.append(controls);
  const attribution = element("label");
  const rank = element("input");
  rank.type = "checkbox";
  attribution.append(rank, " Include individual listing-agent volume. This export identifies every listing-side agent on each qualifying closing, includes no teams or offices and has at most two agents per sale.");
  const actions = element("p");
  const run = element("button", "Analyze CSV");
  run.type = "button";
  const clear = element("button", "Clear results");
  clear.type = "button";
  actions.append(run, document.createTextNode(" "), clear);
  const status = element("p");
  status.setAttribute("role", "status");
  const results = element("div");
  container.append(attribution, actions, status, results);

  function dateValue(input) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || input < "1800-01-01") return null;
    const value = Date.parse(input + "T00:00:00Z");
    return Number.isFinite(value) && new Date(value).toISOString().startsWith(input) ? value : null;
  }

  function price(input) {
    if (!/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(input)) return null;
    const amount = Number(input.replace(/[$,]/g, ""));
    return amount > 0 && Number.isSafeInteger(Math.round(amount * 100)) ? amount : null;
  }

  function median(series) {
    if (!series.length) return "—";
    series.sort((a, b) => a - b);
    const middle = Math.floor(series.length / 2);
    return numbers.format(series.length % 2 ? series[middle] : (series[middle - 1] + series[middle]) / 2);
  }

  function table(caption, headers, rows) {
    const wrapper = element("div");
    wrapper.className = "listing-export-table-wrap";
    const node = element("table");
    node.append(element("caption", caption));
    const head = node.createTHead().insertRow();
    for (const title of headers) {
      const th = element("th", title);
      th.scope = "col";
      head.append(th);
    }
    const body = node.createTBody();
    for (const [first, ...rest] of rows) {
      const row = body.insertRow();
      const th = element("th", first);
      th.scope = "row";
      row.append(th);
      for (const content of rest) row.insertCell().textContent = content;
    }
    wrapper.append(node);
    return wrapper;
  }

  function parse(text) {
    const [columns, ...raw] = d3.csvParseRows(text.replace(/^\uFEFF/, ""));
    if (!columns) throw new Error("The CSV is empty.");
    const header = columns.map(name => name.trim().toLowerCase());
    const missing = required.filter(name => !header.includes(name));
    if (missing.length) throw new Error("Missing CSV columns: " + missing.join(", ") + ".");
    if (new Set(header).size !== header.length) throw new Error("The CSV contains duplicate column names.");
    const indices = fields.map(field => header.indexOf(field));
    const listings = new Map();
    const skipped = {geography: 0, missingId: 0, duplicates: 0, otherStatus: 0, outside: 0, invalid: 0};
    for (const row of raw) {
      if (!row.some(value => value.trim())) continue;
      if (row.length !== header.length) throw new Error("A CSV row has the wrong number of columns. Quote fields containing commas.");
      const selected = indices.map(index => index < 0 ? "" : row[index].trim());
      const [id, county] = selected;
      selected[2] = selected[2].toLowerCase();
      if (county !== "17167") { skipped.geography++; continue; }
      if (!id) { skipped.missingId++; continue; }
      const prior = listings.get(id);
      if (prior) {
        if (!prior.every((v, i) => v === selected[i])) throw new Error("Conflicting rows share a listing ID. Supply one snapshot row per listing before analyzing.");
        skipped.duplicates++;
      } else {
        listings.set(id, selected);
      }
    }
    return {listings, skipped, hasAgents: agentFields.every(field => header.includes(field))};
  }

  function analyze(data, start, end) {
    const buckets = bands.map(() => ({ages: [], closed: 0, days: []}));
    const credited = new Map();
    const {listings, skipped} = data;
    let closedTotal = 0;
    let agentDataComplete = data.hasAgents;
    for (const row of listings.values()) {
      const [, , state, listed, ask, closed, sold, cdom, primary, name, co, coName] = row;
      if (state !== "active" && state !== "closed") { skipped.otherStatus++; continue; }
      const active = state === "active";
      const date = dateValue(active ? listed : closed);
      const amount = price(active ? ask : sold);
      const listDate = listed ? dateValue(listed) : null;
      if (date === null || amount === null || date > end || (active && (closed || sold)) ||
          (!active && listed && (listDate === null || listDate > date))) { skipped.invalid++; continue; }
      if (!active && date < start) { skipped.outside++; continue; }
      const bucket = buckets[ceilings.findIndex(maximum => amount < maximum)];
      if (active) {
        bucket.ages.push((end - date) / day);
        continue;
      }
      bucket.closed++;
      closedTotal++;
      if (/^\d+$/.test(cdom) && Number.isSafeInteger(Number(cdom))) bucket.days.push(Number(cdom));
      if (!rank.checked || !agentDataComplete) continue;
      if (!primary || !name || Boolean(co) !== Boolean(coName) || primary === co) {
        agentDataComplete = false;
        continue;
      }
      // Keep half-cents as integers until display so odd-cent co-list sales split equally.
      const cents = Math.round(amount * 100);
      const agents = co ? [[primary, name], [co, coName]] : [[primary, name]];
      for (const [id, agentName] of agents) {
        const agent = credited.get(id) || {name: agentName, halfCents: 0, appearances: 0};
        if (agent.name !== agentName) agentDataComplete = false;
        agent.halfCents += co ? cents : cents * 2;
        agent.appearances++;
        credited.set(id, agent);
      }
    }
    const used = buckets.reduce((n, bucket) => n + bucket.ages.length + bucket.closed, 0);
    const summary = [used + " listings included", skipped.geography + " outside county or missing county",
      skipped.otherStatus + " other status", skipped.outside + " closings before the period",
      skipped.invalid + " invalid prices, dates or status details", skipped.missingId + " missing IDs",
      skipped.duplicates + " extra identical rows"].join(" · ");
    status.textContent = summary + ".";
    if (!used) return;
    results.append(table("Active listings on " + snapshot.value + " · current asking price",
      ["Asking price", "Active listings", "Median days since listing"],
      buckets.map((b, i) => [bands[i], numbers.format(b.ages.length), median(b.ages)])));
    results.append(table("Closed sales from " + since.value + " through " + snapshot.value + " · sale price",
      ["Sale price", "Closed sales", "With reported CDOM", "Median CDOM (days)"],
      buckets.map((b, i) => [bands[i], numbers.format(b.closed), numbers.format(b.days.length), median(b.days)])));
    results.append(element("p", "A dash means no usable observations. The sample counts show how many records contribute to each median. Active ages use the original listing date supplied. Closed times use the source’s reported cumulative days on market."));
    if (!rank.checked || !closedTotal) return;
    if (!agentDataComplete) {
      results.append(element("p", "Agent volume is unavailable. Each qualifying closing needs complete and consistent individual agent IDs and names for listing-side credit."));
      return;
    }
    const sorted = [...credited.values()].sort((a, b) => b.halfCents - a.halfCents || a.name.localeCompare(b.name));
    results.append(table("Listing-agent dollar volume in this export · " + since.value + " through " + snapshot.value,
      ["Individual listing agent", "Closed listings credited", "Listing-side dollar volume"],
      sorted.map(agent => [agent.name, numbers.format(agent.appearances), money.format(agent.halfCents / 200)])));
    results.append(element("p", "A sole listing agent receives full sale-price credit. Two co-listing agents each receive half. Both receive a listing count, so adding agent counts can count a sale twice. Dollar volume measures sales represented in this file. It does not measure commissions or establish a countywide ranking."));
  }

  let revision = 0;
  function reset() {
    revision++;
    results.replaceChildren();
    status.textContent = "";
  }
  for (const input of [fileInput, snapshot, since, rank]) input.addEventListener("change", reset);
  clear.addEventListener("click", () => {
    reset();
    fileInput.value = "";
    snapshot.value = "";
    since.value = "";
    rank.checked = false;
  });
  run.addEventListener("click", async () => {
    reset();
    const token = revision;
    try {
      const file = fileInput.files[0];
      if (!file) throw new Error("Choose a CSV file first.");
      if (file.size > 20 * 1024 * 1024) throw new Error("Choose a county export under 20 MB.");
      const end = dateValue(snapshot.value);
      const start = dateValue(since.value);
      if (end === null || start === null || start > end || snapshot.value > todayIso) {
        throw new Error("Enter valid dates. The closed period must begin on or before the snapshot, and the snapshot cannot be in the future.");
      }
      const text = await file.text();
      if (token !== revision) return;
      analyze(parse(text), start, end);
    } catch (error) {
      if (token === revision) status.textContent = error.message;
    }
  });
})();
