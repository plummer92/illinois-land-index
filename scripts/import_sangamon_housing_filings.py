"""Refresh Sangamon County's new eviction and foreclosure filings from Illinois Courts' public report."""

import argparse
from collections import defaultdict
from datetime import date
import gzip
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import Request, urlopen


COURTS = "https://www.illinoiscourts.gov/courts/circuit-court/illinois-circuit-court-statistical-reports/"
REPORT = "https://app.powerbigov.us/view?r=eyJrIjoiMThmYmQxZTEtYWQxMi00NDliLTliNTEtYTQ4MzYzZDJjZTNkIiwidCI6ImRjNjQxZWU0LTViNWQtNDlhMC04ZmY0LTdhYWZjNjExOGE0MiJ9"
# Public report identifier, visible in the 2022–2026 dashboard embed.
PUBLIC_KEY = "18fbd1e1-ad12-449b-9b51-a48363d2ce3d"
API = "https://wabi-us-gov-iowa-api.analysis.usgovcloudapi.net/public/reports/"
DESTINATION = Path(__file__).resolve().parents[1] / "consumer-debt-dashboard/data/processed/sangamon_housing_filings.json"
CATEGORIES = ("EVICTION", "FORECLOSURE")
FILTERS = {"COUNTY": ["SANGAMON"], "CASE_STATUS": ["New Filed"], "CASE_CATEGORY": CATEGORIES}


def request_json(endpoint, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    request = Request(API + endpoint, data=body, headers={
        "X-PowerBI-ResourceKey": PUBLIC_KEY, "Content-Type": "application/json", "Accept": "application/json"
    })
    with urlopen(request, timeout=40) as response:
        raw = response.read()
        if raw.startswith(b"\x1f\x8b"):
            raw = gzip.decompress(raw)
        return json.loads(raw)


def column(name):
    return {"Column": {"Expression": {"SourceRef": {"Source": "v"}}, "Property": name}}


def read_counts(model_id, fields):
    # This is the same public model and sum of CASES used by the court's dashboard.
    select = [dict(column(f), Name=f) for f in fields]
    select.append({"Aggregation": {"Expression": column("CASES"), "Function": 0}, "Name": "cases"})
    conditions = [{"Condition": {"In": {
        "Expressions": [column(field)], "Values": [[{"Literal": {"Value": f"'{value}'"}}] for value in values]
    }}} for field, values in FILTERS.items()]
    query = {
        "Version": 2, "From": [{"Name": "v", "Entity": "vw_QCCS_All", "Type": 0}],
        "Select": select, "Where": conditions, "OrderBy": [{"Direction": 1, "Expression": column(f)} for f in fields]
    }
    binding = {
        "Primary": {"Groupings": [{"Projections": list(range(len(select)))}]},
        "DataReduction": {"DataVolume": 3, "Primary": {"Window": {"Count": 1000}}}, "Version": 1
    }
    command = {"Commands": [{"SemanticQueryDataShapeCommand": {"Query": query, "Binding": binding}}]}
    payload = {"version": "1.0.0", "queries": [{"Query": command}], "cancelQueries": [], "modelId": model_id}
    resp = request_json("querydata?synchronous=true", payload)
    result = resp["results"][0]["result"]["data"]["dsr"]["DS"][0]
    if not result.get("IC") or result.get("RT"):
        raise ValueError("Incomplete Power BI response")
    previous = []
    for raw in result["PH"][0]["DM0"]:
        if "S" in raw:
            schema = raw["S"]
        # Power BI's R bitmask repeats preceding row values, and Ø marks nulls.
        encoded = iter(raw.get("C", []))
        row = []
        for i in range(len(schema)):
            if raw.get("R", 0) & (1 << i):
                row.append(previous[i])
            elif raw.get("Ø", 0) & (1 << i):
                raise ValueError("Unexpected null in filing aggregates")
            else:
                row.append(next(encoded))
        previous = row
        yield tuple(result["ValueDicts"][s["DN"]][v] if "DN" in s else v for s, v in zip(schema, row))


def collect(checked_on):
    metadata = request_json(f"{PUBLIC_KEY}/modelsAndExploration?preferReadOnlySession=true")
    model_id = metadata["models"][0]["id"]
    periods = defaultdict(dict)
    totals = defaultdict(int)
    for year, quarter, category, amount in read_counts(model_id, ["YEAR", "QUARTER", "CASE_CATEGORY"]):
        record = periods[year, quarter]
        if category not in CATEGORIES or category in record or type(amount) is not int or amount < 0:
            raise ValueError("Unexpected category, duplicate row or invalid count")
        record[category] = amount
        totals[year, category] += amount
    expected = {(year, category): value for year, category, value in read_counts(model_id, ["YEAR", "CASE_CATEGORY"])}
    if not periods or dict(totals) != expected:
        raise ValueError("Quarterly totals differ from the independent year grouping")
    result = []
    for i, ((year, quarter), counts) in enumerate(sorted(periods.items())):
        if set(counts) != set(CATEGORIES) or (year, quarter) != (2022 + i // 4, 1 + i % 4):
            raise ValueError(f"Incomplete quarterly series at {year} Q{quarter}")
        end = date(year + (quarter == 4), (quarter % 4) * 3 + 1, 1)
        if end > checked_on:
            continue
        result.append({"year": year, "quarter": quarter, "eviction": counts["EVICTION"], "foreclosure": counts["FORECLOSURE"]})
    if not result:
        raise ValueError("No complete quarters")
    return {"source": {"name": "Administrative Office of the Illinois Courts, Circuit Court Statistical Dashboard",
                       "url": COURTS, "dashboard_url": REPORT},
            "checked_on": checked_on.isoformat(), "quarters": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checked-on", type=date.fromisoformat, default=date.today())
    args = parser.parse_args()
    data = collect(args.checked_on)
    if DESTINATION.exists():
        previous = json.loads(DESTINATION.read_text(encoding="utf-8"))
        if len(data["quarters"]) < len(previous["quarters"]):
            raise ValueError("Source now returns fewer quarters than the published series")
    with NamedTemporaryFile(dir=DESTINATION.parent, mode="w", encoding="utf-8", delete=False) as tmp:
        json.dump(data, tmp, indent=2)
        tmp.write("\n")
    Path(tmp.name).replace(DESTINATION)


if __name__ == "__main__":
    main()
