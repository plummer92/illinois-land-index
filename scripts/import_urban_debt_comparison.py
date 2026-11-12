"""Publish the matched Urban Institute August 2025 and August 2026 credit snapshots.

Run from any directory with Python 3.10+. Only aggregate observations are retained.
"""

import csv
import io
import json
import math
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import Request, urlopen


DASHBOARD = Path(__file__).resolve().parents[1] / "consumer-debt-dashboard"
OUTPUT = DASHBOARD / "data/processed/urban_county_comparison.json"
PUBLISHER = "https://apps.urban.org/features/debt-interactive-map"
LICENSE = "https://opendatacommons.org/licenses/by/1-0/"

# Use the two dated CSV collections powering the publisher's own interactive.
RELEASES = {
    "2025-08": ("20251023-update", "Breno Braga, Signe-Mary McKernan, Samantha Atherton, and Kassandra Martinchek"),
    "2026-08": ("20261022-update", "Breno Braga, Signe-Mary McKernan, and Thea Garon"),
}
COUNTIES = {
    "17167": "Sangamon County",
    "17017": "Cass County",
    "17021": "Christian County",
    "17107": "Logan County",
    "17115": "Macon County",
    "17117": "Macoupin County",
    "17129": "Menard County",
    "17135": "Montgomery County",
    "17137": "Morgan County",
}

# key, source table, column for the whole population, unit, label, eligible group
METRICS = [
    ("collections_rate", "overall", "totcoll", "rate", "Debt in collections", "Share of people with a credit record showing a collection account."),
    ("median_collections_debt", "overall", "totcollpos_p50", "usd", "Median debt in collections", "Middle dollar amount among people whose credit records show debt in collections."),
    ("credit_card_delinquency_rate", "overall", "carddelrate", "rate", "Credit card delinquency", "Share of people carrying credit or charge card debt who are at least 60 days late."),
    ("median_credit_card_delinquent_debt", "overall", "carddelpos_p50", "usd", "Median delinquent credit card debt", "Middle amount in delinquent credit or charge card debt among people with a delinquent card."),
    ("auto_retail_delinquency_rate", "overall", "autoretdelrate", "rate", "Auto or retail loan delinquency", "Share of auto loan, auto lease or retail installment borrowers who are at least 60 days late."),
    ("share_with_auto_loans", "auto", "autoopen", "rate", "People with an auto loan or lease", "Share of people with a credit record who have an auto loan or vehicle lease."),
    ("share_with_auto_retail_debt", "auto", "autoretopen", "rate", "People with auto or retail debt", "Share of people with a credit record who have an auto loan, auto lease or retail installment loan."),
    ("student_loan_delinquency_rate", "overall", "stddelderogofstdtot", "rate", "Student loan delinquency", "Share of student borrowers whose loans are in default or at least 60 days late."),
    ("share_with_student_loan_debt", "student", "stdtot", "rate", "People with student debt", "Share of people with a credit record showing student debt, including deferred and delinquent accounts."),
    ("median_student_loan_debt", "student", "stdtotpos_p50", "usd", "Median student loan debt", "Middle student debt balance among people who have student loans."),
    ("median_monthly_student_loan_payment", "student", "stdmonthpos_p50", "usd", "Median monthly student payment", "Middle monthly payment owed by people who have open student loan accounts."),
]


def read_csv(url, expected_ids, columns):
    request = Request(url, headers={"User-Agent": "IllinoisLandIndex/1.0"})
    with urlopen(request, timeout=30) as response:
        reader = csv.DictReader(io.TextIOWrapper(response, encoding="utf-8-sig", newline=""))
        missing = {"id", *columns} - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{url} is missing columns {sorted(missing)}")
        rows = {}
        for row in reader:
            place_id = row["id"]
            if place_id in expected_ids:
                if place_id in rows:
                    raise ValueError(f"Duplicate geography {place_id} in {url}")
                rows[place_id] = row
    if rows.keys() != expected_ids:
        raise ValueError(f"Missing places in {url}: {sorted(expected_ids - rows.keys())}")
    return rows


def observation(raw, unit):
    if raw.strip().upper() in {"NA", "N/A", ""}:
        return None
    value = float(raw)
    if not math.isfinite(value) or value < 0 or (unit == "rate" and value > 1):
        raise ValueError(f"Invalid {unit} value: {raw!r}")
    return value


def main():
    places = {
        key: {"id": key, "name": name, "type": "county", "values": {}}
        for key, name in COUNTIES.items()
    }
    for key, name, kind in [("17", "Illinois", "state"), ("USA", "United States", "national")]:
        places[key] = {"id": key, "name": name, "type": kind, "values": {}}

    sources = []
    for period, (directory, authors) in RELEASES.items():
        year = period[:4]
        files = []
        for place in places.values():
            place["values"][period] = {}
        for table in sorted({metric[1] for metric in METRICS}):
            measures = [entry for entry in METRICS if entry[1] == table]
            for level, ids in [("county", set(COUNTIES)), ("state_national", {"17", "USA"})]:
                url = f"{PUBLISHER}/data/{directory}/{level}_{table}.csv"
                rows = read_csv(url, ids, [entry[2] for entry in measures])
                files.append(url)
                for place_id, row in rows.items():
                    source_name = row["county"] if level == "county" else row["state"]
                    expected_name = "USA" if place_id == "USA" else places[place_id]["name"]
                    if source_name != expected_name:
                        raise ValueError(f"Name mismatch for {place_id}: {source_name!r}")
                    for key, _, column, unit, _, _ in measures:
                        places[place_id]["values"][period][key] = observation(row[column], unit)
        sources.append({
            "period": period, "label": f"Debt in America {year}", "authors": authors,
            "url": ("https://datacatalog.urban.org/dataset/debt-america-2026"
                    if year == "2026" else
                    "https://github.com/UrbanInstitute/debt-interactive-map/tree/master/data/20251023-update"),
            "appendix": f"{PUBLISHER}/downloadable-docs/debt_interactive_technical_appendix_{year}.pdf",
            "files": files,
        })

    result = {
        "periods": list(RELEASES),
        "metrics": {
            key: {"label": label, "unit": unit, "definition": definition, "source_column": column}
            for key, _, column, unit, label, definition in METRICS
        },
        "places": list(places.values()),
        "sources": sources,
        "attribution": "Adapted from Urban Institute, Debt in America, August 2025 and August 2026 credit bureau estimates.",
        "license": {"label": "Open Data Commons Attribution License (ODC-By)", "url": LICENSE},
    }
    # Build and validate the complete result before atomically replacing the live snapshot.
    with NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=OUTPUT.parent, delete=False) as stream:
        json.dump(result, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")
        staged = Path(stream.name)
    staged.replace(OUTPUT)


if __name__ == "__main__":
    main()
