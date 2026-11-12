(() => {
  const root = document.getElementById("housing-access");
  const select = root.querySelector("#housing-period");
  const periodTable = root.querySelector("#housing-period-table");
  const historyTable = root.querySelector("#housing-quarter-table");
  const status = root.querySelector("#housing-loading");
  const numbers = new Intl.NumberFormat("en-US");
  const quarters = ["January–March", "April–June", "July–September", "October–December"];
  const cumulative = ["January–March", "January–June", "January–September", "January–December"];
  const quarterEnds = ["March 31", "June 30", "September 30", "December 31"];
  const measures = {eviction:"Eviction filings", foreclosure:"Foreclosure filings"};

  function addRow(body, period, counts, maximum) {
    const row = body.insertRow();
    const header = document.createElement("th");
    header.scope = "row";
    header.textContent = period;
    row.append(header);
    for (const key of Object.keys(measures)) {
      const cell = row.insertCell();
      cell.textContent = numbers.format(counts[key]);
      if (maximum > 0) {
        const track = document.createElement("span");
        track.className = "filing-bar " + key;
        track.setAttribute("aria-hidden","true");
        track.style.width = (100 * counts[key] / maximum) + "%";
        cell.append(track);
      }
    }
  }

  function start(data) {
    const observations = data.quarters;
    const last = observations.at(-1);
    const years = [...new Set(observations.map(row => row.year))].reverse();
    const periods = {
      ytd: {label:"Year to date · " + cumulative[last.quarter - 1], first:1, last:last.quarter},
      quarter: {label:"Latest quarter · " + quarters[last.quarter - 1], first:last.quarter, last:last.quarter},
      year: {label:"Full calendar years", first:1, last:4}
    };
    if (last.quarter === 1 || last.quarter === 4) delete periods.ytd;
    for (const [key, period] of Object.entries(periods)) select.add(new Option(period.label,key));

    function render() {
      const range = periods[select.value];
      const span = range.first === range.last ? quarters[range.last - 1] : cumulative[range.last - 1];
      const rows = [];
      for (const year of years) {
        const matching = observations.filter(row => row.year === year && row.quarter >= range.first && row.quarter <= range.last);
        if (matching.length !== range.last - range.first + 1) continue;
        rows.push({
          year, label:span + " " + year,
          eviction:matching.reduce((sum,row) => sum + row.eviction,0),
          foreclosure:matching.reduce((sum,row) => sum + row.foreclosure,0)
        });
      }
      const [latest, prior] = rows;
      const cards = root.querySelector("#housing-cards");
      cards.replaceChildren();
      for (const [key, label] of Object.entries(measures)) {
        const card = document.createElement("div");
        const heading = document.createElement("span");
        heading.textContent = label + " · " + latest.label;
        const count = document.createElement("strong");
        count.textContent = numbers.format(latest[key]);
        card.append(heading,count);
        if (prior) {
          const note = document.createElement("small");
          const change = latest[key] - prior[key];
          const percent = prior[key] ? " (" + (Math.abs(change) / prior[key] * 100).toFixed(1) + "%)" : "";
          const direction = change < 0 ? "fewer" : "more";
          note.textContent = change === 0 ? "Unchanged from " + prior.label :
            numbers.format(Math.abs(change)) + " " + direction + percent + " than " + prior.label;
          card.append(note);
        }
        cards.append(card);
      }
      periodTable.caption.textContent = "New filings in " + span + " of each year";
      periodTable.tBodies[0].replaceChildren();
      const maximum = Math.max(...rows.flatMap(row => [row.eviction,row.foreclosure]));
      rows.forEach(row => addRow(periodTable.tBodies[0], row.label, row, maximum));
    }

    for (const row of observations.slice().reverse()) {
      addRow(historyTable.tBodies[0],quarters[row.quarter - 1] + " " + row.year,row);
    }
    root.querySelector("#housing-vintage").textContent = "In the quarter ending " + quarterEnds[last.quarter - 1] + ", " + last.year +
      ", Sangamon County recorded " + numbers.format(last.eviction) + " new eviction cases and " +
      numbers.format(last.foreclosure) + " new foreclosure cases.";
    select.addEventListener("change",render);
    render();
    status.hidden = true;
    root.querySelector("#housing-results").hidden = false;
  }

  fetch("./data/processed/sangamon_housing_filings.json")
    .then(response => {
      if (!response.ok) throw new Error("Filing series unavailable");
      return response.json();
    })
    .then(start)
    .catch(() => {
      status.textContent = "The filing counts could not load. Open the Illinois Courts quarterly reports below.";
    });
})();
