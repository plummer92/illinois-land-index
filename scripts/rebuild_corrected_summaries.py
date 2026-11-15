"""Rebuild public aggregates/top ten from a verified, privately held correction.

Reads private inputs; writes only allowlisted aggregates, existing public map
features and public parcel score fields. No owner identities are exported.
The old public summary and delta must be preserved outside the repository first.
"""
import argparse
import copy
import csv
import hashlib
import json
from pathlib import Path


DERIVED_FILES = (
    "data/public-signal-summary.json",
    "data/public-signal-delta.json",
    "parcel-dashboard/data/chatham-top-parcels.json",
)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, value, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    formatting = {"separators": (",", ":")} if compact else {"indent": 2}
    path.write_text(json.dumps(value, ensure_ascii=False, **formatting) + "\n", encoding="utf-8")


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def number(value):
    return float(value or 0)


def aggregates(rows, pins):
    target = [row for row in rows if row["parcel_id"] in pins]
    assert len(target) == len(pins), "Incomplete or duplicated public parcel join"
    assert len({row["parcel_id"] for row in rows}) == len(rows), "Duplicate county PIN"
    owners = {}
    for row in rows:
        owner = owners.setdefault(row["normalized_owner"], [0, 0.0])
        owner[0] += 1
        owner[1] += number(row["acres"])
    return {
        "totals": {
            "public_target_rows": len(target),
            "full_index_rows": len(rows),
            "realistic_targets": sum(row["target_status"].lower() == "realistic" for row in target),
            "owner_rollup_count": len(owners),
            "large_owner_rollup_count": sum(count >= 10 or acres >= 100 for count, acres in owners.values()),
            "total_acres": round(sum(number(row["acres"]) for row in target), 2),
            "annual_tax_total": round(sum(number(row["annual_tax"]) for row in target), 2),
            "max_opportunity_score": max(int(row["opportunity_score"]) for row in target),
            "max_owner_parcel_count": max(int(row["owner_parcel_count"]) for row in target),
            "max_owner_total_acres": round(max(number(row["owner_total_acres"]) for row in target), 2),
        },
        "score_bands": {
            f"score_{threshold}_plus": sum(int(row["opportunity_score"]) >= threshold for row in target)
            for threshold in (80, 70, 60, 50)
        },
        "acreage_bands": {
            label: sum(number(row["acres"]) >= threshold for row in target)
            for label, threshold in (("ten_plus_acres", 10), ("twenty_plus_acres", 20),
                                     ("fifty_plus_acres", 50), ("one_hundred_plus_acres", 100))
        },
    }


def at_path(value, path):
    for part in path.split("."):
        value = value[part]
    return value


def pattern_points(pattern):
    """Export only the nine public, already verified reason-factor values."""
    return {
        "land": dict(zip(("property_class", "acreage", "assessment_per_acre", "annual_tax_per_acre"), pattern[:4])),
        "buyability": dict(zip(("owner_class", "holdings", "other_record_signals"), pattern[4:7])),
        "risk": {"base": 25, "property_class": pattern[7], "other_record_signals": pattern[8]},
    }


def rebuild(root, evidence):
    before = evidence / "derived/before"
    private = evidence / "private-source"
    old_summary = read_json(before / DERIVED_FILES[0])
    old_top = read_json(before / DERIVED_FILES[2])
    scores = read_json(root / "data/sangamon-parcel-scores.json")
    context = read_json(private / "recalculation-context.json")
    reasons = read_json(root / "parcel-dashboard/data/score-reasons.json")
    correction_report = read_json(evidence / "correction-report.json")
    acreage_check = read_json(evidence / "gis/acreage-check.json")
    assert acreage_check["quality_screen"]["polygon_area_used_as_fill"] is False
    assert correction_report["recovered_acreage_rows"] == acreage_check["summary"]["recovered"]
    baseline_rows = read_csv(private / "sangamon_parcels_index.csv")
    corrected_rows = read_csv(private / "corrected-sangamon-parcels.csv")
    pins = {row[0] for row in scores["rows"]}
    assert len(pins) == len(scores["rows"]) == 22707
    assert scores["model_version"] == context["model_version"] == reasons["model_version"]
    baseline_stats = aggregates(baseline_rows, pins)
    stats = aggregates(corrected_rows, pins)
    original = old_summary["illinois_sangamon"]
    for group, metrics in baseline_stats.items():
        for key, value in metrics.items():
            assert original[group][key] == value, f"Baseline mismatch: {group}.{key}"
    corrected_by_pin = {row["parcel_id"]: row for row in corrected_rows}
    for row in scores["rows"]:
        raw = corrected_by_pin[row[0]]
        assert row[3] == round(number(raw["acres"]), 2)
        assert row[4:8] == [int(raw[key]) for key in ("land_score", "buyability_score", "risk_score", "opportunity_score")]
        assert scores["townships"][row[1]] == raw["township"]
        assert scores["classes"][row[2]] == raw["property_class"]

    correction = {
        "type": "model_and_recorded_acreage_correction",
        "model_version": scores["model_version"],
        "tax_source_date": scores["source_date"],
        "tax_source_refreshed": False,
        "county_gis_checked_at": context["gis_checked_at"],
        "county_gis_attribute_update_date": None,
        "county_gis_quality_checked_at": acreage_check["quality_screen"]["checked_at_utc"],
        "recorded_acreage_candidates_rejected_by_quality_screen": acreage_check["quality_screen"]["rejected_recorded_values"],
        "recovered_acreage_rows": correction_report["recovered_acreage_rows"],
        "remaining_missing_acreage_rows": correction_report["after"]["missing_acreage"],
        "changed_score_rows": correction_report["score_changed_rows"],
        "note": "Recalculated scores and recorded acreage corrections; not market movement or a fresh tax-status check. County GIS retrieval time is not its attribute update date.",
    }
    summary = copy.deepcopy(old_summary)
    summary["generated_at"] = context["calculated_at"]
    summary["model_version"] = scores["model_version"]
    summary["correction"] = correction
    current = summary["illinois_sangamon"]
    for group in ("score_bands", "acreage_bands"):
        current[group] = stats[group]
    changed_totals = ("large_owner_rollup_count", "total_acres", "max_opportunity_score", "max_owner_total_acres")
    for key in changed_totals:
        current["totals"][key] = stats["totals"][key]
    # Tax facts, original source-refresh date, taxonomy, ownership count and
    # terrain are intentionally copied from the verified prior public summary.
    for key, value in stats["totals"].items():
        assert current["totals"][key] == value, f"Unexpected non-correction change: {key}"

    metric_specs = (
        ("Sangamon target rows", "totals.public_target_rows"),
        ("Score 80+ rows", "score_bands.score_80_plus"),
        ("Countywide unpaid-balance rows", "totals.taxes_due_count"),
        ("Due within 45 days", "totals.taxes_due_soon_45_days"),
        ("Large owner groups", "totals.large_owner_rollup_count"),
        ("Terrain-ready rows", "totals.terrain_ready_count"),
        ("50+ acre rows", "acreage_bands.fifty_plus_acres"),
    )
    metrics = []
    for label, path in metric_specs:
        old, new = at_path(original, path), at_path(current, path)
        metrics.append({"label": label, "path": "illinois_sangamon." + path,
                        "current": new, "previous": old, "change": new - old})
    largest = max(metrics, key=lambda item: abs(item["change"]))
    delta = {
        "generated_at": context["calculated_at"],
        "compared_to": old_summary["generated_at"],
        "comparison_type": correction["type"],
        "model_version": scores["model_version"],
        "correction": correction,
        "privacy": {"public_safe": True, "note": "Aggregate correction comparison only; no owner identities or parcel identifiers."},
        "illinois_sangamon": {
            "has_previous_summary": True,
            "metrics": metrics,
            "largest_movement": largest,
            "summary_line": "Model and recorded-acreage correction compared with the previously published summary. These changes do not measure market activity; tax-status figures retain their prior snapshot.",
        },
    }

    top = copy.deepcopy(old_top)
    geometry = read_json(root / "parcel-dashboard/data/chatham-scored-map.json")
    old_by_pin = {row["pin"]: row for row in old_top["parcels"]}
    chatham = scores["townships"].index("CHATHAM")
    ranked = sorted((row for row in scores["rows"] if row[1] == chatham and row[8] == 1), key=lambda row: (-row[7], row[0]))[:10]
    top["parcels"] = []
    for rank, row in enumerate(ranked, 1):
        pin = row[0]
        prior = old_by_pin.get(pin)
        item = copy.deepcopy(prior) if prior else {
            "pin": pin, "road": "Parcel " + pin, "label": "Parcel " + pin,
            "village": "Village boundary location not separately verified",
        }
        if not prior:
            mapped = geometry["parcels"].get(pin)
            assert mapped and mapped.get("pt"), f"No verified existing map feature for {pin}"
            item.update({"pt": mapped["pt"], "geo": mapped.get("d", ""),
                         "bounds": [mapped["b"][:2], mapped["b"][2:]]})
        unchanged = prior and [prior[key] for key in ("ac", "land", "buy", "risk", "score")] == row[3:8]
        item.update({"n": rank, "ac": row[3], "land": row[4], "buy": row[5],
                     "risk": row[6], "score": row[7], "cls": scores["classes"][row[2]].title()})
        if not unchanged:
            item["points"] = pattern_points(context["parcels"][pin]["factors"])
        assert min(40, sum(item["points"]["land"].values())) == row[4]
        assert min(35, sum(item["points"]["buyability"].values())) == row[5]
        assert max(0, sum(item["points"]["risk"].values())) == row[6]
        top["parcels"].append(item)
    top.update({"sourceDate": scores["source_date"], "model_version": scores["model_version"],
                "calculated_at": context["calculated_at"], "county_gis_checked_at": context["gis_checked_at"],
                "scope": "Chatham Township parcels in the model's realistic group; not an availability or value ranking",
                "tie_break": "Total score descending, then parcel PIN ascending",
                "geometry_note": "Existing verified map geometry retained; this score recalculation did not refresh parcel boundaries."})
    if set(old_by_pin) != {row[0] for row in ranked}:
        bounds = [item["bounds"] for item in top["parcels"]]
        top["bounds"] = [[min(b[0][0] for b in bounds), min(b[0][1] for b in bounds)],
                         [max(b[1][0] for b in bounds), max(b[1][1] for b in bounds)]]

    outputs = dict(zip(DERIVED_FILES, (summary, delta, top)))
    for relative, value in outputs.items():
        compact = relative.endswith("chatham-top-parcels.json")
        write_json(root / relative, value, compact)
        write_json(evidence / "derived/after" / relative, value, compact)
    report = {
        "model_version": scores["model_version"], "calculated_at": context["calculated_at"],
        "baseline_aggregate_match": True, "baseline": baseline_stats, "corrected": stats,
        "top_ten_changed": [row["pin"] for row in old_top["parcels"]] != [row[0] for row in ranked],
        "tax_facts_unchanged": True,
        "sha256": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in DERIVED_FILES},
    }
    write_json(evidence / "derived/validation-report.json", report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    result = rebuild(args.root, args.evidence)
    print(json.dumps({key: result[key] for key in ("model_version", "baseline_aggregate_match", "top_ten_changed", "tax_facts_unchanged")}, indent=2))
