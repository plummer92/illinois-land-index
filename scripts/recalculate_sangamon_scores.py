"""Reproduce the private November baseline, then apply reviewed scoring corrections.

Only explicit public fields are exported. All raw inputs, corrected CSVs and the
audit report must stay in an evidence directory outside the public checkout.
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile

MODEL_VERSION = "2026-11-14-residential-acreage-v2"


def number(value):
    result = float((value or "0").strip().replace("$", "").replace(",", "") or "0")
    if not math.isfinite(result):
        raise ValueError("Non-finite source number")
    return result


def normalized_class(value):
    return " ".join(value.upper().split())


def contributions(row, acres, assessed, annual_tax, owner_acres, corrected=False):
    cls = row["property_class"].upper()
    owner = row["owner_type"]
    public_group = owner in ("Government", "Utility / Railroad", "Nonprofit / Church")
    sale = row["active_tax_sale"] == "Y"
    mailing = row["owner_mailing_address"].upper()
    site = row["site_address"].upper()
    land_class = 15 * any(s in cls for s in ("FARM", "VACANT", "UNIMPROVED")) + 5 * ("UNIMPROVED RESIDENTIAL" in cls)
    size = sum(weight for limit, weight in [(1, 4), (2, 5), (5, 5), (10, 6)] if acres >= limit)
    assessment = 3 * (acres > 0 and 0 < assessed / acres <= 5000)
    tax = 2 * (acres > 0 and 0 < annual_tax / acres <= 150)
    owner_class = {"Individual": 8, "Trust / Estate": 9, "Business / Farm Entity": 5}.get(owner, 0) - 22 * public_group
    holdings = 6 * (int(row["owner_parcel_count"]) >= 2) + 5 * (owner_acres >= 20) + 3 * (owner_acres >= 100)
    other_buy = 3 * bool(mailing and site and mailing.split(",")[0] not in site) + 2 * bool(mailing and "CHATHAM" not in mailing) + 10 * sale
    improved = normalized_class(cls) == "IMPROVED RESIDENTIAL" if corrected else "IMPROVED RESIDENTIAL" in cls
    property_risk = -8 * (not acres) - 12 * improved - 14 * ("COMMERCIAL" in cls or "INDUSTRIAL" in cls) - 12 * ("TOTALLY EXEMPT" in cls)
    other_risk = -4 * sale - 12 * public_group
    return (land_class, size, assessment, tax, owner_class, holdings, other_buy, property_risk, other_risk)


def scores(values):
    parts = [min(40, sum(values[:4])), min(35, max(0, sum(values[4:7]))), min(25, max(0, 25 + sum(values[7:])))]
    return parts + [sum(parts)]


def load_county(source_dir, expected_date):
    records = []
    holdings = defaultdict(float)
    counts = Counter()
    seen = set()
    with ZipFile(source_dir / "documents_20261108.zip") as source:
        info = source.getinfo("Combined_Data_File")
        if dt.date(*info.date_time[:3]).isoformat() != expected_date:
            raise ValueError("Raw archive source date differs from baseline")
        with source.open(info) as raw_stream, (source_dir / "sangamon_parcels_index.csv").open(encoding="utf-8-sig", newline="") as imported:
            raw_rows = (r for r in csv.reader(io.TextIOWrapper(raw_stream, encoding="utf-8", errors="replace", newline="")) if len(r) >= 101)
            reader = csv.DictReader(imported)
            for raw, row in zip(raw_rows, reader, strict=True):
                pin = raw[0].strip()
                if pin in seen or pin != row["parcel_id"] or row["township"] != raw[35].strip() or row["property_class"] != raw[37].strip():
                    raise ValueError("Raw and imported records differ or duplicate PIN")
                seen.add(pin)
                acres = max(number(raw[i]) for i in (38, 39, 87))
                assessed = number(raw[46]) or number(raw[64]) or number(raw[86])
                tax = number(raw[90]) or number(raw[94]) or number(raw[88])
                if acres < 0:
                    raise ValueError("Negative raw acreage")
                holdings[row["normalized_owner"]] += acres
                counts[row["normalized_owner"]] += 1
                records.append(dict(row=row, acres=acres, assessed=assessed, tax=tax))
            fields = reader.fieldnames
    for record in records:
        row = record["row"]
        group = row["normalized_owner"]
        if int(row["owner_parcel_count"]) != counts[group] or float(row["owner_total_acres"]) != float(format(holdings[group], ".2f")):
            raise ValueError("Imported owner rollup differs from raw county rollup")
    return records, holdings, fields


def validate_baseline(rank, reasons, records, holdings, rank_bytes):
    public = {r[0]: r for r in rank["rows"]}
    if len(public) != len(rank["rows"]) or set(public) != set(reasons["rows"]):
        raise ValueError("Baseline public/reason PIN set differs or duplicates")
    if reasons["rank_file_sha256"] != hashlib.sha256(rank_bytes).hexdigest():
        raise ValueError("Baseline reason/ranking hash differs")
    seen = set()
    for record in records:
        row = record["row"]
        pin = row["parcel_id"]
        values = contributions(row, record["acres"], record["assessed"], record["tax"], holdings[row["normalized_owner"]])
        old_scores = scores(values)
        if old_scores != [int(row[k]) for k in ("land_score", "buyability_score", "risk_score", "opportunity_score")]:
            raise ValueError("Old raw model does not reproduce private county scores")
        if pin not in public:
            continue
        seen.add(pin)
        old = public[pin]
        if (rank["townships"][old[1]], rank["classes"][old[2]], old[3], old[8]) != (row["township"], row["property_class"], float(row["acres"]), int(row["target_status"] == "Realistic")):
            raise ValueError("Baseline public attributes differ from private input")
        if old[4:8] != old_scores or list(values) != reasons["patterns"][reasons["rows"][pin]]:
            raise ValueError("Old raw model does not reproduce public scores and reasons")
        if old[3] == 0 and record["acres"] != 0:
            raise ValueError("Rounded-zero acreage needs separate handling")
    if seen != set(public):
        raise ValueError("Missing baseline public PIN in raw county records")


def validate_gis(gis, rank, rank_bytes):
    missing = {r[0] for r in rank["rows"] if r[3] == 0}
    if gis["score_file_sha256"] != hashlib.sha256(rank_bytes).hexdigest() or gis["source_score_date"] != rank["source_date"]:
        raise ValueError("GIS check belongs to a different ranking snapshot")
    if set(gis["parcels"]) != missing or gis["summary"]["requested"] != len(missing):
        raise ValueError("GIS check does not cover every missing-acreage PIN")
    statuses = Counter(record["status"] for record in gis["parcels"].values())
    if statuses.get("error", 0) or gis["summary"].get("error", 0):
        raise ValueError("GIS errors remain unresolved")
    if set(statuses) - {"recovered", "missing", "no_match", "conflict"}:
        raise ValueError("Unknown GIS result status")
    for key in ("recovered", "missing", "no_match", "conflict"):
        if statuses.get(key, 0) != gis["summary"].get(key, 0):
            raise ValueError("GIS status count mismatch")
    policy = gis["policy"]
    if not all(policy.get(k) for k in ("positive_only", "exact_pin_match", "conflicts_fail_closed")) or policy.get("geometry_derived") is not False:
        raise ValueError("GIS policy is not an exact-PIN recorded-acreage backfill")
    quality = gis.get("quality_screen")
    rejected = sum(r.get("reason") == "recorded_acreage_does_not_match_parcel_footprint" for r in gis["parcels"].values())
    if (not quality or quality.get("polygon_area_used_as_fill") is not False
            or not quality.get("checked_at_utc") or not quality.get("rule")
            or quality.get("accepted_recorded_values") != statuses.get("recovered", 0)
            or quality.get("rejected_recorded_values") != rejected
            or quality.get("candidates_checked") != statuses.get("recovered", 0) + rejected):
        raise ValueError("GIS recorded acreage requires a completed parcel-footprint quality screen")
    recovered = {}
    for pin, record in gis["parcels"].items():
        if record["status"] != "recovered":
            if record.get("acres") is not None:
                raise ValueError("Unresolved GIS acreage must remain missing")
            continue
        value = record["acres"]
        if record.get("quality_check", {}).get("recorded_acreage_corroborated") is not True:
            raise ValueError("Recovered acreage lacks parcel-footprint corroboration")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 or record["method"] != "totacres":
            raise ValueError("Invalid recovered recorded acreage")
        recovered[pin] = value
    return recovered


def owner_rollups(records, recovered):
    holdings = defaultdict(float)
    for record in records:
        row = record["row"]
        pin = row["parcel_id"]
        if pin in recovered and record["acres"] != 0:
            raise ValueError("Refusing to replace existing positive raw acreage")
        holdings[row["normalized_owner"]] += recovered.get(pin, record["acres"])
    return holdings


def aggregate(rows):
    return {"rows": len(rows), "missing_acreage": sum(r[3] == 0 for r in rows), "realistic_targets": sum(r[8] for r in rows), "score_bands": {f"score_{n}_plus": sum(r[7] >= n for r in rows) for n in (50, 60, 70, 80, 90)}, "zero_scores": sum(r[7] == 0 for r in rows)}


def encode(payload):
    return (json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def recalculate(source_dir, baseline_dir, gis_path, output_root, evidence_dir, calculated_at):
    if evidence_dir.resolve().is_relative_to(output_root.resolve()) or source_dir.resolve().is_relative_to(output_root.resolve()):
        raise ValueError("Private sources and evidence must be outside the public checkout")
    rank_bytes = (baseline_dir / "sangamon-parcel-scores.json").read_bytes().replace(b"\r\n", b"\n")
    rank = json.loads(rank_bytes)
    reasons = json.loads((baseline_dir / "score-reasons.json").read_bytes())
    gis = json.loads(gis_path.read_bytes())
    records, old_holdings, fields = load_county(source_dir, rank["source_date"])
    validate_baseline(rank, reasons, records, old_holdings, rank_bytes)
    recovered = validate_gis(gis, rank, rank_bytes)
    holdings = owner_rollups(records, recovered)
    public = {r[0]: r for r in rank["rows"]}
    next_rows, factors, private_rows, context = [], {}, [], {}
    class_only_changes = acreage_changes = holding_changes = 0
    for record in records:
        row = record["row"]
        pin, group = row["parcel_id"], row["normalized_owner"]
        acres = recovered.get(pin, record["acres"])
        values = contributions(row, acres, record["assessed"], record["tax"], holdings[group], corrected=True)
        corrected_scores = scores(values)
        updated = dict(row)
        updated["acres"] = format(acres, ".2f")
        updated["owner_total_acres"] = format(holdings[group], ".2f")
        for key, value in zip(("land_score", "buyability_score", "risk_score", "opportunity_score"), corrected_scores):
            updated[key] = str(value)
        private_rows.append(updated)
        if pin not in public:
            continue
        old = public[pin]
        published_acres = acres if pin in recovered else old[3]
        new = old[:3] + [published_acres] + corrected_scores + [old[8]]
        if new[7] < old[7]:
            raise ValueError("Unexpected score decrease from additive correction")
        next_rows.append(new)
        factors[pin] = values
        old_values = reasons["patterns"][reasons["rows"][pin]]
        just_class = contributions(row, record["acres"], record["assessed"], record["tax"], old_holdings[group], corrected=True)
        class_only_changes += scores(just_class) != old[4:8]
        acreage_changes += pin in recovered
        holding_changes += values[5] != old_values[5]
        context[pin] = {"acres": acres, "old_acres": record["acres"], "assessed": record["assessed"], "annual_tax": record["tax"], "owner_total_acres": holdings[group], "old_owner_total_acres": old_holdings[group], "factors": values, "scores": corrected_scores}
    next_rows.sort(key=lambda r: (-r[7], r[0]))
    metadata = dict(model_version=MODEL_VERSION, calculated_at=calculated_at, gis_checked_at=gis["checked_at_utc"], gis_quality_checked_at=gis["quality_screen"]["checked_at_utc"])
    result = dict(source_date=rank["source_date"], **metadata, acreage_check_summary=gis["summary"], townships=rank["townships"], classes=rank["classes"], rows=next_rows)
    result_bytes = encode(result)
    patterns, reason_rows = {}, {}
    for row in next_rows:
        values = factors[row[0]]
        reason_rows[row[0]] = patterns.setdefault(values, len(patterns))
    reason_result = dict(source_date=rank["source_date"], **metadata, rank_file_sha256=hashlib.sha256(result_bytes).hexdigest(), patterns=list(patterns), rows=reason_rows)
    acreage_result = dict(model_version=MODEL_VERSION, checked_at_utc=gis["checked_at_utc"], sources=[{k: s[k] for k in ("id", "url", "fields", "units")} for s in gis["sources"]], summary=gis["summary"], quality_screen=gis["quality_screen"], parcels={pin: {k: row.get(k) for k in ("status", "acres", "method", "sources", "reason", "selected_source")} for pin, row in gis["parcels"].items()})
    changes = [{"pin": row[0], "before": public[row[0]], "after": row, "before_factors": reasons["patterns"][reasons["rows"][row[0]]], "after_factors": list(factors[row[0]])} for row in next_rows if row != public[row[0]]]
    report = dict(source_date=rank["source_date"], **metadata, validation={"county_rows": len(records), "public_rows": len(public), "baseline_exact": True, "baseline_reason_patterns": len(reasons["patterns"]), "gis_requested": len(gis["parcels"]), "gis_errors": 0}, before=aggregate(rank["rows"]), after=aggregate(next_rows), changed_rows=len(changes), score_changed_rows=sum(row[7] != public[row[0]][7] for row in next_rows), recovered_acreage_rows=acreage_changes, class_rule_score_changes=class_only_changes, holdings_factor_changes=holding_changes, changes=changes)
    # No writes occur until all source, coverage and score assertions have passed.
    evidence_dir.mkdir(parents=True, exist_ok=True)
    (evidence_dir / "correction-report.json").write_bytes(encode(report))
    (evidence_dir / "private-source").mkdir(exist_ok=True)
    with (evidence_dir / "private-source" / "corrected-sangamon-parcels.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(private_rows)
    (evidence_dir / "private-source" / "recalculation-context.json").write_bytes(encode(dict(source_date=rank["source_date"], **metadata, parcels=context)))
    outputs = {"data/sangamon-parcel-scores.json": result_bytes, "parcel-dashboard/data/score-reasons.json": encode(reason_result), "parcel-dashboard/data/acreage-check.json": encode(acreage_result)}
    for name, payload in outputs.items():
        destination = output_root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
    print(json.dumps({k: v for k, v in report.items() if k != "changes"}, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source-dir", "baseline-dir", "gis", "output-root", "evidence-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--calculated-at", default=dt.datetime.now(dt.timezone.utc).isoformat())
    args = parser.parse_args()
    recalculate(args.source_dir, args.baseline_dir, args.gis, args.output_root, args.evidence_dir, args.calculated_at)
