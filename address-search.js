(() => {
  "use strict";
  const service = "https://sangis.co.sangamon.il.us/server/rest/services/Sangamon_Situs_Locator/GeocodeServer/suggest";
  const shortWords = {NORTH:"N",SOUTH:"S",EAST:"E",WEST:"W",NORTHEAST:"NE",NORTHWEST:"NW",SOUTHEAST:"SE",SOUTHWEST:"SW",STREET:"ST",ROAD:"RD",AVENUE:"AVE",BOULEVARD:"BLVD",DRIVE:"DR",LANE:"LN",COURT:"CT",PLACE:"PL",CIRCLE:"CIR"};
  function normalized(value) {
    return String(value).toUpperCase().replace(/[.,]/g," ").trim().split(/\s+/).map(word => shortWords[word] || word).join(" ");
  }
  function eligible(value) {
    return value.trim().length >= 5 && /^\d+[a-z]?\s+[a-z]/i.test(value.trim());
  }
  function matchingSuggestions(data, query) {
    if (!Array.isArray(data?.suggestions)) throw new Error("County suggestions unavailable");
    const words = normalized(query).split(" "), seen = new Set();
    const optional = new Set(Object.values(shortWords));
    function matches(label) {
      const candidate = label.split(" ");
      if (candidate[0] !== words[0]) return false;
      let next = 1;
      for (const word of words.slice(1)) {
        while (candidate[next] && !candidate[next].startsWith(word) && optional.has(candidate[next])) ++next;
        if (!candidate[next]?.startsWith(word)) return false;
        ++next;
      }
      return true;
    }
    return data.suggestions.filter(item => {
      if (item?.isCollection !== false || typeof item.text !== "string" || item.text.length > 160) return false;
      const label = normalized(item.text);
      if (!matches(label) || seen.has(label)) return false;
      seen.add(label);
      return true;
    }).slice(0,6).map(item => item.text);
  }
  function attach({input, list, status, onSelect}) {
    if (!input || !list || !status) return {cancel(){}};
    let timer, request, sequence = 0, options = [], active = -1;
    input.setAttribute("role","combobox");
    input.setAttribute("aria-autocomplete","list");
    input.setAttribute("aria-controls",list.id);
    input.setAttribute("aria-expanded","false");
    list.setAttribute("role","listbox");
    list.setAttribute("aria-label","County address suggestions");
    list.hidden = true;
    function close() {
      options = []; active = -1;
      list.replaceChildren(); list.hidden = true;
      input.setAttribute("aria-expanded","false");
      input.removeAttribute("aria-activedescendant");
    }
    function cancel() {
      ++sequence; clearTimeout(timer); request?.abort(); request = null;
      close(); status.textContent = "";
    }
    function select(index) {
      const value = options[index];
      if (!value) return;
      cancel(); input.value = value; onSelect(value);
    }
    function highlight(index) {
      active = index;
      [...list.children].forEach((item, i) => item.setAttribute("aria-selected",String(i === active)));
      if (active >= 0) {
        input.setAttribute("aria-activedescendant",list.children[active].id);
        list.children[active].scrollIntoView?.({block:"nearest"});
      } else input.removeAttribute("aria-activedescendant");
    }
    async function load(query, version) {
      const controller = new AbortController(); request = controller;
      const timeout = setTimeout(() => controller.abort(),8000);
      status.textContent = "Looking for county address suggestions…";
      try {
        const response = await fetch(service + "?" + new URLSearchParams({f:"json",text:query,maxSuggestions:10}),{signal:controller.signal});
        if (!response.ok) throw new Error("County suggestions unavailable");
        const result = await response.json();
        if (result.error) throw new Error("County suggestions unavailable");
        const values = matchingSuggestions(result,query);
        if (version !== sequence || input.value.trim() !== query || controller.signal.aborted) return;
        close(); options = values;
        if (!values.length) {
          status.textContent = "Keep typing the street and town, or use Find property to search.";
          return;
        }
        values.forEach((value,i) => {
          const item = document.createElement("div");
          item.id = list.id + "-" + i;
          item.className = "address-suggestion";
          item.setAttribute("role","option");
          item.setAttribute("aria-selected","false");
          item.textContent = value;
          item.addEventListener("pointerdown",event => event.preventDefault());
          item.addEventListener("click",() => select(i));
          list.append(item);
        });
        list.hidden = false;
        input.setAttribute("aria-expanded","true");
        status.textContent = values.length + " county address suggestion" + (values.length === 1 ? "" : "s") + ". Choose your address and town. Use arrow keys and Enter, or tap a suggestion.";
      } catch {
        if (version === sequence && input.value.trim() === query) {
          close();
          status.textContent = "Address suggestions are unavailable. You can still enter the full address and use Find property.";
        }
      } finally { clearTimeout(timeout); if (request === controller) request = null; }
    }
    input.addEventListener("input",() => {
      cancel();
      const query = input.value.trim(), version = sequence;
      if (eligible(query)) timer = setTimeout(() => load(query,version),350);
    });
    input.addEventListener("keydown",event => {
      if (event.isComposing) return;
      if (event.key === "Escape") { cancel(); return; }
      if (!options.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        highlight(event.key === "ArrowDown" ? (active + 1) % options.length : (active < 1 ? options.length - 1 : active - 1));
      } else if (event.key === "Enter" && active >= 0) {
        event.preventDefault(); select(active);
      } else if (event.key === "Tab") cancel();
    });
    input.addEventListener("blur",cancel);
    return {cancel};
  }
  window.ParcelAddressSearch = {attach,eligible,matchingSuggestions,normalized};
})();
