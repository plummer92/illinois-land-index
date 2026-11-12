(() => {
  const number = new Intl.NumberFormat("en-US", {maximumFractionDigits: 1});
  const dollars = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 1, minimumFractionDigits: 0});
  const dateLabel = (value, options) => new Date(value + "T12:00:00Z").toLocaleDateString("en-US", {...options, timeZone: "UTC"});
  const monthLabel = key => dateLabel(key + "-01", {year: "numeric", month: "long"});
  const fullDate = key => dateLabel(key, {year: "numeric", month: "short", day: "numeric"});
  const fmt = (value, formatter) => value == null ? "—" : formatter.format(value);

  function tableRow(body, label, values) {
    const row = body.insertRow();
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = label;
    row.append(heading);
    for (const value of values) row.insertCell().textContent = value;
  }

  function showTransfers(data) {
    const area = document.getElementById("sales-area");
    const select = document.getElementById("sales-month");
    const cards = document.getElementById("sales-cards");
    const table = document.getElementById("price-bands");
    const bandNames = new Map(data.bands.map(band => [band.id,band.label]));
    for (const period of data.areas.county.months.slice().reverse()) {
      select.add(new Option(monthLabel(period.month) + (period.partial ? " (partial)" : ""),period.month));
    }
    select.value = data.latest_full_month;
    document.getElementById("sales-vintage").textContent = "MyDec release " + fullDate(data.release_date) +
      ". County recordings through " + fullDate(data.latest_recorded) + ".";
    function render() {
      const period = data.areas[area.value].months.find(row => row.month === select.value);
      const geography = area.selectedOptions[0].text;
      const end = period.partial ? " · partial through " + fullDate(data.latest_recorded) : "";
      table.caption.textContent = geography + " · " + monthLabel(period.month) + end;
      cards.replaceChildren();
      for (const [label,value] of [["Recorded sales",fmt(period.count,number)],["Median recorded price",fmt(period.median,dollars)],["Total recorded dollars",fmt(period.volume,dollars)]]) {
        const card = document.createElement("div");
        const title = document.createElement("span");
        const amount = document.createElement("strong");
        title.textContent = label;
        amount.textContent = value;
        card.append(title,amount);
        cards.append(card);
      }
      const body = table.tBodies[0];
      body.replaceChildren();
      for (const band of period.bands) {
        tableRow(body,bandNames.get(band.id),[fmt(band.count,number),fmt(band.median,dollars),fmt(band.volume,dollars)]);
      }
    }
    select.addEventListener("change",render);
    area.addEventListener("change",render);
    render();
    document.getElementById("sales-content").hidden = false;
  }

  function showListings(data) {
    const current = data.months.at(-1);
    const summary = document.getElementById("listing-summary");
    summary.caption.textContent = monthLabel(current.month) + " · all price ranges";
    document.getElementById("listing-vintage").textContent = "Monthly listing figures through " + monthLabel(current.month) +
      ". The Chatham figure covers ZIP 62629.";
    const values = row => [fmt(row.median_days_on_market,number),fmt(row.median_listing_price,dollars),fmt(row.active_listing_count,number)];
    tableRow(summary.tBodies[0],"Sangamon County",values(current));
    tableRow(summary.tBodies[0],"Chatham ZIP 62629",values(data.chatham_zip));
    const history = document.getElementById("listing-history").tBodies[0];
    for (const row of data.months.slice(-12).reverse()) {
      tableRow(history,monthLabel(row.month),row.quality_flag === 1 ? ["Flagged","—","—"] : values(row));
    }
    document.getElementById("listing-content").hidden = false;
  }

  async function load(file, render, status, fallback) {
    try {
      const response = await fetch("./data/processed/" + file);
      if (!response.ok) throw new Error("Data unavailable");
      render(await response.json());
    } catch {
      document.getElementById(status).textContent = fallback;
    }
  }
  load("sangamon_home_sales.json",showTransfers,"sales-vintage","Sales totals could not load. Open the MyDec source below.");
  load("sangamon_listing_market.json",showListings,"listing-vintage","Listing figures could not load. Open the Realtor.com data library below.");
})();
