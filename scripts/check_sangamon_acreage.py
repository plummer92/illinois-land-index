"""Check recorded county GIS acreage for missing score inputs; never derive area.

Run from the public checkout, with requests installed:
  python scripts/check_sangamon_acreage.py --out-dir <PRIVATE_EVIDENCE_DIR>

The output is an evidence candidate, not a score overwrite. Only explicit PIN,
acreage attributes and object IDs are requested. No owner/address/geometry data.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time

import requests

HOST = "https://sangis.co.sangamon.il.us/server/rest/services/"
SOURCES = [
    {"id": "parcel", "path": "TyleratENTParcels/MapServer/0", "pin": "PIN", "oid": "OID", "acreage": "TOTACRES"},
    {"id": "point", "path": "SangCadastral/MapServer/6", "pin": "SOA.SANGIS.Parcel_Point.PIN",
     "oid": "SOA.SANGIS.Parcel_Point.OBJECTID", "acreage": "SOA.SANGIS.Parcel_Point.TOTACRES",
     "join_pin": "SOA.SANGIS.Reg_ptinfo.PIN1", "farm": "SOA.SANGIS.Reg_ptinfo.FarmAcres",
     "nonfarm": "SOA.SANGIS.Reg_ptinfo.NonFarmAcres"},
    {"id": "condominium", "path": "SangCadastral/MapServer/4", "pin": "PIN", "oid": "OBJECTID", "acreage": "TOTACRES"},
]
TOLERANCE = 0.0001  # Handles single-precision assessor fields; about 4.36 sq ft.


def now():
    return datetime.now(timezone.utc).isoformat()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def request_json(url, params, method="POST"):
    last = None
    for attempt in range(3):
        try:
            response = requests.post(url, data=params, timeout=45) if method == "POST" else requests.get(url, params=params, timeout=45)
            response.raise_for_status()
            data = response.json()
            if "error" in data:
                raise ValueError(str(data["error"]))
            return data
        except (ValueError, requests.RequestException) as error:
            last = error
            if attempt < 2:
                time.sleep(1 + attempt)
    raise RuntimeError(f"County query failed: {last}")


def fields(source):
    return [source[key] for key in ["oid", "pin", "acreage", "join_pin", "farm", "nonfarm"] if key in source]


def batch(source, pins, index, directory, reuse_cache=False):
    path = directory / source["id"] / f"batch-{index:04}.json"
    signature = hashlib.sha256("\n".join(pins).encode()).hexdigest()
    if reuse_cache and path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))
        if cached.get("pin_sha256") == signature and cached.get("complete") and cached.get("fields") == fields(source):
            return cached
    url = HOST + source["path"] + "/query"
    where = source["pin"] + " IN (" + ",".join("'" + pin + "'" for pin in pins) + ")"
    common = {"f": "json", "where": where, "returnGeometry": "false"}
    started = now()
    count_result = request_json(url, {**common, "returnCountOnly": "true"})
    count = count_result.get("count")
    if not isinstance(count, int) or count < 0:
        raise ValueError("Invalid county feature count")
    features, pages = [], []
    offset = 0
    while offset < count or not pages:
        data = request_json(url, {**common, "outFields": ",".join(fields(source)),
                                 "orderByFields": source["oid"], "resultOffset": offset, "resultRecordCount": 2000})
        page = data.get("features")
        if not isinstance(page, list):
            raise ValueError("Missing county feature array")
        for feature in page:
            attributes = feature.get("attributes", {})
            if "geometry" in feature or set(attributes) - set(fields(source)):
                raise ValueError("Unexpected fields or geometry returned")
            if str(attributes.get(source["pin"], "")) not in pins:
                raise ValueError("Returned PIN does not exactly match requested set")
        pages.append(data)
        features.extend(page)
        if not data.get("exceededTransferLimit"):
            break
        if not page:
            raise ValueError("County pagination stopped before completion")
        offset += len(page)
    if len(features) != count:
        raise ValueError(f"County count/pagination mismatch {len(features)} != {count}")
    result = {"source": source["id"], "url": url, "fields": fields(source), "pins": pins,
              "pin_sha256": signature, "started_at_utc": started, "checked_at_utc": now(),
              "complete": True, "expected_count": count, "returned_count": len(features),
              "count_response": count_result, "pages": pages}
    save(path, result)
    return result


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def reconcile(records, errors):
    if errors:
        return {"status": "error", "acres": None, "method": None, "sources": [],
                "record_count": len(records), "reason": "One or more required county layer checks failed", "errors": errors}
    if not records:
        return {"status": "no_match", "acres": None, "method": None, "sources": [],
                "record_count": 0, "reason": "No exact PIN match in the three county layers"}
    candidates = []
    join_mismatches = 0
    for source, attributes in records:
        total = attributes.get(source["acreage"])
        if finite(total) and total > 0:
            candidates.append((float(total), source["id"], "totacres"))
        if "join_pin" in source:
            if attributes.get(source["join_pin"]) != attributes.get(source["pin"]):
                join_mismatches += 1
                continue
            farm, nonfarm = attributes.get(source["farm"]), attributes.get(source["nonfarm"])
            if finite(farm) and finite(nonfarm) and farm >= 0 and nonfarm >= 0 and farm + nonfarm > 0:
                candidates.append((float(farm + nonfarm), source["id"], "assessor_component_sum"))
    if not candidates:
        return {"status": "missing", "acres": None, "method": None,
                "sources": sorted({source["id"] for source, _ in records}), "record_count": len(records),
                "reason": "Exact county matches contain no positive recorded total or usable acreage component sum",
                "ignored_join_mismatches": join_mismatches}
    values = [candidate[0] for candidate in candidates]
    if max(values) - min(values) > TOLERANCE:
        return {"status": "conflict", "acres": None, "method": None,
                "sources": sorted({candidate[1] for candidate in candidates}), "record_count": len(records),
                "reason": "Positive acreage attributes disagree; no value chosen",
                "candidate_values": sorted(set(round(value, 6) for value in values))}
    # Prefer a directly recorded total over a sum, then polygon before point/condo.
    order = {"parcel": 0, "point": 1, "condominium": 2}
    chosen = min(candidates, key=lambda value: (value[2] != "totacres", order[value[1]]))
    return {"status": "recovered", "acres": round(chosen[0], 6), "method": chosen[2],
            "sources": sorted({candidate[1] for candidate in candidates}), "selected_source": chosen[1],
            "record_count": len(records), "reason": "Positive recorded acreage; all positive candidates agree within tolerance",
            "ignored_join_mismatches": join_mismatches}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scores", type=Path, default=Path("data/sangamon-parcel-scores.json"))
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 5))
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--resume", action="store_true", help="Reuse completed evidence batches, retaining their actual retrieval dates")
    args = parser.parse_args()
    score_text = args.scores.read_text(encoding="utf-8")
    scores = json.loads(score_text)
    pins = sorted(row[0] for row in scores["rows"] if not finite(row[3]) or row[3] <= 0)
    if len(set(pins)) != len(pins) or not all(len(pin) == 11 and pin.isdigit() for pin in pins):
        raise ValueError("Invalid or duplicate requested PIN")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for source in SOURCES:
        metadata = request_json(HOST + source["path"], {"f": "json"}, "GET")
        declared = {field["name"] for field in metadata.get("fields", [])}
        oid = next(field["name"] for field in metadata["fields"] if field["type"] == "esriFieldTypeOID")
        source["oid"] = oid
        if set(fields(source)) - declared:
            raise ValueError(f"Expected acreage fields missing from {source['id']}")
        save(args.out_dir / f"metadata-{source['id']}.json", metadata)
    groups = [pins[index:index + args.batch_size] for index in range(0, len(pins), args.batch_size)]
    records, errors = defaultdict(list), defaultdict(list)
    retrieval_starts, retrieval_ends = [], []
    progress = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks = {pool.submit(batch, source, group, index, args.out_dir, args.resume): (source, group)
                 for source in SOURCES for index, group in enumerate(groups)}
        for task in as_completed(tasks):
            source, group = tasks[task]
            try:
                result = task.result()
                retrieval_starts.append(result["started_at_utc"])
                retrieval_ends.append(result["checked_at_utc"])
                for page in result["pages"]:
                    for feature in page["features"]:
                        attributes = feature["attributes"]
                        records[str(attributes[source["pin"]])].append((source, attributes))
            except Exception as error:
                for pin in group:
                    errors[pin].append(source["id"] + ": " + str(error))
            progress += 1
            if progress % 15 == 0 or progress == len(tasks):
                print(f"Checked {progress}/{len(tasks)} layer batches", flush=True)
    parcels = {pin: reconcile(records[pin], errors[pin]) for pin in pins}
    counts = Counter(parcel["status"] for parcel in parcels.values())
    result = {"schema_version": 1, "checked_at_utc": max(retrieval_ends) if retrieval_ends else None,
              "retrieval_started_at_utc": min(retrieval_starts) if retrieval_starts else None,
              "compiled_at_utc": now(), "source_score_date": scores["source_date"],
              "score_file_sha256": hashlib.sha256(score_text.replace("\r\n", "\n").encode()).hexdigest(),
              "sources": [{"id": source["id"], "url": HOST + source["path"], "fields": fields(source),
                           "units": "recorded acres; no geometry area conversion", "source_update_date": None} for source in SOURCES],
              "policy": {"positive_only": True, "exact_pin_match": True, "conflicts_fail_closed": True,
                         "geometry_derived": False, "comparison_tolerance_acres": TOLERANCE,
                         "component_sum_requires_both_nonnegative_and_matching_join_pin": True,
                         "date_note": "checked_at_utc is retrieval time; county metadata supplies no attribute update date"},
              "summary": {"requested": len(pins), **{status: counts[status] for status in ["recovered", "missing", "no_match", "conflict", "error"]}},
              "parcels": parcels}
    save(args.out_dir / "acreage-check.json", result)
    print(json.dumps(result["summary"], indent=2), flush=True)
    if counts["error"]:
        raise SystemExit("Incomplete county check; no failed-batch acreage may be accepted")


if __name__ == "__main__":
    main()
