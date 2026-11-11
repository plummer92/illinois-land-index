(async()=>{
    const root=document.getElementById('illinois-water-data-map');
    const response=await fetch('./data/research-map.json');
    if(!response.ok)throw new Error('Map data could not be loaded.');
    const data=await response.json();
    const svg=d3.select(root.querySelector('.map-surface'));
    const picker=root.querySelector('#water-map-selection'),areaPicker=root.querySelector('#water-map-area');
    const detailName=root.querySelector('#water-map-name'),detailStatus=root.querySelector('#water-map-status'),detailAddress=root.querySelector('#water-map-address'),detailDescription=root.querySelector('#water-map-description'),detailSources=root.querySelector('#water-map-sources');
    const focusIds=['17167','17137','17117'],auroraIds=['17089','17043','17093','17197'];
    const comparisons=['Aurora','Lombard'];
    let area='water',selected='site-cyrusone',viewTransform=d3.zoomIdentity,gestureStart=d3.zoomIdentity,drawPending=false,waterLayers=null,lastProjection=null;
    function scheduleDraw(){if(!drawPending){drawPending=true;requestAnimationFrame(()=>{drawPending=false;draw();});}}
    const zoom=d3.zoom().scaleExtent([.65,256]).clickDistance(5)
      .on('start',event=>{gestureStart=viewTransform;if(event.sourceEvent&&['mousedown','touchstart'].includes(event.sourceEvent.type))svg.classed('dragging',true);})
      .on('zoom',event=>{viewTransform=event.transform;const k=viewTransform.k/gestureStart.k;svg.select('.map-content').attr('transform','translate('+(viewTransform.x-gestureStart.x*k)+','+(viewTransform.y-gestureStart.y*k)+') scale('+k+')');})
      .on('end',()=>{svg.classed('dragging',false);draw();save();});
    function resetView(){svg.interrupt().call(zoom.transform,d3.zoomIdentity);}
    const fc=features=>({type:'FeatureCollection',features});
    const point=coordinates=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates}});
    function orient(f){if(d3.geoArea(f)>2*Math.PI){const g=f.geometry;if(g.type==='Polygon')g.coordinates.forEach(r=>r.reverse());if(g.type==='MultiPolygon')g.coordinates.forEach(p=>p.forEach(r=>r.reverse()));}return f;}
    data.lakes.forEach(orient);orient(data.cyrusoneFootprint);
    const places={
      Chatham:'Utility bills, administration fees, village hall, budgets, vendors, roads and trustee votes.',
      Springfield:'State and institutional computing facilities, county decisions, CWLP comparisons and Memorial’s West Jefferson site.',
      Waverly:'Treatment-plant financing, Apple Creek wholesale supply, lake dredging and fiber-permit records.',
      Auburn:'CyrusOne school benefit agreements and payment-record questions.',
      Virden:'Fire-district benefits and the Otter Lake Water Commission office; district and city boundaries differ.',
      Girard:'Otter Lake regional context and nearby North Mac school benefits; no citywide budget audit.',
      Sherman:'Municipal sewer administration and collection-cost comparison.',
      Riverton:'Municipal electric transfers and utility-fee comparison.',
      Aurora:'CyrusOne noise complaints, mitigation and enforcement comparison; outside the three-county inventory.',
      Lombard:'Limited background comparison with another CyrusOne facility; outside the three-county inventory.'
    };
    function addGroup(label,items){const group=document.createElement('optgroup');group.label=label;items.forEach(([value,text])=>{const option=document.createElement('option');option.value=value;option.textContent=text;group.appendChild(option);});picker.appendChild(group);}
    addGroup('Water sources',data.lakes.map(f=>['lake-'+f.properties.id,f.properties.name]));
    addGroup('Data-center sites / documented references',data.sites.map(s=>['site-'+s.id,s.name]));
    addGroup('County focus',data.counties.filter(f=>focusIds.includes(String(f.id))).map(f=>['county-'+f.id,f.properties.name+' County']));
    addGroup('Cities and villages',data.places.map(f=>[f.properties.BASENAME,f.properties.BASENAME]));
    const known=new Set(Array.from(picker.options).map(o=>o.value));
    const storageKey='ili-infrastructure-map-v1';
    let saved=null;try{saved=JSON.parse(localStorage.getItem(storageKey));}catch{}
    function restore(s){if(!s||![2,3].includes(s.version))return;if(['water','local','springfield','state','aurora'].includes(s.area))area=s.area;if(known.has(s.selected))selected=s.selected;if(s.version===3&&Array.isArray(s.view)&&s.view.length===3&&s.view.every(Number.isFinite)){const [x,y,k]=s.view;if(k>=.65&&k<=256)viewTransform=d3.zoomIdentity.translate(x,y).scale(k);}}
    if(saved)restore(saved.privateContent);
    function save(){try{localStorage.setItem(storageKey,JSON.stringify({privateContent:{version:3,area,selected,view:[viewTransform.x,viewTransform.y,viewTransform.k]}}));}catch{}}
    function source(label,url){const a=document.createElement('a');a.textContent=label;a.href=url;if(!url.startsWith('../')){a.target='_blank';a.rel='noopener noreferrer';}detailSources.appendChild(a);}
    function choose(key,move){
      if(!known.has(key))return;waterLayers?.clearSelection();selected=key;picker.value=key;detailSources.replaceChildren();
      if(key.startsWith('site-')){
        const s=data.sites.find(s=>'site-'+s.id===key);detailName.textContent=s.name;detailStatus.textContent=s.status;detailAddress.textContent=s.address+' · '+s.locationQuality;detailDescription.textContent=s.detail;s.sources.forEach(s=>source(s.label,s.url));
        if(move)area=s.id==='cyrusone'?'water':'springfield';
      }else if(key.startsWith('lake-')){
        const p=data.lakes.find(f=>'lake-'+f.properties.id===key).properties;detailName.textContent=p.name;detailStatus.textContent=p.status;detailAddress.textContent=p.id==='waverly-lake'?'Morgan County · USGS name: Waverly City Lake':'Macoupin County · USGS Otter Lake geometry, including its upper arm';detailDescription.textContent=p.id==='waverly-lake'?'Current upstream relationship: Waverly Lake → Waverly water system → Apple Creek. CyrusOne’s proposed service would be downstream of that system. The nearby smaller Panhandle Eastern Waverly Lake is a different reservoir and is not shown as the municipal source.':'Otter Lake → proposed Apple Creek connection → proposed CyrusOne service. The signed upstream agreement, available emergency capacity, funding split and service date remain unverified.';source('Supply-source record',p.source);if(move)area='water';
      }else if(key.startsWith('county-')){
        const f=data.counties.find(f=>'county-'+f.id===key);detailName.textContent=f.properties.name+' County';detailStatus.textContent='Research focus; county shading is not a data-center boundary.';detailAddress.textContent='';detailDescription.textContent=String(f.id)==='17167'?'All ten mapped site records are in Sangamon County, with differing evidence dates and statuses. Two are development projects; several are historical or reported references.':'No independently verified, publicly named data-center location was established here in this search. That does not establish that none exist; private and institutional facilities may not be publicly cataloged.';if(move)area='local';
      }else{
        detailName.textContent=key;detailStatus.textContent='Place connected to our research';detailAddress.textContent='Municipal boundary and point from Census TIGERweb';detailDescription.textContent=places[key]||'';if(move)area=comparisons.includes(key)?'aurora':key==='Springfield'?'springfield':'local';
      }
      if(key==='Chatham')source('Chatham land research','../chatham-il-land-for-sale-research.html');
      if(key.startsWith('site-')||key==='county-17167'||key==='Springfield'||key==='Chatham')source('Sangamon land research','../sangamon-land-dashboard.html');
      source('Latest county signals','../latest-land-signals.html');
      if(move)resetView();areaPicker.value=area;draw();
    }
    function draw(){
      const node=root.querySelector('.map-surface'),surface=d3.select(node);
      const {width:w,height:h}=node.getBoundingClientRect();
      if(w<1||h<1)return;
      const small=w<=480;
      surface.attr('viewBox','0 0 '+w+' '+h);surface.selectAll('*').remove();
      let fit;
      if(area==='state')fit=fc(data.counties);
      else if(area==='aurora')fit=fc(data.counties.filter(f=>auroraIds.includes(String(f.id))));
      else if(area==='water')fit=fc([...data.lakes,data.cyrusoneFootprint]);
      else if(area==='springfield')fit=fc(data.sites.filter(s=>s.id!=='cyrusone').map(s=>point(s.coordinates)));
      else fit=fc(data.counties.filter(f=>focusIds.includes(String(f.id))));
      const rail=area==='springfield'?(small?125:190):24;
      const base=d3.geoMercator().fitExtent([[24,32],[w-rail-12,h-42]],fit);
      const projection=d3.geoMercator().scale(base.scale()*viewTransform.k).translate(viewTransform.apply(base.translate())).clipExtent([[-w,-h],[2*w,2*h]]),path=d3.geoPath(projection);
      lastProjection=projection;
      surface.attr('data-zoom',viewTransform.k).attr('data-pan-x',viewTransform.x).attr('data-pan-y',viewTransform.y);
      const inFrame=p=>p[0]>2&&p[0]<w-2&&p[1]>18&&p[1]<h-24;
      surface.append('desc').text('Ten public data-center site records are mapped in Sangamon County. Markers distinguish documented facilities, development projects, and historical or reported references. Two lake sources and schematic supply links show the water relationship without implying a constructed pipe route.');
      const svg=surface.append('g').attr('class','map-content');
      const counties=svg.append('g');
      counties.selectAll('path').data(data.counties).join('path').attr('d',path).attr('fill',f=>focusIds.includes(String(f.id))?'color-mix(in srgb,var(--viz-series-1) 10%,var(--background))':'color-mix(in srgb,var(--muted-foreground) 4%,var(--background))').attr('stroke','var(--border)').attr('stroke-width',.8).attr('data-tooltip',f=>f.properties.name+' County').on('click',(e,f)=>{if(focusIds.includes(String(f.id))){choose('county-'+f.id,false);save();}});
      svg.append('g').selectAll('path').data(data.places).join('path').attr('d',path).attr('fill','color-mix(in srgb,var(--muted-foreground) 6%,var(--background))').attr('stroke','var(--border)').attr('stroke-width',.7);
      if(base.scale()*viewTransform.k>15000)svg.append('g').selectAll('path').data(data.roads).join('path').attr('d',path).attr('fill','none').attr('stroke','color-mix(in srgb,var(--muted-foreground) 22%,var(--background))').attr('stroke-width',.5).attr('pointer-events','none');
      waterLayers?.render({projection,path,layer:svg,width:w,height:h});
      const boundaryLabels=area==='local'?data.counties.filter(f=>focusIds.includes(String(f.id))):area==='aurora'?data.counties.filter(f=>auroraIds.includes(String(f.id))):[];
      boundaryLabels.forEach(f=>{const p=projection(d3.geoCentroid(f));if(String(f.id)==='17167'){p[1]-=small?62:84;p[0]+=small?0:50;}svg.append('text').attr('class','county-label text-small').attr('x',p[0]).attr('y',p[1]).attr('text-anchor','middle').text(f.properties.name+' County');});
      const lakes=svg.append('g');
      lakes.selectAll('path').data(waterLayers&&!waterLayers.checks.waterbodies.checked?[]:data.lakes).join('path').attr('d',path).attr('fill','var(--viz-series-1)').attr('fill-opacity',.72).attr('stroke','var(--viz-series-1)').attr('stroke-width',.7).attr('class','cursor-interaction').attr('data-tooltip',f=>f.properties.name+' · '+f.properties.status).on('click',(e,f)=>{choose('lake-'+f.properties.id,false);save();});
      const footprint=svg.append('path').datum(data.cyrusoneFootprint).attr('d',path).attr('fill','var(--viz-series-3)').attr('fill-opacity',.35).attr('stroke','var(--viz-series-3)').attr('stroke-width',1).attr('class','cursor-interaction').attr('data-tooltip','Four CyrusOne petition parcels · 280 acres').on('click',()=>{choose('site-cyrusone',false);save();});
      if(area!=='aurora'){
        const target=projection(data.sites.find(s=>s.id==='cyrusone').coordinates);
        const defs=svg.append('defs');defs.append('marker').attr('id','water-map-arrow').attr('viewBox','0 0 10 10').attr('refX',9).attr('refY',5).attr('markerWidth',7).attr('markerHeight',7).attr('orient','auto').append('path').attr('d','M1 1 L9 5 L1 9').attr('fill','none').attr('stroke','var(--viz-series-1)').attr('stroke-width',1.3);
        data.lakes.forEach(f=>{const p=projection(f.properties.coordinates);svg.append('line').attr('x1',p[0]).attr('y1',p[1]).attr('x2',target[0]).attr('y2',target[1]).attr('stroke','var(--viz-series-1)').attr('stroke-width',1.3).attr('stroke-dasharray','5 5').attr('marker-end','url(#water-map-arrow)').attr('pointer-events','none');});
      }
      waterLayers?.renderHits({path,layer:svg});
      const occupied=[];
      function label(text,p,dx,dy,anchor='start',secondary=false){
        let x=p[0]+dx,y=p[1]+dy;
        const t=svg.append('text').attr('class',(secondary?'county-label text-small':'map-label')).attr('x',x).attr('y',y).attr('text-anchor',anchor).text(text);
        let b=t.node().getBBox();if(b.x<4){anchor='start';x=Math.max(5,p[0]+10);t.attr('x',x).attr('text-anchor',anchor);}if(b.x+b.width>w-5){anchor='end';x=Math.min(w-5,p[0]-10);t.attr('x',x).attr('text-anchor',anchor);}
        for(let i=0;i<8;i++){b=t.node().getBBox();if(!occupied.some(o=>b.x<o.x+o.width+3&&b.x+b.width+3>o.x&&b.y<o.y+o.height+3&&b.y+b.height+3>o.y))break;y=Math.max(20,Math.min(h-40,y+(i%2===0?-18:36)));t.attr('y',y);}
        occupied.push(t.node().getBBox());if(Math.abs(y-p[1])>24)svg.insert('line',()=>t.node()).attr('x1',p[0]).attr('y1',p[1]).attr('x2',x).attr('y2',y-4).attr('stroke','var(--muted-foreground)').attr('stroke-width',.7).attr('pointer-events','none');return t;
      }
      data.lakes.forEach(f=>{const p=projection(f.properties.coordinates);if(!inFrame(p))return;const left=f.properties.id==='waverly-lake';label(f.properties.name,p,left?-10:14,left?-10:2,left?'end':'start');svg.append('circle').attr('cx',p[0]).attr('cy',p[1]).attr('r',10).attr('fill','transparent').attr('class','cursor-interaction').attr('data-tooltip',f.properties.name).on('click',()=>{choose('lake-'+f.properties.id,false);save();});});
      function marker(s,withLabel=true){
        const p=projection(s.coordinates);if(!inFrame(p))return;
        const project=s.kind==='project',reference=s.kind==='reference';const color=project?'var(--viz-series-3)':'var(--viz-series-2)';
        const symbol=d3.symbol().type(project?d3.symbolTriangle:d3.symbolSquare).size(selected==='site-'+s.id?95:58);
        svg.append('path').attr('d',symbol()).attr('transform','translate('+p+')').attr('fill',reference?'var(--background)':color).attr('stroke',color).attr('stroke-width',1.5).attr('class','cursor-interaction').attr('data-tooltip',s.name+' · '+s.status).on('click',()=>{choose('site-'+s.id,false);save();});
        svg.append('circle').attr('cx',p[0]).attr('cy',p[1]).attr('r',10).attr('fill','transparent').attr('class','cursor-interaction').attr('data-tooltip',s.name+' · '+s.status).on('click',()=>{choose('site-'+s.id,false);save();});
        if(withLabel)label(s.short,p,14,-10);
        return p;
      }
      const springfieldSites=data.sites.filter(s=>s.id!=='cyrusone').map(s=>({s,p:projection(s.coordinates)}));
      const span=Math.max(d3.max(springfieldSites,d=>d.p[0])-d3.min(springfieldSites,d=>d.p[0]),d3.max(springfieldSites,d=>d.p[1])-d3.min(springfieldSites,d=>d.p[1]));
      marker(data.sites.find(s=>s.id==='cyrusone'),area!=='state'||viewTransform.k>2);
      if(area==='springfield'&&viewTransform.k===1&&viewTransform.x===0&&viewTransform.y===0){
        const sites=springfieldSites.sort((a,b)=>a.p[1]-b.p[1]);
        const railX=w-rail+4,spacing=Math.min(49,(h-85)/(sites.length-1));
        sites.forEach(({s,p},i)=>{marker(s,false);const y=35+i*spacing;svg.append('path').attr('d','M'+p[0]+' '+p[1]+' L'+(railX-8)+' '+y+' L'+railX+' '+y).attr('fill','none').attr('stroke','var(--border)').attr('stroke-width',.8).attr('pointer-events','none');svg.append('text').attr('x',railX+4).attr('y',y+4).attr('class','map-label'+(small?' text-small':'')).text(s.short);});
      }else if(span>=180){springfieldSites.forEach(({s})=>marker(s));
      }else{
          const s=data.sites.find(s=>s.id==='ccf-existing'),p=projection(s.coordinates);
          if(inFrame(p)){
            svg.append('circle').attr('cx',p[0]).attr('cy',p[1]).attr('r',9).attr('fill','var(--viz-series-2)').attr('stroke','var(--background)').attr('stroke-width',1.5).attr('class','cursor-interaction').attr('data-tooltip','Nine Springfield-area site records · click to zoom').on('click',()=>{choose('site-ccf-existing',true);save();});
            label(small?'Springfield · 9':'Springfield DC records · 9',p,14,-8);
          }
      }
      const townOffsets={Chatham:[12,-7,'start'],Waverly:[-12,14,'end'],Auburn:[12,-4,'start'],Virden:[12,-5,'start'],Girard:[12,12,'start'],Sherman:[-12,-12,'end'],Riverton:[12,0,'start'],Aurora:[-12,-8,'end'],Lombard:[12,-8,'start']};
      data.places.forEach(f=>{
        const n=f.properties.BASENAME,p=projection([+f.properties.INTPTLON,+f.properties.INTPTLAT]);if(!inFrame(p))return;
        if(area==='springfield'||(area==='state'&&!comparisons.includes(n)))return;
        if(area==='local'&&n==='Springfield')return;
        svg.append('circle').attr('cx',p[0]).attr('cy',p[1]).attr('r',2.5).attr('fill','var(--muted-foreground)').attr('class','cursor-interaction').attr('data-tooltip',n).on('click',()=>{choose(n,false);save();});
        if(area==='water'&&!['Waverly','Auburn','Virden','Girard'].includes(n))return;
        if(small&&area==='local'&&!['Chatham','Waverly'].includes(n))return;
        if(small&&area==='water'&&!['Waverly','Auburn'].includes(n))return;
        const o=townOffsets[n]||[12,-7,'start'];label(n,p,o[0],o[1],o[2],true);
      });
      if(area==='springfield'&&selected.startsWith('site-')){
        const active=data.sites.find(s=>'site-'+s.id===selected);
        if(active&&active.id!=='cyrusone'){
          const p=projection(active.coordinates);
          svg.append('circle').attr('cx',p[0]).attr('cy',p[1]).attr('r',9).attr('fill','none').attr('stroke','var(--foreground)').attr('stroke-width',1.2).attr('pointer-events','none');
          marker(active,false);
        }
      }
      surface.append('text').attr('x',12).attr('y',18).attr('class','text-small').attr('fill','var(--muted-foreground)').text('N ↑');
      const p0=projection.invert([24,h-20]),p1=projection.invert([124,h-20]),miles=d3.geoDistance(p0,p1)*3958.7613;
      const magnitude=Math.pow(10,Math.floor(Math.log10(miles))),step=miles/magnitude,scaleMiles=(step>=5?5:step>=2?2:1)*magnitude,len=100*scaleMiles/miles;
      surface.append('line').attr('x1',24).attr('x2',24+len).attr('y1',h-18).attr('y2',h-18).attr('stroke','var(--foreground)').attr('stroke-width',1.5);surface.append('text').attr('x',24).attr('y',h-25).attr('class','text-small').attr('fill','var(--foreground)').text(scaleMiles+' mi');
      svg.selectAll('[data-tooltip]').each(function(){d3.select(this).append('title').text(this.getAttribute('data-tooltip'));});
    }
    root.querySelector('#water-map-coverage').textContent='Ten mapped records: CyrusOne’s proposed campus plus nine Springfield-area facility/project references, including two UIS buildings. Public-source inventory, not a complete official registry. Historical/report markers do not establish current operation. No named facility location was independently verified in Morgan or Macoupin County. Horace Mann and general AT&T/medical-district references remain unpinned because a specific facility address was not established. Lakes and parcel outlines are sourced geometry; city/address pins and campus pins are not server-room footprints.';
    picker.addEventListener('change',()=>{choose(picker.value,true);save();});
    areaPicker.addEventListener('change',()=>{area=areaPicker.value;resetView();if(area==='water')selected='site-cyrusone';else if(area==='springfield')selected='site-ccf-existing';else if(area==='aurora')selected='Aurora';choose(selected,false);save();});
    svg.call(zoom).property('__zoom',viewTransform);
    waterLayers=new ParcelWaterLayer({root,context:data,onChange:scheduleDraw});
    function parcelView(centerOverride){
      waterLayers.checks.parcels.checked=true;
      let coordinate;
      if(selected.startsWith('site-'))coordinate=data.sites.find(s=>'site-'+s.id===selected)?.coordinates;
      else if(selected.startsWith('lake-'))coordinate=data.lakes.find(f=>'lake-'+f.properties.id===selected)?.properties.coordinates;
      else if(selected.startsWith('county-'))coordinate=d3.geoCentroid(data.counties.find(f=>'county-'+f.id===selected));
      else{const f=data.places.find(f=>f.properties.BASENAME===selected);if(f)coordinate=[+f.properties.INTPTLON,+f.properties.INTPTLAT];}
      if(Array.isArray(centerOverride))coordinate=centerOverride;
      if(!coordinate)coordinate=[-89.7,39.6];area='local';areaPicker.value=area;resetView();draw();
      const {width:w,height:h}=svg.node().getBoundingClientRect(),p=lastProjection(coordinate);
      const widthKm=d3.geoDistance(lastProjection.invert([0,h/2]),lastProjection.invert([w,h/2]))*6371;
      const k=Math.max(.65,Math.min(256,widthKm/(Array.isArray(centerOverride)?1.3:5)));svg.call(zoom.transform,d3.zoomIdentity.translate(w/2,h/2).scale(k).translate(-p[0],-p[1]));
    }
    root.querySelector('#water-parcel-view').addEventListener('click',()=>parcelView());
    root.querySelector('#water-zoom-in').addEventListener('click',()=>svg.call(zoom.scaleBy,1.5));
    root.querySelector('#water-zoom-out').addEventListener('click',()=>svg.call(zoom.scaleBy,1/1.5));
    root.querySelector('#water-reset').addEventListener('click',resetView);
    svg.on('keydown.navigation',event=>{const moves={ArrowLeft:[80,0],ArrowRight:[-80,0],ArrowUp:[0,80],ArrowDown:[0,-80]};if(moves[event.key]){event.preventDefault();const [x,y]=moves[event.key];svg.call(zoom.translateBy,x/viewTransform.k,y/viewTransform.k);}else if(['+','=','-','Home'].includes(event.key)){event.preventDefault();if(event.key==='Home')resetView();else svg.call(zoom.scaleBy,event.key==='-'?1/1.5:1.5);}});
    const query=new URLSearchParams(location.search),requested=query.get('place');
    choose(known.has(requested)?requested:selected,known.has(requested));
    const [lon,lat]=window.ILIParcelCoordinate||[NaN,NaN];
    if(Number.isFinite(lon)&&Number.isFinite(lat)&&lon>=-90.61&&lon<=-89.20&&lat>=38.99&&lat<=39.99){waterLayers.focusPoint=[lon,lat];parcelView([lon,lat]);}
    new ResizeObserver(scheduleDraw).observe(svg.node());document.fonts.ready.then(scheduleDraw);
  })().catch(error=>{console.error(error);const warning=document.getElementById('water-map-error');warning.hidden=false;warning.textContent='The map could not load. Refresh this page or use the county research links below.';});
