"""Build the county bankruptcy comparison from the U.S. Courts F-5A workbooks.

Run with Python and openpyxl. The report periods are successive federal fiscal years.
"""

import json
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import urlopen

from openpyxl import load_workbook

DATA = Path(__file__).resolve().parents[1] / "consumer-debt-dashboard" / "data" / "processed"
COURTS = "https://www.uscourts.gov"


def load_period(year, county_names):
    workbook_url = f"{COURTS}/sites/default/files/document/bf_f5a_0930.{year}.xlsx"
    with urlopen(workbook_url, timeout=45) as response:
        workbook = load_workbook(BytesIO(response.read()), read_only=True, data_only=True)
    counties = {}
    try:
        rows = workbook["Table F-5A"].values
        _, title, columns, groups, chapters = (next(rows) for _ in range(5))
        if (f"12-Month Period Ending September 30, {year}" not in title[0]
                or columns[2].split() != ["Total", "All", "Chapters"]
                or (groups[7], groups[12]) != ("Business", "Nonbusiness")
                or chapters[7].split() != ["All", "Chapters"]
                or chapters[12].split() != ["All", "Chapters"]):
            raise ValueError(f"Unexpected F-5A reporting period or columns in {year}")

        for row in rows:
            # The same county can appear under multiple districts. A trailing star
            # means the county is outside the district in which the cases were filed.
            fips = str(row[1]).strip().rstrip("*")
            if fips not in county_names:
                continue
            name = county_names[fips]
            if row[0].strip().casefold() != name.removesuffix(" County").casefold():
                raise ValueError(f"County name does not match {fips} in {year}")
            total, business, nonbusiness = (int(row[i]) for i in (2, 7, 12))
            if min(total, business, nonbusiness) < 0 or total != business + nonbusiness:
                raise ValueError(f"Inconsistent F-5A counts for {name} in {year}")
            county = counties.setdefault(fips, {"fips": fips, "county": name, "total": 0, "nonbusiness": 0})
            county["total"] += total
            county["nonbusiness"] += nonbusiness
    finally:
        workbook.close()
    if counties.keys() != county_names.keys():
        raise ValueError(f"Incomplete county coverage in {year}")
    return {
        "start": f"{year - 1}-10-01",
        "end": f"{year}-09-30",
        "source_url": f"{COURTS}/data-news/data-tables/{year}/09/30/bankruptcy-filings/f-5a",
        "workbook_url": workbook_url,
        "counties": [counties[fips] for fips in county_names],
    }


def main():
    snapshot = json.loads((DATA / "county_debt_snapshot.json").read_text(encoding="utf-8"))
    names = {item["fips"]: item["county"] for item in snapshot["counties"]}
    result = {
        "source": "United States Courts, Bankruptcy Filings, Table F-5A",
        "unit": "Bankruptcy cases commenced, all chapters",
        "method": "Cases are summed by county code across filing districts. Nonbusiness cases are a subset of total filings, classified by the predominant nature of debt.",
        "periods": [load_period(year, names) for year in (2025, 2026)],
    }
    with NamedTemporaryFile(mode="w", dir=DATA, encoding="utf-8", delete=False) as out:
        json.dump(result, out, indent=2)
        out.write("\n")
    Path(out.name).replace(DATA / "county_bankruptcies.json")


if __name__ == "__main__":
    main()
