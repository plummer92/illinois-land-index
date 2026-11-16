(() => {
  "use strict";
  const endpoint = "https://illinois-land-index-tax-lookup.theplummer92.chatgpt.site/tax-breakdown";
  const categories = [
    {id:"schools",label:"Schools & community college"},
    {id:"village",label:"Village / city"},
    {id:"county",label:"County"},
    {id:"other",label:"Other districts"}
  ];
  const money = value => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value/100);
  function validate(value,pin) {
    if (!/^\d{11}$/.test(String(pin)) || value?.pin !== pin) return null;
    const retrieved = Date.parse(value.fetched_at);
    if (!Number.isFinite(retrieved) || retrieved > Date.now()+60000 || Date.now()-retrieved > 26*60*60*1000) return null;
    if (value.status === "no_bill") return {status:"no_bill",pin,fetched_at:value.fetched_at};
    if (value.status !== "ok" || !Number.isInteger(value.tax_year) || value.tax_year < 1990 || value.tax_year > new Date().getFullYear() ||
        !Number.isSafeInteger(value.total_cents) || value.total_cents < 0 || !Array.isArray(value.districts) || !value.districts.length || value.districts.length > 100) return null;
    const seen = new Set(); let total = 0;
    for (const district of value.districts) {
      if (typeof district?.name !== "string" || !district.name.trim() || district.name.length > 150 || seen.has(district.name) ||
          !categories.some(category => category.id === district.category) || !Number.isSafeInteger(district.amount_cents) || district.amount_cents < 0) return null;
      seen.add(district.name); total += district.amount_cents;
    }
    if (!Number.isSafeInteger(total) || total !== value.total_cents) return null;
    return {status:"ok",pin,tax_year:value.tax_year,total_cents:total,fetched_at:value.fetched_at,
      districts:value.districts.map(({name,amount_cents,category})=>({name,amount_cents,category}))};
  }
  function groups(value) {
    return categories.map(category => {
      const rows = value.districts.filter(row => row.category === category.id);
      const amount_cents = rows.reduce((sum,row)=>sum+row.amount_cents,0);
      return {...category,amount_cents,percent:value.total_cents ? amount_cents/value.total_cents*100 : 0,rows};
    });
  }
  const create = (tag,text,className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function render(target,value) {
    const retrieved = new Date(value.fetched_at).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})+" Central";
    if (value.status === "no_bill") {
      target.replaceChildren(create("p","The county returned no tax bill for this parcel. This is different from a bill showing $0. Use the county links below to check the record.","tax-inline-message"),create("p","Source: Sangamon County tax-bill detail · Checked "+retrieved+".","local-decision-source"));
      return;
    }
    const period = create("p","Tax year " + value.tax_year,"tax-inline-year");
    const total = create("div",undefined,"tax-inline-total");
    total.append(create("span","Total property tax billed"),create("strong",money(value.total_cents)));
    const summary = create("div",undefined,"tax-inline-groups");
    for (const group of groups(value)) {
      const row = create("div",undefined,"tax-inline-group tax-group-"+group.id);
      const label = create("div",undefined,"tax-inline-group-label");
      label.append(create("span",group.label),create("strong",money(group.amount_cents)));
      const bar = create("div",undefined,"tax-inline-track"); bar.setAttribute("aria-hidden","true");
      const fill = create("span"); fill.style.width = group.percent.toFixed(4)+"%"; bar.append(fill);
      row.append(label,bar,create("small",group.rows.length ? (value.total_cents ? group.percent.toFixed(1)+"% of the bill" : "No tax billed in this category") : "None categorized here; see the full district list"));
      summary.append(row);
    }
    const detail = create("details",undefined,"tax-inline-districts");
    detail.append(create("summary","See every district’s amount"));
    const table = create("table");
    table.append(create("caption","County district labels and tax amounts for tax year "+value.tax_year));
    const head = create("thead"),header = create("tr"),nameHead=create("th","Taxing district"),amountHead=create("th","Amount");
    nameHead.setAttribute("scope","col");amountHead.setAttribute("scope","col");header.append(nameHead,amountHead);head.append(header);
    const body = create("tbody");
    for (const district of value.districts) {
      const tr = create("tr"),name=create("th",district.name);name.setAttribute("scope","row");
      tr.append(name,create("td",money(district.amount_cents)));body.append(tr);
    }
    table.append(head,body);detail.append(table,create("p","Schools includes community college. Other districts keeps all remaining county labels, including any label we have not categorized. Amounts use the county’s Current Taxes column; pensions are already included, not added again.","local-decision-note"));
    const note = create("p",value.total_cents === 0 ? "This county record reports $0 in tax billed. It does not by itself explain why or establish a future exemption." : "This is the tax billed for the year, not your remaining balance or proof of payment.","tax-inline-message");
    const source = create("p","Source: Sangamon County tax-bill detail · Retrieved "+retrieved+". A saved county result may be reused for up to 24 hours. Percentages are rounded.","local-decision-source");
    target.replaceChildren(period,total,summary,note,detail,source);
  }
  function attach(target,{pin,panel}) {
    const output=create("div",undefined,"tax-inline");output.setAttribute("aria-live","polite");
    output.append(create("p","Open this section to load the county’s tax breakdown.","tax-inline-message"));target.append(output);
    let loading=false,finished=false;
    async function load() {
      if (loading || finished || !/^\d{11}$/.test(String(pin))) return;
      loading=true;output.setAttribute("aria-busy","true");output.replaceChildren(create("p","Loading this parcel’s county tax breakdown…","tax-inline-message"));
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      try {
        const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"omit",referrerPolicy:"no-referrer",body:JSON.stringify({pin}),signal:controller.signal});
        if (!response.ok) throw Error("Tax lookup unavailable");
        const value=validate(await response.json(),pin);
        if (!value) throw Error("Tax data could not be verified");
        if (!output.isConnected) return;
        render(output,value);finished=true;
      } catch {
        if (!output.isConnected) return;
        const retry=create("button","Try loading again","tax-inline-retry");retry.type="button";retry.addEventListener("click",load);
        output.replaceChildren(create("p","We couldn’t load a verified breakdown. No estimate is shown. Try again or use the official county links below.","tax-inline-message"),retry);
      } finally { clearTimeout(timer);loading=false;output.setAttribute("aria-busy","false"); }
    }
    panel.addEventListener("toggle",()=>{if(panel.open)load();});
    return {load,output};
  }
  window.ParcelTaxBreakdown={validate,groups,attach};
})();
