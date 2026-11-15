"""Reject recorded acreage that is inconsistent with the county parcel footprint.

Polygon area is used only to reject suspect recorded values, never as a fill.
This is a conservative quality screen, not a boundary survey. Original
attribute-only retrieval and all request responses remain outside the public repo.
"""
import argparse
import copy
import json
import math
import shutil
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests


LAYER = "https://sangis.co.sangamon.il.us/server/rest/services/TyleratENTParcels/MapServer/0"
AREA_FIELD = "Shape.STArea()"
ALLOWED = {"OID", "PIN", "TOTACRES", AREA_FIELD}
SQUARE_FEET_PER_ACRE = 43560


def now():
    return datetime.now(timezone.utc).isoformat()


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def request(parameters):
    for attempt in range(3):
        try:
            response = requests.post(LAYER + "/query", data={"f": "json", **parameters}, timeout=60)
            response.raise_for_status()
            value = response.json()
            if "error" in value:
                raise ValueError(value["error"])
            return value
        except (requests.RequestException, ValueError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def accept_recorded_area(recorded_acres, polygon_acres):
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and
               math.isfinite(value) and value > 0 for value in (recorded_acres, polygon_acres)):
        return False
    return abs(recorded_acres - polygon_acres) <= max(0.03, 0.15 * polygon_acres)


def group_polygon_features(features):
    """Repeated OIDs are not extra acreage; contradictory copies fail closed."""
    by_pin, oid_records = {}, {}
    for feature in features:
        row = feature["attributes"]
        oid = row["OID"]
        if oid in oid_records:
            assert oid_records[oid] == row, "Conflicting records for one object ID"
            continue
        oid_records[oid] = row
        by_pin.setdefault(row["PIN"], []).append(row)
    return by_pin


def screen(directory, resume=False):
    final_path = directory / "acreage-check.json"
    attribute_path = directory / "acreage-check-attribute-only.json"
    if not attribute_path.exists():
        shutil.copy2(final_path, attribute_path)
    original = load(attribute_path)
    candidates = {pin: row for pin, row in original["parcels"].items() if row["status"] == "recovered"}
    pins = sorted(candidates)
    metadata = load(directory / "metadata-parcel.json")
    assert metadata["sourceSpatialReference"]["latestWkid"] == 3436
    assert AREA_FIELD in {field["name"] for field in metadata["fields"]}
    out = directory / "area-sanity"
    out.mkdir(exist_ok=True)

    def batch(item):
        index, requested = item
        path = out / f"batch-{index:03}.json"
        if resume and path.exists():
            value = load(path)
        else:
            where = "PIN IN (" + ",".join("'" + pin + "'" for pin in requested) + ")"
            count = request({"where": where, "returnCountOnly": "true"})["count"]
            response = request({"where": where, "outFields": ",".join(sorted(ALLOWED)),
                                "returnGeometry": "false", "orderByFields": "OID", "resultRecordCount": "2000"})
            value = {"checked_at_utc": now(), "url": LAYER + "/query", "requested_pins": requested,
                     "expected_count": count, "response": response}
            save(path, value)
        assert value["requested_pins"] == requested and value["url"] == LAYER + "/query"
        response = value["response"]
        assert not response.get("exceededTransferLimit")
        assert len(response["features"]) == value["expected_count"]
        for feature in response["features"]:
            assert "geometry" not in feature
            assert set(feature["attributes"]) <= ALLOWED
            assert feature["attributes"]["PIN"] in requested
        return value

    with ThreadPoolExecutor(max_workers=2) as pool:
        batches = list(pool.map(batch, enumerate([pins[start:start + 250] for start in range(0, len(pins), 250)])))
    # Verify the stored area is in the stated native coordinate units rather than
    # the service's display Web Mercator coordinates. This independent shoelace
    # check is not used to derive any replacement parcel acreage.
    units_path = out / "native-units-check.json"
    units = load(units_path) if resume and units_path.exists() else request({
        "where": "PIN='20190379022'", "outFields": "OID,PIN," + AREA_FIELD,
        "returnGeometry": "true", "outSR": "3436"})
    save(units_path, units)
    assert units["spatialReference"]["latestWkid"] == 3436 and len(units["features"]) == 1
    sample = units["features"][0]
    rings = sample["geometry"]["rings"]
    polygon_area = abs(sum(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) for ring in rings)) / 2
    assert abs(polygon_area - sample["attributes"][AREA_FIELD]) / polygon_area < 1e-6

    # Deduplicate identical OIDs, reject conflicting copies, and sum separately
    # identified polygon records only. Multiparts within one feature are already
    # included in its official area field.
    by_pin = group_polygon_features([feature for batch_value in batches for feature in batch_value["response"]["features"]])

    checked_at = max(batch_value["checked_at_utc"] for batch_value in batches)
    final = copy.deepcopy(original)
    quality_rows = []
    for pin, candidate in candidates.items():
        polygons = by_pin.get(pin, [])
        areas = [row[AREA_FIELD] for row in polygons]
        usable = bool(areas) and all(isinstance(area, (int, float)) and math.isfinite(area) and area > 0 for area in areas)
        footprint_acres = sum(areas) / SQUARE_FEET_PER_ACRE if usable else None
        # Different object IDs do not by themselves prove disjoint geometries.
        # Summed multi-record area is diagnostic only unless separately resolved.
        accepted = usable and len(polygons) == 1 and accept_recorded_area(candidate["acres"], footprint_acres)
        row = final["parcels"][pin]
        row["quality_check"] = {"recorded_acreage_corroborated": bool(accepted),
                                "polygon_record_count": len(polygons), "checked_at_utc": checked_at}
        if not accepted:
            row.update({"status": "conflict" if usable else "missing", "acres": None,
                        "method": None, "selected_source": None, "candidate_values": [candidate["acres"]],
                        "reason": "recorded_acreage_does_not_match_parcel_footprint" if usable else "footprint_not_available_for_quality_check"})
        quality_rows.append({"pin": pin, "recorded_acres": candidate["acres"],
                             "polygon_record_count": len(polygons), "polygon_area_acres_check_only": footprint_acres,
                             "accepted_recorded_value": bool(accepted),
                             "absolute_difference": abs(candidate["acres"] - footprint_acres) if usable else None,
                             "allowed_difference": max(0.03, 0.15 * footprint_acres) if usable else None})
    counts = Counter(row["status"] for row in final["parcels"].values())
    final["summary"] = {"requested": len(final["parcels"]), **{key: counts[key] for key in ("recovered", "missing", "no_match", "conflict", "error")}}
    final["quality_screen"] = {
        "checked_at_utc": checked_at, "candidates_checked": len(candidates),
        "accepted_recorded_values": sum(row["accepted_recorded_value"] for row in quality_rows),
        "rejected_recorded_values": sum(not row["accepted_recorded_value"] for row in quality_rows),
        "polygon_area_used_as_fill": False,
        "rule": "Accept recorded acreage only for one unambiguous polygon feature when absolute difference from complete county polygon area is <= max(0.03 acre, 15% of polygon acres). Otherwise keep acreage missing or conflicted.",
        "area_source": LAYER, "field": AREA_FIELD, "source_crs": 3436,
        "source_crs_units": "US survey feet", "area_field_units": "square US survey feet",
        "units_primary_reference": "https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/doing-business/manuals-guides-and-handbooks/highways/cadd/IDOT%20ORD%20Survey%20Training.pdf",
        "unit_check": "Native EPSG3436 polygon area independently agrees with the stored area field; service display CRS is not used.",
        "limitation": "GIS-footprint agreement is a quality screen, not a legal survey or independently updated assessor record.",
    }
    final["compiled_at_utc"] = now()
    save(out / "quality-screen.json", {"summary": final["quality_screen"], "rows": quality_rows})
    save(final_path, final)
    return final["summary"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--resume", action="store_true", help="Reuse and validate cached count-verified batches")
    args = parser.parse_args()
    print(json.dumps(screen(args.directory, args.resume), indent=2))
