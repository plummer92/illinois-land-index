"""Refresh the Chatham utility-area snapshot using requests and Shapely 2.

Run from the repository root after refreshing the scored map.
"""
import json
import math
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from shapely import make_valid
from shapely.geometry import Polygon, box, mapping, shape
from shapely.ops import transform


DATA = Path("parcel-dashboard/data")
EPA = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0"
ELECTRIC = "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0"
PLAN = "https://www.chathamil.gov/files/manual/2302/2041%20Chatham%20Comp%20Plan.pdf#page=38"

# Traced outer electric distribution boundary, black line in figure 4.3, page 38.
# Coordinates on the 474 x 600 figure, cropped at (4,10) and displayed at 2x.
# Control intersections on that view: Mansion/Main (339,202), Walnut/Main
# (343,451), Walnut/Gordon (557,444). Cross-checks: Old Indian/Covered Bridge,
# the US 4 diagonal and both ends of the Main St street grid.
FIGURE_RING = [(166,201),(558,199),(558,276),(748,275),(748,357),(712,360),
               (711,428),(683,443),(689,479),(689,564),(561,564),(561,576),
               (518,576),(518,608),(505,608),(505,600),(509,600),(509,566),
               (431,566),(431,589),(392,589),(397,822),(351,823),(351,861),
               (311,861),(311,697),(234,697),(309,532),(172,534)]


def layers(url, fields, key, name, extent, extra=None):
    params = dict(f="geojson", geometryType="esriGeometryEnvelope",
                  geometry=",".join(map(str, extent)), inSR=4326, outSR=4326,
                  outFields=",".join(fields), spatialRel="esriSpatialRelIntersects",
                  returnGeometry="true", geometryPrecision=6)
    response = requests.get(url + "/query", params=params, timeout=60)
    response.raise_for_status()
    data = response.json()
    if "features" not in data or data.get("exceededTransferLimit") or not data["features"]:
        raise ValueError(f"Incomplete query against {url}")
    region = box(*extent)
    records = []
    for feature in data["features"]:
        attrs = feature["properties"]
        polygons = make_valid(shape(feature["geometry"])).intersection(region)
        if polygons.is_empty:
            continue
        if polygons.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError(f"Expected polygon for {attrs[key]}")
        record = {"id":attrs[key], "name":attrs[name], "geometry":mapping(polygons)}
        if extra:
            record.update(extra(attrs))
        records.append(record)
    return records


def build():
    parcels = json.loads((DATA / "chatham-scored-map.json").read_bytes())
    lon0, lat0 = parcels["projection"]["center"]
    scale = parcels["projection"]["scale"]
    y0 = math.asinh(math.tan(math.radians(lat0)))

    def geographic(x, y):
        return (lon0 + math.degrees(x / scale), math.degrees(math.atan(math.sinh(y0 - y/scale))))

    left, top, right, bottom = parcels["bounds"]
    west, south = geographic(left, bottom)
    east, north = geographic(right, top)
    extent = [west-.003, south-.003, east+.003, north+.003]
    water = layers(EPA, ["PWSID","PWS_Name","Symbology_Field"], "PWSID", "PWS_Name", extent,
                   lambda a: {"boundary":a["Symbology_Field"]})
    power = layers(ELECTRIC, ["ID","NAME","SOURCEDATE"], "ID", "NAME", extent,
                   lambda a: {"sourceYear":datetime.fromtimestamp(a["SOURCEDATE"]/1000, timezone.utc).year
                              if a["SOURCEDATE"] else None})
    if not any(r["id"] == "IL1670300" for r in water):
        raise ValueError("Missing reference system for Chatham")
    # Transform the figure through the same local Mercator grid as the parcel map.
    # Roughly 1 map pixel across corresponds to 19 metres. Use a generous 90 m
    # uncertainty corridor around the digitized outline; never assign its edges.
    ring = [((x-339)/1.062 + 358.7, (y-202)/.998 - 468.35) for x,y in FIGURE_RING]
    drawn = Polygon(ring)
    meters_per_unit = 6371008.8 * math.cos(math.radians(lat0)) / scale
    plan = {key:mapping(transform(geographic, drawn.buffer(m / meters_per_unit)))
            for key,m in [("interior",-90),("vicinity",90)]}
    out = {"bounds":extent, "checked":date.today().isoformat(), "water":water, "power":power,
           "plan":plan, "sources":{"water":EPA,"power":ELECTRIC,"plan":PLAN}}
    destination = DATA / "chatham-utility-areas.json"
    temp = destination.with_suffix(".tmp")
    temp.write_text(json.dumps(out, separators=(",",":"), allow_nan=False) + "\n",encoding="utf-8")
    temp.replace(destination)


if __name__ == "__main__":
    build()
