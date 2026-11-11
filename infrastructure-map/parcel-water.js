/* Public boundary-only parcel overlay and USGS surface-water screening. */
(()=>{
  const sources=[
    {county:'Sangamon',fips:'17167',acreField:'TOTACRES',url:'https://sangis.co.sangamon.il.us/server/rest/services/TyleratENTParcels/MapServer/0',viewer:'https://sangis.co.sangamon.il.us/'},
    {county:'Morgan',fips:'17137',acreField:'gross_acre',url:'https://services3.arcgis.com/95PFahBF8eyGEfuc/arcgis/rest/services/TaxParcels/FeatureServer/0',viewer:'https://morgancounty-il.com/wp/departments/gis-geographic-information-systems/'},
    {county:'Macoupin',fips:'17117',acreField:'GrossAcres',url:'https://services.arcgis.com/LYDdxoqTV7fw9teL/arcgis/rest/services/Reach_Parcels/FeatureServer/0',viewer:'https://macoupincountyil.gov/ova_dep/assessment-office/embed/'}
  ];
  const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
  const waterType=f=>({390:'Lake / pond',436:'Reservoir',466:'Swamp / marsh',460:'River / stream',336:'Canal / ditch',558:'Artificial flow path',334:'Flow connector',428:'Pipeline flow path'}[f.properties.feature_type]||'Mapped water feature');
  function bbox(feature){return feature.bbox||turf.bbox(feature);}
  function polygonOverlap(parcel,features){
    const b=bbox(parcel),pieces=[];
    for(const f of features){if(!overlaps(b,bbox(f)))continue;const piece=turf.intersect(turf.featureCollection([parcel,f]));if(piece&&turf.area(piece)>.01)pieces.push(piece);}
    const combined=pieces.length>1?turf.union(turf.featureCollection(pieces)):pieces[0];
    return combined?turf.area(combined):0;
  }
  function screenParcel(parcel,water){
    const b=bbox(parcel),polygons=[...water.layers.waterbodies.features,...water.layers.water_areas.features];
    const area=turf.area(parcel),waterArea=polygonOverlap(parcel,polygons);
    const streams=water.layers.streams.features.filter(f=>[336,460].includes(f.properties.feature_type)&&overlaps(b,bbox(f))&&turf.booleanIntersects(parcel,f));
    const names=[...new Set(polygons.filter(f=>f.properties.name&&overlaps(b,bbox(f))&&turf.booleanIntersects(parcel,f)).map(f=>f.properties.name))];
    return {parcel_area_acres:area/4046.8564224,water_overlap_acres:waterArea/4046.8564224,water_overlap_percent:area?Math.min(100,waterArea/area*100):0,stream_intersects:streams.length>0,water_names:names};
  }
  class ParcelWaterLayer{
    constructor({root,context,onChange}){
      Object.assign(this,{root,context,onChange,water:null,parcels:[],active:null,request:0,requestKey:'',cache:new Map(),pending:null});
      this.status=root.querySelector('#water-layer-status');this.parcelStatus=root.querySelector('#parcel-layer-status');this.detail=root.querySelector('#parcel-water-detail');
      this.counties=sources.map(s=>({...s,bounds:turf.bbox(context.counties.find(f=>String(f.id)===s.fips))}));
      this.checks={waterbodies:root.querySelector('#layer-waterbodies'),streams:root.querySelector('#layer-streams'),parcels:root.querySelector('#layer-parcels')};
      Object.values(this.checks).forEach(c=>c.addEventListener('change',()=>{if(!this.checks.parcels.checked){this.request++;this.pending?.abort();this.requestKey='';this.parcels=[];this.clearSelection();this.parcelStatus.textContent='Parcel boundaries are hidden.';}onChange();}));
      this.loadWater();
    }
    async loadWater(){
      try{
        const response=await fetch('./data/three-county-water.json.gz');if(!response.ok)throw new Error('Water inventory unavailable');
        const bytes=new Uint8Array(await response.arrayBuffer());let text;
        if(bytes[0]===31&&bytes[1]===139){const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));text=await new Response(stream).text();}else text=new TextDecoder().decode(bytes);
        this.water=JSON.parse(text);
        for(const layer of Object.values(this.water.layers))for(const f of layer.features){if(f.geometry.type.includes('Polygon')&&d3.geoArea(f)>2*Math.PI){const rings=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;rings.forEach(p=>p.forEach(r=>r.reverse()));}}
        const n=this.water.layers;this.status.textContent=`USGS inventory: ${n.waterbodies.features.length.toLocaleString()} waterbodies, ${n.streams.features.length.toLocaleString()} flow segments and ${n.water_areas.features.length.toLocaleString()} water areas. Small features appear as you zoom in.`;
        if(this.active)this.select(this.active);this.onChange();
      }catch(error){console.error(error);this.status.textContent='The USGS water inventory could not load. Parcel water screening is unavailable; retry by refreshing the page.';this.status.dataset.error='true';}
    }
    clearSelection(){this.active=null;this.detail.hidden=true;this.root.querySelector('.map-detail').hidden=false;}
    select(parcel){
      this.active=parcel;this.detail.replaceChildren();this.detail.hidden=false;this.root.querySelector('.map-detail').hidden=true;
      const title=document.createElement('h3');title.textContent=`${parcel.properties.county} parcel · water screening`;this.detail.append(title);
      const row=(label,value)=>{const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,document.createTextNode(value));this.detail.append(p);};
      const acres=parcel.properties.acres;row('County acreage',Number.isFinite(acres)&&acres>0?acres.toLocaleString(undefined,{maximumFractionDigits:2})+' acres':'Not supplied by the source');
      if(!this.water){row('Water comparison','Waiting for the USGS layer. No result yet.');}
      else{
        try{const result=screenParcel(parcel,this.water);this.detail.dataset.waterOverlapAcres=result.water_overlap_acres;this.detail.dataset.streamIntersects=result.stream_intersects;
          row('Mapped water-feature overlap',result.water_overlap_acres>.005?`${result.water_overlap_acres.toLocaleString(undefined,{maximumFractionDigits:2})} acres (about ${result.water_overlap_percent.toFixed(1)}% of mapped parcel area)`:'No polygon overlap detected in this inventory');
          row('Mapped stream / canal',result.stream_intersects?'Intersects the parcel boundary or interior':'No intersection detected in this inventory');
          if(result.water_names.length)row('Intersecting named water features',result.water_names.join(', '));
        }catch(error){console.error(error);row('Water comparison','Could not calculate an intersection for this boundary. Check the source map.');}
      }
      const note=document.createElement('p');note.className='text-small text-muted';note.textContent='Approximate GIS screening. Water features include intermittent streams and marshes. This does not establish flood risk, a buildable acreage total, water rights, drinking-water service or year-round water.';this.detail.append(note);
      const links=document.createElement('div');links.className='detail-sources text-small';
      for(const [label,url] of [['County boundary source',parcel.properties.source],['USGS hydrography', 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer']]){const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}this.detail.append(links);
      const close=document.createElement('button');close.type='button';close.className='btn';close.textContent='Clear parcel selection';close.addEventListener('click',()=>{this.clearSelection();this.onChange();});this.detail.append(close);
      this.onChange();
    }
    render({projection,path,layer,width,height}){
      const a=projection.invert([0,height]),b=projection.invert([width,0]);const view=[a[0],a[1],b[0],b[1]];
      if(!view.every(Number.isFinite)||view[0]>=view[2])return;
      if(this.checks.parcels.checked){
        const g=layer.append('g').attr('class','parcel-boundaries');
        g.selectAll('path').data(this.parcels.filter(p=>overlaps(view,bbox(p)))).join('path').attr('d',path).attr('fill',p=>p===this.active?'color-mix(in srgb,var(--green) 17%,transparent)':'transparent').attr('stroke','var(--green-dark)').attr('stroke-opacity',.65).attr('stroke-width',p=>p===this.active?2:.7).attr('class','parcel-boundary cursor-interaction').on('click',(e,p)=>{e.stopPropagation();this.select(p);});
        this.queueParcels(view);
      }
      if(this.water){
        const visible=f=>overlaps(view,bbox(f));
        const px=f=>{const box=bbox(f),p=projection([box[0],box[1]]),q=projection([box[2],box[3]]);return Math.max(Math.abs(q[0]-p[0]),Math.abs(q[1]-p[1]));};
        if(this.checks.waterbodies.checked){
          const features=[...this.water.layers.waterbodies.features,...this.water.layers.water_areas.features].filter(f=>visible(f)&&px(f)>2);
          layer.append('g').attr('class','all-waterbodies').selectAll('path').data(features).join('path').attr('d',path).attr('fill','var(--viz-series-1)').attr('fill-opacity',.55).attr('stroke','var(--viz-series-1)').attr('stroke-width',.35).attr('pointer-events','none');
        }
        if(this.checks.streams.checked){
          const features=this.water.layers.streams.features.filter(f=>visible(f)&&[336,460].includes(f.properties.feature_type)&&(f.properties.name||px(f)>14));
          layer.append('g').attr('class','all-streams').selectAll('path').data(features).join('path').attr('d',path).attr('fill','none').attr('stroke','var(--viz-series-1)').attr('stroke-opacity',.65).attr('stroke-width',.8).attr('pointer-events','none');
        }
      }
      if(this.active)layer.append('path').datum(this.active).attr('d',path).attr('class','selected-parcel-outline').attr('fill','none').attr('stroke','var(--green-dark)').attr('stroke-width',2.2).attr('pointer-events','none');
    }
    renderHits({path,layer}){
      if(!this.checks.parcels.checked)return;
      layer.append('g').selectAll('path').data(this.parcels).join('path').attr('d',path).attr('class','parcel-hit cursor-interaction').attr('fill','transparent').attr('stroke',p=>p===this.active?'var(--green-dark)':'none').attr('stroke-width',2.2).on('click',(e,p)=>{e.stopPropagation();this.select(p);});
    }
    queueParcels(view){
      const key=view.map(v=>v.toFixed(4)).join(',');if(key===this.requestKey)return;
      clearTimeout(this.timer);this.requestKey=key;this.request++;this.pending?.abort();this.parcels=[];
      if(view[2]-view[0]>.13||view[3]-view[1]>.12){this.parcelStatus.textContent='Zoom in or choose “Show nearby parcels” to see county parcel boundaries.';return;}
      this.parcelStatus.textContent='Loading county parcel boundaries…';
      const seq=this.request;
      this.timer=setTimeout(()=>this.loadParcels(view,key,seq),120);
    }
    async loadParcels(view,key,seq){
      if(seq!==this.request||!this.checks.parcels.checked)return;
      if(this.cache.has(key)){const entry=this.cache.get(key);this.parcels=entry.parcels;this.parcelStatus.textContent=entry.status;this.onChange();return;}
      const controller=new AbortController();this.pending=controller;
      const providers=this.counties.filter(s=>overlaps(view,s.bounds));
      const query=async(s,countOnly=false)=>{
        const p=new URLSearchParams({f:countOnly?'json':'geojson',where:'1=1',geometry:view.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outSR:'4326',outFields:s.acreField,returnGeometry:'true',geometryPrecision:'7',resultRecordCount:'1000'});if(countOnly)p.set('returnCountOnly','true');
        const response=await fetch(s.url+'/query?'+p,{signal:controller.signal});if(!response.ok)throw new Error('County service unavailable');const data=await response.json();if(data.error)throw new Error(data.error.message||'County query failed');return data;
      };
      try{
        if(!providers.length){if(seq===this.request)this.parcelStatus.textContent='Parcel overlays cover Sangamon, Morgan and Macoupin counties.';return;}
        const counts=await Promise.all(providers.map(s=>query(s,true)));
        if(seq!==this.request)return;
        if(counts.some(d=>!Number.isFinite(d.count)))throw new Error('County count unavailable');
        const total=counts.reduce((n,d)=>n+d.count,0);
        if(total>900){this.parcelStatus.textContent=`${total.toLocaleString()} parcels intersect this view. Zoom in to show boundaries; none have been silently omitted.`;return;}
        const batches=await Promise.all(providers.map(s=>query(s)));
        if(seq!==this.request)return;
        if(batches.some((d,i)=>d.exceededTransferLimit||d.properties?.exceededTransferLimit||!Array.isArray(d.features)||d.features.length!==counts[i].count))throw new Error('County result is incomplete; zoom in and retry');
        this.parcels=batches.flatMap((d,i)=>d.features.filter(f=>f.geometry&&['Polygon','MultiPolygon'].includes(f.geometry.type)).map(f=>{
          const number=Number(f.properties?.[providers[i].acreField]);const clean={type:'Feature',properties:{county:providers[i].county,acres:Number.isFinite(number)&&number>0?number:null,source:providers[i].url},geometry:f.geometry};clean.bbox=turf.bbox(clean);
          if(d3.geoArea(clean)>2*Math.PI){const ps=clean.geometry.type==='Polygon'?[clean.geometry.coordinates]:clean.geometry.coordinates;ps.forEach(p=>p.forEach(r=>r.reverse()));}return clean;
        }));
        const status=`${this.parcels.length.toLocaleString()} parcel boundaries · ${providers.filter((s,i)=>counts[i].count>0).map(s=>s.county).join(' / ')} · click a parcel to compare water layers.`;
        this.parcelStatus.textContent=status;this.cache.set(key,{parcels:this.parcels,status});if(this.cache.size>12)this.cache.delete(this.cache.keys().next().value);this.onChange();
        if(this.focusPoint){const hits=this.parcels.filter(f=>turf.booleanPointInPolygon(this.focusPoint,f,{ignoreBoundary:true}));if(hits.length===1){this.focusPoint=null;this.select(hits[0]);}else if(hits.length>1){this.focusPoint=null;this.parcelStatus.textContent+=' The requested point matches overlapping county records; choose a boundary to verify it.';}}
      }catch(error){if(error.name==='AbortError'||seq!==this.request)return;console.error(error);this.parcels=[];this.parcelStatus.textContent='County parcel boundaries could not load. Refresh or move the map to retry. No water result has been inferred.';}
    }
  }
  window.ParcelWaterLayer=ParcelWaterLayer;
  window.ParcelWaterScreen={screenParcel,polygonOverlap};
})();
