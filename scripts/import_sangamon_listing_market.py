"""Refresh the monthly residential listings for Sangamon County from Realtor.com."""

import argparse
import csv
import io
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import Request, urlopen


LIBRARY = "https://www.realtor.com/research/data/"
SOURCE = "https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_County_History.csv"
ZIP_SOURCE = "https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv"
FIELDS = ("median_listing_price", "median_days_on_market", "active_listing_count",
          "new_listing_count", "pending_listing_count", "price_reduced_count")


def value(text):
    if text in ("", "NA"):
        return None
    number = Decimal(text)
    if not number.is_finite() or number < 0:
        raise ValueError(f"Unexpected negative or nonfinite value: {text}")
    return int(number) if number == number.to_integral_value() else float(number)


def extract_rows(source, code_key, code, name_key, name):
    result = {}
    request = Request(source, headers={"User-Agent": "Illinois Land Index (public housing research)"})
    with urlopen(request, timeout=180) as response:
        reader = csv.DictReader(io.TextIOWrapper(response, encoding="utf-8-sig", newline=""))
        for row in reader:
            if row[code_key] != code:
                continue
            if row[name_key].lower().strip() != name:
                raise ValueError("Geographic code and name disagree")
            month = datetime.strptime(row["month_date_yyyymm"], "%Y%m").date()
            if month in result or month >= date.today().replace(day=1):
                raise ValueError(f"Duplicate or unclosed month {month}")
            flag = value(row["quality_flag"])
            if flag not in (0, 1, None):
                raise ValueError(f"Unknown quality flag for {month}: {flag}")
            result[month] = {"month": month.strftime("%Y-%m"), "quality_flag": flag,
                             **{field: value(row[field]) for field in FIELDS}}
    if not result:
        raise ValueError(f"No observations for {name}")
    months = sorted(result)
    for left, right in zip(months, months[1:]):
        if (right.year - left.year) * 12 + right.month - left.month != 1:
            raise ValueError(f"Missing monthly data between {left} and {right}")
    if result[months[-1]]["quality_flag"] != 0 or any(result[months[-1]][field] is None for field in FIELDS):
        raise ValueError("Missing or flagged current data; review source before publication")
    return [result[month] for month in months]


def extract():
    county = extract_rows(SOURCE, "county_fips", "17167", "county_name", "sangamon, il")
    chatham = extract_rows(ZIP_SOURCE, "postal_code", "62629", "zip_name", "chatham, il")
    if len(county) < 13 or len(chatham) != 1 or chatham[0]["month"] != county[-1]["month"]:
        raise ValueError("Insufficient county history or inconsistent county and ZIP releases")
    return {"scope": "Sangamon County, Illinois", "fips": "17167",
            "source": {"name": "Realtor.com® Economic Research", "url": LIBRARY,
                       "download_url": SOURCE, "zip_download_url": ZIP_SOURCE},
            "months": county, "chatham_zip": {"postal_code": "62629", **chatham[0]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = extract()
    if args.output.exists():
        old = json.loads(args.output.read_text(encoding="utf-8"))
        if data["months"][-1]["month"] < old["months"][-1]["month"]:
            raise ValueError("Source has regressed to an earlier ending period")
    with NamedTemporaryFile(mode="w", encoding="utf-8", delete=False, dir=args.output.parent) as tmp:
        json.dump(data, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
    Path(tmp.name).replace(args.output)
    latest = data["months"][-1]
    print(f"Saved {len(data['months'])} months through {latest['month']}.")


if __name__ == "__main__":
    main()
