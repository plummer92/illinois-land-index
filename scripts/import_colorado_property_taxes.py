import csv
import json
import tempfile
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://assessor.boco.solutions/ASR_PublicDataFiles"
OUTPUT = Path("gilpin-county-dashboard/data/processed/colorado_property_tax_snapshot.json")


def download(name, directory):
    target = directory / name
    request = urllib.request.Request(f"{BASE}/{name}", headers={"User-Agent": "IllinoisLandIndex/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response, target.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    return target


def number(value):
    try:
        return float((value or "").strip())
    except ValueError:
        return 0.0


def main():
    candidate_path = Path("gilpin-county-dashboard/data/processed/candidates-boulder.json")
    candidate_payload = json.loads(candidate_path.read_text(encoding="utf-8"))
    candidate_accounts = {
        row.get("account_number", "").strip()
        for row in candidate_payload.get("candidates", [])
        if row.get("account_number")
    }

    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        owners_path = download("Owner_Address.csv", directory)
        values_path = download("Values.csv", directory)

        values = {}
        tax_years = Counter()
        with values_path.open(encoding="utf-8-sig", newline="") as source:
            for row in csv.DictReader(source):
                if row.get("status_cd", "").strip() != "A":
                    continue
                strap = row.get("strap", "").strip()
                values[strap] = {
                    "actual": number(row.get("totalActualVal")),
                    "assessed": number(row.get("totalAssessedVal")),
                    "assessed_school": number(row.get("totalAssessedVal_School")),
                }
                tax_years[row.get("tax_yr", "").strip()] += 1

        accounts = 0
        estimated_tax = 0.0
        actual_value = 0.0
        assessed_value = 0.0
        mill_levies = []
        candidate_taxes = {}
        with owners_path.open(encoding="utf-8-sig", newline="") as source:
            for row in csv.DictReader(source):
                if row.get("status_cd", "").strip() != "A":
                    continue
                value = values.get(row.get("strap", "").strip())
                if not value:
                    continue
                mill = number(row.get("mill_levy"))
                accounts += 1
                actual_value += value["actual"]
                assessed_value += value["assessed"]
                estimated_tax += value["assessed"] * mill / 1000
                if mill:
                    mill_levies.append(mill)
                strap = row.get("strap", "").strip()
                if strap in candidate_accounts:
                    candidate_taxes[strap] = {
                        "estimated_annual_tax": round(value["assessed"] * mill / 1000),
                        "tax_year": tax_years.most_common(1)[0][0] if tax_years else None,
                        "mill_levy": mill,
                    }

        for path in Path("gilpin-county-dashboard/data/processed").glob("candidates-*.json"):
            public_payload = json.loads(path.read_text(encoding="utf-8"))
            for candidate in public_payload.get("candidates", []):
                if path == candidate_path:
                    candidate.update(candidate_taxes.get(candidate.get("account_number", ""), {}))
            path.write_text(json.dumps(public_payload, indent=2) + "\n", encoding="utf-8")

        generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        payload = {
            "generated_at": generated_at,
            "privacy": "Owner names and parcel identifiers are public assessor records. Owner mailing addresses are not published.",
            "counties": [
                {
                    "name": "Boulder",
                    "coverage": "official_bulk_assessor_roll",
                    "source_updated": generated_at,
                    "tax_year": tax_years.most_common(1)[0][0] if tax_years else None,
                    "accounts": accounts,
                    "total_actual_value": round(actual_value),
                    "total_assessed_value": round(assessed_value),
                    "estimated_annual_tax": round(estimated_tax),
                    "average_mill_levy": round(sum(mill_levies) / len(mill_levies), 3) if mill_levies else None,
                    "payment_status_available": False,
                    "source": "https://bouldercounty.gov/property-and-land/assessor/data-download/",
                },
                *[
                    {
                        "name": name,
                        "coverage": "statewide_assessment_values",
                        "payment_status_available": False,
                        "source": source,
                    }
                    for name, source in [
                        ("Gilpin", "https://gilpin.infoenvoy.net/Search"),
                        ("Clear Creek", "https://www.clearcreekcounty.us/443/Interactive-Maps"),
                        ("Grand", "https://www.co.grand.co.us/133/Assessors-Office"),
                        ("Jefferson", "https://propertysearch.jeffco.us/propertyrecordssearch/dashboard"),
                    ]
                ],
            ],
        }
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {OUTPUT} with {accounts:,} Boulder accounts")


if __name__ == "__main__":
    main()
