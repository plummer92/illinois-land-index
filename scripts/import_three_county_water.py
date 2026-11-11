"""Download USGS NHD water geometry for the three-county infrastructure map.

No parcel data is requested. Pagination is checked against source counts; failures
leave the last successful output untouched. Requires shapely.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
import json
import gzip
import time
from shapely.geometry import shape, mapping, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer'
context = json.loads((ROOT/'infrastructure-map/data/research-map.json').read_text(encoding='utf-8'))
region = unary_union([shape(f['geometry']) for f in context['counties'] if str(f['id']) in {'17167','17137','17117'}])
envelope = ','.join(str(round(v,6)) for v in region.bounds)
common = {'where':'1=1','geometry':envelope,'geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects'}


def get(layer, params):
    url = f'{BASE}/{layer}/query?' + urlencode(params)
    for attempt in range(4):
        try:
            with urlopen(url, timeout=55) as response:
                data = json.load(response)
            if 'error' in data:
                raise ValueError(str(data['error']))
            return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


def load(spec):
    name, layer, fields = spec
    count = get(layer, {**common,'f':'json','returnCountOnly':'true'})['count']
    features = []
    for offset in range(0,count,1500):
        batch = get(layer,{**common,'f':'geojson','outFields':fields,'returnGeometry':'true','outSR':4326,'geometryPrecision':6,'resultOffset':offset,'resultRecordCount':1500,'orderByFields':'OBJECTID ASC'})
        page = batch.get('features',[])
        if not page and offset < count:
            raise ValueError(f'{name}: empty page at {offset} / {count}')
        features.extend(page)
        print(f'{name}: {len(features)} / {count}',flush=True)
    if len(features) != count:
        raise ValueError(f'{name}: received {len(features)} / {count}')
    cleaned = []
    for f in features:
        if not f.get('geometry'):
            continue
        geometry = shape(f['geometry'])
        if not geometry.is_valid:
            geometry = geometry.buffer(0) if geometry.geom_type.endswith('Polygon') else geometry
        if not geometry.intersects(region):
            continue
        geometry = geometry.intersection(region).simplify(.00001,preserve_topology=True)
        if geometry.is_empty or geometry.geom_type == 'GeometryCollection':
            continue
        attrs = {k.lower():v for k,v in f['properties'].items()}
        props = {'name':attrs.get('gnis_name') or '', 'feature_type':attrs.get('ftype'), 'feature_code':attrs.get('fcode')}
        if 'areasqkm' in attrs:
            props['source_area_sq_km'] = attrs['areasqkm']
        if 'lengthkm' in attrs:
            props['source_length_km'] = attrs['lengthkm']
        cleaned.append({'type':'Feature','properties':props,'bbox':[round(v,6) for v in geometry.bounds],'geometry':mapping(geometry)})
    return name, {'source_layer':layer,'source_count_in_envelope':count,'count_in_counties':len(cleaned),'features':cleaned}


specs = [('waterbodies',12,'GNIS_NAME,FTYPE,FCODE,AREASQKM'),('streams',6,'gnis_name,ftype,fcode,lengthkm'),('water_areas',9,'GNIS_NAME,FTYPE,FCODE,AREASQKM')]
layers = dict(ThreadPoolExecutor(3).map(load,specs))
output = {'type':'ThreeCountyWaterInventory','metadata':{
    'retrieved_at':datetime.now(timezone.utc).isoformat(),'source':BASE,
    'counties':['Sangamon','Morgan','Macoupin'],'county_fips':['17167','17137','17117'],
    'coverage':'USGS NHD large-scale waterbodies, flowlines and water areas intersecting the three counties. Geometry clipped to the map county boundaries. Full source pagination checked. Not a complete wetlands, floodplain, groundwater or utility-service inventory.',
    'precision':'Coordinates rounded to six decimals at download; topology-preserving simplification of 0.00001 degrees. Screening geometry, not a survey.',
    'bounds':list(region.bounds)},'layers':layers}
target = ROOT/'infrastructure-map/data/three-county-water.json.gz'
temporary = target.with_suffix('.gz.tmp')
temporary.write_bytes(gzip.compress((json.dumps(output,separators=(',',':'),ensure_ascii=False)+'\n').encode('utf-8'),compresslevel=9,mtime=0))
temporary.replace(target)
manifest = {'metadata':output['metadata'],'layers':{name:{k:v for k,v in layer.items() if k!='features'} for name,layer in layers.items()}}
(target.parent/'three-county-water-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({name:layer['count_in_counties'] for name,layer in layers.items()}),flush=True)
