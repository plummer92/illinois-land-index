"""Refresh public water and electric service areas for Sangamon County.

Run after the Chatham utility-area import. Requires requests and Shapely 2.
"""
import json
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from shapely import get_parts, make_valid, set_precision, union_all
from shapely.geometry import mapping, shape

from import_chatham_utility_areas import ELECTRIC, EPA


DATA = Path(__file__).resolve().parents[1] / "parcel-dashboard" / "data"
COUNTIES = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1"


def query(url, **params):
    response = requests.get(url + "/query", params=params, timeout=90)
    response.raise_for_status()
    data = response.json()
    if "error" in data or data.get("exceededTransferLimit"):
        raise ValueError(f"Incomplete query against {url}: {data.get('error')}")
    return data


def service_areas(url, fields, county):
    extent = ",".join(map(str, county.bounds))
    ids = query(url, f="json", where="1=1", geometry=extent, geometryType="esriGeometryEnvelope",
                inSR=4326, spatialRel="esriSpatialRelIntersects", returnIdsOnly="true")
    oid = ids["objectIdFieldName"]
    expected = set(ids["objectIds"])
    if not expected:
        raise ValueError(f"No candidate service areas returned by {url}")
    result = query(url, f="geojson", objectIds=",".join(map(str, sorted(expected))),
                   outFields=",".join([oid, *fields]), outSR=4326, geometryPrecision=6)
    if {f["properties"][oid] for f in result["features"]} != expected:
        raise ValueError(f"Missing service-area features from {url}")
    records = []
    for feature in result["features"]:
        attrs = feature["properties"]
        clipped = make_valid(shape(feature["geometry"])).intersection(county)
        # A service polygon can touch a border or clip to a mixture of areas and lines.
        areas = [part for part in get_parts(clipped) if part.geom_type in ("Polygon", "MultiPolygon")]
        if not areas:
            continue
        geometry = set_precision(union_all(areas), 0.000001)
        if geometry.is_empty:
            continue
        record = {"id": str(attrs[fields[0]]), "name": attrs[fields[1]], "geometry": mapping(geometry)}
        if url == EPA:
            record["boundary"] = attrs["Symbology_Field"]
        else:
            stamp = attrs["SOURCEDATE"]
            record["sourceYear"] = datetime.fromtimestamp(stamp / 1000, timezone.utc).year if stamp else None
        records.append(record)
    return sorted(records, key=lambda r: r["id"])


def build():
    chatham = json.loads((DATA / "chatham-utility-areas.json").read_bytes())
    county_data = query(COUNTIES, f="geojson", where="GEOID='17167'", outFields="GEOID,NAME",
                        outSR=4326, geometryPrecision=6)
    county_feature, = county_data["features"]
    county = set_precision(make_valid(shape(county_feature["geometry"])), 0.000001)
    if county_feature["properties"]["GEOID"] != "17167" or county.is_empty:
        raise ValueError("Missing Sangamon County boundary")
    water = service_areas(EPA, ["PWSID", "PWS_Name", "Symbology_Field"], county)
    power = service_areas(ELECTRIC, ["ID", "NAME", "SOURCEDATE"], county)
    if not {"IL1670300", "IL1671200"} <= {r["id"] for r in water} or not {"3405", "17828"} <= {r["id"] for r in power}:
        raise ValueError("Missing expected Chatham or Springfield utility areas")
    result = {
        "bounds": county.bounds, "county": mapping(county), "checked": date.today().isoformat(),
        "water": water, "power": power, "plan": chatham["plan"],
        "sources": {**chatham["sources"], "county": COUNTIES}
    }
    destination = DATA / "sangamon-utility-areas.json"
    temp = destination.with_suffix(".tmp")
    temp.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    temp.replace(destination)


if __name__ == "__main__":
    build()
