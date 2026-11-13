"""Build the Chatham scored-parcel map from the ranked snapshot and county GIS.

Run from the public repository root with Python 3.10+, requests and shapely 2:
    python scripts/import_chatham_scored_map.py
"""
import argparse
import json
import math
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from shapely import make_valid
from shapely.geometry import MultiPolygon, box, shape
from shapely.ops import transform, unary_union

HOST = "https://sangis.co.sangamon.il.us/server/rest/services/"
PARCEL = "TyleratENTParcels/MapServer/0"
CONDO = "SangCadastral/MapServer/4"
POINT = "SangCadastral/MapServer/6"
POINT_PIN = "SOA.SANGIS.Parcel_Point.PIN"
STREETS = "SangamonCountyStreets/MapServer/2"
VILLAGE = "Sangamon_MajorBoundaries/MapServer/6"
CENTER = [-89.746, 39.657]
SCALE = 500000
Y_ORIGIN = math.asinh(math.tan(math.radians(CENTER[1])))
METRES_PER_UNIT = 6371008.8 * math.cos(math.radians(CENTER[1])) / SCALE


def query(layer, params):
    url = HOST + layer + "/query"
    for attempt in range(3):
        try:
            response = requests.get(url, params=params, timeout=45)
            response.raise_for_status()
            data = response.json()
            if data.get("error") or data.get("exceededTransferLimit"):
                raise ValueError(f"Incomplete response from {layer}")
            return data
        except (ValueError, requests.RequestException):
            if attempt == 2:
                raise


def batches(items, size):
    ordered = sorted(items)
    return [ordered[i:i + size] for i in range(0, len(ordered), size)]


def all_features(layer, fields, queries):
    def fetch(params):
        return query(layer, {"f": "geojson", "outFields": fields, "returnGeometry": "true",
                             "outSR": 4326, "geometryPrecision": 7, **params})["features"]
    with ThreadPoolExecutor(max_workers=5) as pool:
        return [feature for group in pool.map(fetch, queries) for feature in group]


def by_pin(layer, field, pins):
    clauses = []
    for group in batches(pins, 90):
        if not all(len(pin) == 11 and pin.isdigit() for pin in group):
            raise ValueError("Invalid PIN")
        clauses.append({"where": field + " IN (" + ",".join("'" + p + "'" for p in group) + ")"})
    return all_features(layer, field, clauses)


def in_envelope(layer, fields, extent):
    ids = query(layer, {"f": "json", "where": "1=1", "returnIdsOnly": "true",
                        "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                        "spatialRel": "esriSpatialRelIntersects", "geometry": ",".join(map(str, extent))})["objectIds"]
    return all_features(layer, fields, [{"objectIds": ",".join(map(str, group))} for group in batches(set(ids), 120)])


def project(x, y, z=None):
    return (SCALE * math.radians(x - CENTER[0]), SCALE * (Y_ORIGIN - math.asinh(math.tan(math.radians(y)))))


def rounded(point):
    return [round(float(x), 3) for x in point]


def coord(x):
    return f"{x:.3f}".rstrip("0").rstrip(".")


def line_path(line, closed=False):
    coords = list(line.coords)
    if closed:
        coords = coords[:-1]
    return "M" + "L".join(coord(x) + "," + coord(y) for x, y, *_ in coords) + ("Z" if closed else "")


def pieces(g, kind):
    if g is None or g.is_empty:
        return
    if g.geom_type == kind:
        yield g
    elif g.geom_type.startswith("Multi") or g.geom_type == "GeometryCollection":
        for part in g.geoms:
            yield from pieces(part, kind)


def polygon_shapes(shapes):
    polygons = [p for g in shapes for p in pieces(g if g.is_valid else make_valid(g), "Polygon")]
    if not polygons:
        return None
    merged = unary_union(polygons)
    return merged if merged.geom_type in ("Polygon", "MultiPolygon") else MultiPolygon(list(pieces(merged, "Polygon")))


def polygon_entry(g):
    parts = list(pieces(g, "Polygon"))
    pt = max(parts, key=lambda p: p.area).representative_point()
    path = "".join(line_path(ring, True) for poly in parts for ring in [poly.exterior, *poly.interiors])
    return {"d": path, "b": rounded(g.bounds), "pt": rounded(pt.coords[0])}


def indexed(features, field, scores):
    found = defaultdict(list)
    for feature in features:
        pin = feature["properties"][field]
        if pin in scores and feature["geometry"]:
            found[pin].append(shape(feature["geometry"]))
    return found


def build(rank_file, destination):
    rank = json.loads(rank_file.read_bytes())
    scores = {r[0]: r for r in rank["rows"]}
    township = {pin for pin, row in scores.items() if rank["townships"][row[1]] == "CHATHAM"}
    if not township:
        raise ValueError("Missing township")
    limits = all_features(VILLAGE, "Corp_Name", [{"where": "UPPER(Corp_Name) = 'CHATHAM'"}])
    village_ll = polygon_shapes([shape(f["geometry"]) for f in limits])
    village = transform(project, village_ll)
    # Survey lines traced by different county layers can disagree slightly. Require
    # one square metre inside a half-metre inset before adding a bordering township.
    interior = village.buffer(-0.5 / METRES_PER_UNIT)
    near = indexed(in_envelope(PARCEL, "PIN", village_ll.bounds), "PIN", scores)
    near_condos = indexed(in_envelope(CONDO, "PIN", village_ll.bounds), "PIN", scores)
    near_points = indexed(in_envelope(POINT, POINT_PIN, village_ll.bounds), POINT_PIN, scores)
    addition = set()
    for pin in (near.keys() | near_condos.keys() | near_points.keys()) - township:
        g = polygon_shapes(near.get(pin) or near_condos.get(pin, []))
        if g is not None:
            projected = transform(project, g)
            if projected.intersects(interior) and projected.intersection(interior).area * METRES_PER_UNIT**2 >= 1:
                addition.add(pin)
        elif any(village_ll.covers(pt) for pt in near_points[pin]):
            addition.add(pin)

    scope = township | addition
    # Requery the whole PIN; a village-envelope intersection can omit its other pieces.
    polygons = indexed(by_pin(PARCEL, "PIN", scope), "PIN", scope)
    condos = indexed(by_pin(CONDO, "PIN", scope - polygons.keys()), "PIN", scope)
    polygons.update(condos)
    markers = indexed(by_pin(POINT, POINT_PIN, scope - polygons.keys()), POINT_PIN, scope)
    entries, missing, raw_bounds = {}, [], [village_ll.bounds]
    for pin in sorted(scope):
        g = polygon_shapes(polygons.get(pin, []))
        if g is not None:
            raw_bounds.append(g.bounds)
            entries[pin] = polygon_entry(transform(project, g))
        elif markers.get(pin):
            # A county unit point is a locator, never substitute its parent polygon.
            coords = sorted({tuple(pt.coords[0]) for pt in markers[pin]})
            if len(coords) != 1:
                raise ValueError(f"Ambiguous county point for {pin}")
            x, y = rounded(project(*coords[0]))
            entries[pin] = {"locationType": "point", "pt": [x, y], "b": [x, y, x, y]}
            raw_bounds.append((*coords[0], *coords[0]))
        else:
            missing.append(pin)
    ll = [min(b[0] for b in raw_bounds) - .0025, min(b[1] for b in raw_bounds) - .002,
          max(b[2] for b in raw_bounds) + .0025, max(b[3] for b in raw_bounds) + .002]
    frame = box(*ll)
    roads = []
    for f in in_envelope(STREETS, "DISPTEXT,CLASS", ll):
        if not f["geometry"]:
            continue
        for line in pieces(shape(f["geometry"]).intersection(frame), "LineString"):
            road = transform(project, line).simplify(.035)
            if road.length < .04:
                continue
            roads.append({"name": (f["properties"]["DISPTEXT"] or "").strip().title(),
                          "cls": f["properties"]["CLASS"], "d": line_path(road),
                          "b": rounded(road.bounds), "pt": rounded(road.interpolate(.5, normalized=True).coords[0])})
    vb = rounded(village.bounds)
    bounds = [vb] + [item["b"] for item in entries.values()]
    extent = [min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)]
    points = sum(v.get("locationType") == "point" for v in entries.values())
    output = {
        "sourceDate": rank["source_date"], "projection": {"center": CENTER, "scale": SCALE},
        "unitsPerMile": round(1609.344 / METRES_PER_UNIT, 5), "bounds": extent, "parcels": entries,
        "roads": roads, "village": polygon_entry(village), "missing": missing,
        "coverage": {"townshipScored": len(township), "townshipMapped": len(township & entries.keys()),
                     "villageAdditional": len(addition), "mapped": len(entries), "total": len(scope),
                     "polygons": len(entries)-points, "points": points, "unlocated": len(missing)},
        "sources": {"parcels": HOST+PARCEL, "points": HOST+POINT, "condominiums": HOST+CONDO,
                    "village": HOST+VILLAGE, "roads": HOST+STREETS},
    }
    staging = destination.with_suffix(".tmp")
    staging.write_text(json.dumps(output, separators=(",", ":"), allow_nan=False)+"\n",encoding="utf-8")
    staging.replace(destination)
    print(json.dumps(output["coverage"]), "roads", len(roads), "bytes", destination.stat().st_size)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ranks", type=Path, default=Path("data/sangamon-parcel-scores.json"))
    parser.add_argument("--out", type=Path, default=Path("parcel-dashboard/data/chatham-scored-map.json"))
    args = parser.parse_args()
    build(args.ranks, args.out)
