(() => {
  "use strict";
  let basemapRequest;
  let disconnectPrevious;
  function loadBasemap() {
    if (!basemapRequest) basemapRequest = fetch("./data/utility-source-basemap.json")
      .then(response => {
        if (!response.ok) throw new Error("Base map unavailable");
        return response.json();
      }).catch(error => { basemapRequest = undefined; throw error; });
    return basemapRequest;
  }
  function make(tag, content, className) {
    const el = document.createElement(tag);
    if (content !== undefined) el.textContent = content;
    if (className) el.className = className;
    return el;
  }
  const svgNS = "http://www.w3.org/2000/svg";
  function svg(tag, attributes = {}) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
    return node;
  }
  function button(title, action) {
    const el = make("button",title);
    el.type = "button"; el.onclick = action;
    return el;
  }
  function project(lon, lat) {
    return [(lon + 89.7) * 1000 * Math.cos(40 * Math.PI / 180), (39.67 - lat) * 1000];
  }
  const roles = {normal:"Usual water source",backup:"Emergency water source",portfolio:"Generation portfolio"};
  const finitePoint = p => Number.isFinite(p.lon) && Number.isFinite(p.lat);
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  // Project all polygon rings, preserving unincorporated enclaves.
  function communityOutline(geometry) {
    if (!geometry || !["Polygon","MultiPolygon"].includes(geometry.type)) return null;
    const polygons=geometry.type==="Polygon" ? [geometry.coordinates] : geometry.coordinates;
    let west=Infinity,north=Infinity,east=-Infinity,south=-Infinity;
    const paths=[];
    for (const polygon of polygons) {
      for (const ring of polygon) {
        const points=[];
        for (const [lon,lat] of ring) {
          if (!finitePoint({lon,lat})) continue;
          const [x,y]=project(lon,lat);
          west=Math.min(west,x);east=Math.max(east,x);north=Math.min(north,y);south=Math.max(south,y);
          points.push(x.toFixed(2)+" "+y.toFixed(2));
        }
        if(points.length>=3) paths.push("M"+points.join("L")+"Z");
      }
    }
    return paths.length ? {path:paths.join(""),corners:[[west,north],[east,south]]} : null;
  }
  window.showUtilitySourceMap = function(container, {pin,lon,lat,sites = [],gas=null,preferredKind} = {}) {
    disconnectPrevious?.();
    disconnectPrevious=null;
    const panel = make("section",undefined,"source-view");
    panel.setAttribute("aria-label","Utility source map");
    panel.append(make("h3","Utility source map"));
    container.replaceChildren(panel);
    if (!finitePoint({lon,lat})) {
      panel.append(make("p","A verified property location is needed to map its utility sources."));
      return;
    }
    const verified = sites.filter(s => finitePoint(s) && roles[s.role] && ["water","power"].includes(s.kind));
    const home = {id:"property",name:"Selected property",xy:project(lon,lat)};
    const pins = verified.map(site => ({...site,xy:project(site.lon,site.lat)}));
    const controls = make("div",undefined,"source-switches");
    controls.setAttribute("role","group"); controls.setAttribute("aria-label","Utility to display");
    const plot = make("div",undefined,"source-plot");
    const map = svg("svg",{"role":"img","aria-label":"Geographic map of the selected property and its utility sources. Use the list below to choose a source."});
    const world = svg("g"), areas = svg("g"), towns = svg("g"), roads = svg("g"), water = svg("g"), annotations = svg("g"), badges = svg("g");
    const gasArea=svg("path",{class:"source-gas-area","fill-rule":"evenodd"});
    let gasOutline=communityOutline(gas?.geometry);
    world.append(areas,towns,gasArea,roads,water);map.append(world,annotations,badges);
    plot.append(map);
    const bar = make("div",undefined,"source-navigation");
    const zoomOut = button("−", () => zoom(.65));
    const zoomIn = button("+",() => zoom(1.55));
    zoomOut.setAttribute("aria-label","Zoom source map out");
    zoomIn.setAttribute("aria-label","Zoom source map in");
    const resetView=button("Fit sources",()=>{selected=null;fitGroup();render(true);});
    bar.append(zoomOut,zoomIn,resetView);
    const north = make("span","N ↑","source-north");
    const distance = make("span", undefined, "source-distance");
    plot.append(north, distance);
    const error = make("p",undefined,"source-map-error"); error.hidden=true;
    const note = make("p",undefined,"source-mode-note");
    const list = make("div",undefined,"source-locations");
    list.setAttribute("role","group");list.setAttribute("aria-label","Locations on this map");
    const activeText = make("div",undefined,"source-selection");activeText.setAttribute("aria-live","polite");
    const sources = make("details",undefined,"source-base-credit");
    sources.append(make("summary","Map sources"));
    const credits = make("p");sources.append(credits);
    const initialKind=pins.some(s=>s.kind==="water") ? "water" : (pins.length ? "power" : "gas");
    let kind = ["water","power","gas"].includes(preferredKind) ? preferredKind : initialKind;
    let selected = null, width=0, height=0, center=home.xy.slice(), scale=1, minScale=.02, maxScale=100;
    let base = null;
    const groups = {states:areas,places:towns,roads,water};
    let switchButtons = {};
    for (const [key,label] of [["water","Drinking water"],["power","Electricity"],["gas","Natural gas"]]) {
      const control = button(label,()=>{kind=key;selected=null;fitGroup();render(true);});
      switchButtons[key] = control;controls.append(control);
    }
    panel.append(controls,note,plot,bar,error,list,activeText,sources);
    const visible = () => pins.filter(site=>site.kind===kind);
    function fitGroup() {
      const points=[home,...visible()].map(s=>s.xy);
      if(kind==="gas" && gasOutline) points.push(...gasOutline.corners);
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      const west=Math.min(...xs),east=Math.max(...xs),north=Math.min(...ys),south=Math.max(...ys);
      center=[(west+east)/2,(north+south)/2];
      const dx=Math.max(kind==="gas" ? 12 : 60,east-west),dy=Math.max(kind==="gas" ? 12 : 50,south-north);
      scale=Math.min(Math.max(1,width-76)/dx,Math.max(1,height-100)/dy);
      minScale=Math.min(scale,.02);maxScale=Math.max(scale*3,9);
    }
    function screen([x,y]) { return [(x-center[0])*scale+width/2,(y-center[1])*scale+height/2]; }
    function zoom(factor, at=[width/2,height/2]) {
      const next=clamp(scale*factor,minScale,maxScale);
      center=center.map((v,i)=>v+(at[i]-(i?height:width)/2)*(1/scale-1/next));
      scale=next;draw();
    }
    function select(site) {
      selected=site.id;
      center=site.xy.slice();
      // Keep regional context for a generating station; fit towns and water for local sources.
      scale=clamp(Math.max(scale,kind==="power" ? .28 : 1.7),minScale,maxScale);
      render(true);
    }
    function updateList() {
      list.replaceChildren();activeText.replaceChildren();
      list.hidden=kind==="gas";
      if(kind==="gas"){
        if(gas?.community && gas.provider) {
          if(gasOutline){
            const key=make("p",undefined,"source-gas-key");
            const boundary=make("a",gas.community+" municipal boundary");
            boundary.href="https://sangis.co.sangamon.il.us/server/rest/services/Sangamon_MajorBoundaries/MapServer/6";
            key.append(make("span",undefined,"source-gas-swatch"),boundary);
            activeText.append(key);
          }
          if(gas.sourceUrl){
            const link=make("a",gas.sourceLabel || "Gas provider record");link.href=gas.sourceUrl;
            link.referrerPolicy="no-referrer";activeText.append(link);
          }
        }
        if(selected===home.id)activeText.append(make("p","Selected property · Parcel "+pin));
        return;
      }
      const entries=[home,...visible()];
      for (const [index,site] of entries.entries()) {
        const title = index ? index + ". " + site.name + (site.role === "backup" ? " (backup)" : "") : "◆  Selected property";
        const item=button(title,()=>select(site));
        item.setAttribute("aria-pressed",String(selected===site.id));item.dataset.key=site.id;
        list.append(item);
      }
      const current=entries.find(site=>site.id===selected);
      if (!current) return;
      if (current===home) { activeText.append(make("strong","Selected property"),make("p","Parcel "+pin));return; }
      activeText.append(make("strong",current.name),make("p",roles[current.role]+". "+current.note));
      if (current.sourceUrl) {
        const link=make("a",current.sourceLabel || "Source record");link.href=current.sourceUrl;link.referrerPolicy="no-referrer";activeText.append(link);
      }
    }
    function render(rebuild=false) {
      for (const [k,b] of Object.entries(switchButtons)) b.setAttribute("aria-pressed",String(k===kind));
      const hasSites=visible().length>0;
      const isGas=kind==="gas";
      gasArea.style.display=isGas && gasOutline ? "" : "none";
      gasArea.setAttribute("d",isGas && gasOutline ? gasOutline.path : "");
      map.setAttribute("aria-label",isGas ?
        "Gas map of the selected property"+(gasOutline ? " and the "+gas.community+" municipal boundary." : ".") :
        "Geographic map of the selected property and its utility sources. Use the location list to choose a source.");
      resetView.textContent=isGas ? (gasOutline ? "Fit community" : "Fit property") : "Fit sources";
      if(isGas) {
        note.textContent=gas?.community && gas.provider ?
          gas.provider+" lists "+gas.community+" as a community it serves. The diamond marks your property. Check your gas bill or ask the provider to confirm a line and meter at this address." :
          "The diamond marks the selected property. We could not verify a gas provider for this location. Check your gas bill or ask the utility about a connection.";
      } else note.textContent = !hasSites ? (kind==="water" ? "No water-source location is verified for this property." :
        "The available electric service records do not identify a generation portfolio for this property.") :
        (kind==="water" ? "Select a numbered source to see where the water system gets its water." :
          "These stations are part of the supplier’s power mix. Power reaches the property through the shared grid.");
      if (rebuild) {
        const focused = list.contains(document.activeElement) ? document.activeElement.dataset.key : null;
        updateList();
        if (focused) Array.from(list.children).find(b=>b.dataset.key===focused)?.focus({preventScroll:true});
      }
      draw();
    }
    function draw() {
      if (!width || !height) return;
      map.setAttribute("viewBox","0 0 "+width+" "+height);
      world.setAttribute("transform","translate("+width/2+" "+height/2+") scale("+scale+") translate("+(-center[0])+" "+(-center[1])+")");
      roads.style.display=scale>.36?"":"none";towns.style.display=scale>.1?"":"none";
      // Longitude is scaled at 40° N. One north-south map unit is about 0.069 miles.
      const milesPerPixel=.0691/scale;
      const limit=72*milesPerPixel;
      const magnitude=10**Math.floor(Math.log10(limit));
      const miles=[5,2,1].find(step=>step*magnitude<=limit)*magnitude;
      distance.textContent=miles.toLocaleString()+" mi";
      distance.style.width=miles/milesPerPixel+"px";
      badges.replaceChildren();annotations.replaceChildren();
      const blocked=[];
      const points=[home,...visible()];
      const circles=[];
      const inside=(x,y,margin=0)=>x>=margin && x<=width-margin && y>=margin && y<=height-margin;
      for (const [i,item] of points.entries()) {
        const [x,y]=screen(item.xy);
        if (!inside(x,y,1)) continue;
        let mx=x,my=y;
        // Nudge coincident badges and retain a leader to each actual coordinate.
        for (let attempt=0;attempt<16 && circles.some(p=>Math.hypot(p[0]-mx,p[1]-my)<23);attempt++) {
          const angle=attempt*Math.PI/4, offset=26*(1+Math.floor(attempt/8));
          mx=clamp(x+offset*Math.cos(angle),14,width-14);my=clamp(y+offset*Math.sin(angle),14,height-14);
        }
        circles.push([mx,my]);blocked.push([mx-15,my-15,mx+15,my+15]);
        if (Math.hypot(mx-x,my-y)>1) badges.append(svg("line",{x1:x,y1:y,x2:mx,y2:my,class:"source-leader"}));
        const group=svg("g",{transform:"translate("+mx+" "+my+")",class:"source-badge "+(i?item.role:"property")+(item.id===selected?" active":""),"data-key":item.id});
        group.append(svg("title"));group.firstChild.textContent=item.name;
        if (!i)group.append(svg("path",{d:"M0 -10L10 0L0 10L-10 0Z"}));
        else {
          group.append(svg("circle",{r:11}));
          const text=svg("text",{y:4,"text-anchor":"middle"});text.textContent=i;group.append(text);
        }
        badges.append(group);
      }
      function label(name,pos,category) {
        const [x,anchorY]=screen(pos);
        const half=name.length*3.6+3;
        if (x-half<3 || x+half>width-3 || anchorY<0 || anchorY>height) return;
        const offsets=category==="source-label" ? [0,-20,31] : [0];
        for(const offset of offsets){
          const y=anchorY+offset;
          if (y<15 || y>height-6) continue;
          const box=[x-half,y-11,x+half,y+3];
          if (blocked.some(b=>b[0]<box[2] && b[2]>box[0] && b[1]<box[3] && b[3]>box[1])) continue;
          blocked.push(box);
          const el=svg("text",{x,y,"text-anchor":"middle",class:category});el.textContent=name;annotations.append(el);
          break;
        }
      }
      if(base) {
        if(scale>.1) for(const f of [...base.water,...base.places]) label(f.name,f.p,"source-label");
        if(scale>2) for(const f of base.roads) label(f.name,f.p,"source-road-name");
        if(scale<.5) for(const f of base.states) label(f.name,f.p,"source-state-name");
      }
    }
    const pointers=new Map();
    let drag=null, pinch=null;
    function touchPair(){
      const [a,b]=[...pointers.values()];
      const r=map.getBoundingClientRect();
      return {x:(a[0]+b[0])/2-r.left,y:(a[1]+b[1])/2-r.top,dist:Math.hypot(a[0]-b[0],a[1]-b[1])};
    }
    map.addEventListener("pointerdown",e=>{
      if(e.button!==0 || pointers.size>=2)return;
      pointers.set(e.pointerId,[e.clientX,e.clientY]);map.setPointerCapture(e.pointerId);
      if(pointers.size===1){
        drag={id:e.pointerId,x:e.clientX,y:e.clientY,center:center.slice(),key:e.target.closest("[data-key]")?.dataset.key,moved:false};
      }else{
        const pair=touchPair();drag=null;
        pinch={scale,dist:pair.dist,x:center[0]+(pair.x-width/2)/scale,y:center[1]+(pair.y-height/2)/scale};
      }
    });
    map.addEventListener("pointermove",e=>{
      if(!pointers.has(e.pointerId))return;
      pointers.set(e.pointerId,[e.clientX,e.clientY]);
      if(pinch && pointers.size===2){
        const pair=touchPair();
        if(pinch.dist>0)scale=clamp(pinch.scale*pair.dist/pinch.dist,minScale,maxScale);
        center=[pinch.x-(pair.x-width/2)/scale,pinch.y-(pair.y-height/2)/scale];draw();return;
      }
      if(!drag || drag.id!==e.pointerId)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(!drag.moved && Math.hypot(dx,dy)<5)return;
      drag.moved=true;center=[drag.center[0]-dx/scale,drag.center[1]-dy/scale];draw();
    });
    function finish(e) {
      if(!pointers.delete(e.pointerId))return;
      const hit=drag && !drag.moved && e.type==="pointerup" && [home,...visible()].find(s=>s.id===drag.key);
      drag=null;pinch=null;
      if(pointers.size){const [[id,[x,y]]]=[...pointers];drag={id,x,y,center:center.slice(),moved:true};}
      if(hit)select(hit);
    }
    map.addEventListener("pointerup",finish);map.addEventListener("pointercancel",finish);
    map.addEventListener("wheel",e=>{
      if(!e.ctrlKey && !e.metaKey)return;
      const b=map.getBoundingClientRect();e.preventDefault();
      zoom(Math.exp(-e.deltaY*.006),[e.clientX-b.left,e.clientY-b.top]);
    },{passive:false});
    function resize() {
      const rect=map.getBoundingClientRect();
      if(!rect.width || !rect.height || (width===rect.width && height===rect.height))return;
      width=rect.width;height=rect.height;fitGroup();draw();
    }
    const disconnect=()=>{
      observer.disconnect();
      if(disconnectPrevious===disconnect)disconnectPrevious=null;
    };
    const observer=new ResizeObserver(()=>{if(!panel.isConnected)disconnect();else resize();});
    observer.observe(map);
    disconnectPrevious=disconnect;
    function showBasemap() {
      loadBasemap().then(data=>{
        if(!panel.isConnected)return;
        base=data;
        for (const [key,g] of Object.entries(groups)) {
          g.setAttribute("class","source-geography-"+key);
          for(const feature of data[key])g.append(svg("path",{d:feature.d}));
        }
        credits.replaceChildren();
        for(const [i,s] of data.sources.entries()){
          if(i)credits.append(" · ");
          const a=make("a",s.label);a.href=s.url;credits.append(a);
        }
        if(pins.some(site=>site.kind==="power")){
          const a=make("a","U.S. EIA generating station coordinates (September 2026)");
          a.href="https://www.eia.gov/electricity/data/eia860m/xls/september_generator2026.xlsx";
          credits.append(" · ",a);
        }
        error.hidden=true;sources.hidden=false;draw();
      }).catch(()=>{
        if(!panel.isConnected)return;
        sources.hidden=true;error.hidden=false;
        error.replaceChildren("Geographic background unavailable. ",button("Retry map",showBasemap));
      });
    }
    resize();render(true);sources.hidden=true;showBasemap();
    return function setGas(evidence) {
      if(!panel.isConnected) return;
      gas=evidence || null;
      gasOutline=communityOutline(gas?.geometry);
      if(kind==="gas"){selected=null;fitGroup();render(true);}
    };
  };
})();
