import csv
import html
import json
import os
import re
import tempfile
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path

BASE = "https://assessor.boco.solutions/ASR_PublicDataFiles"
OUTPUT = Path("gilpin-county-dashboard/data/processed/colorado_property_tax_snapshot.json")
GILPIN_BASE = "https://gilpincountyco-treasurer.tylerhost.net/treasurer"


def download(name, directory):
    target = directory / name
    request = urllib.request.Request(f"{BASE}/{name}", headers={"User-Agent": "IllinoisLandIndex/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response, target.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    return target


def number(value):
    try:
        return float((value or "").replace("$", "").replace(",", "").strip())
    except ValueError:
        return 0.0


def money_from_html(pattern, source):
    plain_text = html.unescape(re.sub(r"<[^>]+>", " ", source)).replace("\xa0", " ")
    plain_text = re.sub(r"\s+", " ", plain_text)
    match = re.search(pattern, plain_text, re.IGNORECASE)
    return number(html.unescape(match.group(1))) if match else None


def gilpin_public_cookie():
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", "IllinoisLandIndex/1.0")]
    opener.open(f"{GILPIN_BASE}/web/login.jsp", timeout=60).read()
    payload = urllib.parse.urlencode({"guest": "true", "submit": "Login"}).encode()
    opener.open(f"{GILPIN_BASE}/web/loginPOST.jsp", data=payload, timeout=60).read()
    return "; ".join(f"{cookie.name}={cookie.value}" for cookie in jar)


def gilpin_tax_record(account, cookie_header):
    headers = {"User-Agent": "IllinoisLandIndex/1.0", "Cookie": cookie_header}
    account_url = f"{GILPIN_BASE}/treasurerweb/account.jsp?account={urllib.parse.quote(account)}"
    account_html = urllib.request.urlopen(urllib.request.Request(account_url, headers=headers), timeout=60).read().decode("utf-8", "replace")
    payment_date = datetime.now().strftime("%m/%d/%Y")
    query = urllib.parse.urlencode({"account": account, "paymentDate": payment_date, "paymentType": "Full"})
    inquiry_url = f"{GILPIN_BASE}/treasurerweb/inquiry.jsp?{query}"
    inquiry_html = urllib.request.urlopen(urllib.request.Request(inquiry_url, headers=headers), timeout=60).read().decode("utf-8", "replace")
    total_due = money_from_html(r"Total Due.*?\$([\d,.]+)", inquiry_html)
    total_billed = money_from_html(r"Total Billed.*?\$([\d,.]+)", account_html)
    receipts = re.findall(r"Receipt from ([^<]+)", account_html, re.IGNORECASE)
    return {
        "tax_total_due": total_due,
        "tax_total_billed": total_billed,
        "tax_payment_status": "due" if (total_due or 0) > 0 else "paid_or_current",
        "tax_receipt_count": len(receipts),
        "latest_payment_date": html.unescape(receipts[0]).strip() if receipts else "",
        "tax_updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "tax_source_url": account_url,
    }


def main():
    candidate_path = Path("gilpin-county-dashboard/data/processed/candidates-boulder.json")
    candidate_payload = json.loads(candidate_path.read_text(encoding="utf-8"))
    candidate_accounts = {
        row.get("account_number", "").strip()
        for row in candidate_payload.get("candidates", [])
        if row.get("account_number")
    }
    gilpin_candidate_path = Path("gilpin-county-dashboard/data/processed/candidates-gilpin.json")
    gilpin_payload = json.loads(gilpin_candidate_path.read_text(encoding="utf-8"))
    gilpin_accounts = [row.get("account_number", "").strip() for row in gilpin_payload.get("candidates", []) if row.get("account_number")]
    gilpin_limit = max(0, int(os.environ.get("GILPIN_TAX_LIMIT", "0")))
    if gilpin_limit:
        gilpin_accounts = gilpin_accounts[:gilpin_limit]

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

        cookie_header = gilpin_public_cookie()
        gilpin_taxes = {}
        workers = max(1, min(8, int(os.environ.get("GILPIN_TAX_WORKERS", "4"))))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(gilpin_tax_record, account, cookie_header): account for account in gilpin_accounts}
            for index, future in enumerate(as_completed(futures), 1):
                account = futures[future]
                try:
                    gilpin_taxes[account] = future.result()
                except Exception as error:
                    print(f"Gilpin tax lookup failed for {account}: {error}")
                if index % 50 == 0:
                    print(f"Loaded {index}/{len(gilpin_accounts)} Gilpin tax accounts")

        for candidate in gilpin_payload.get("candidates", []):
            candidate.update(gilpin_taxes.get(candidate.get("account_number", ""), {}))
        gilpin_candidate_path.write_text(json.dumps(gilpin_payload, indent=2) + "\n", encoding="utf-8")

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
                {
                    "name": "Gilpin",
                    "coverage": "public_treasurer_account_details",
                    "accounts": len(gilpin_taxes),
                    "accounts_due": sum(1 for row in gilpin_taxes.values() if row.get("tax_payment_status") == "due"),
                    "total_due": round(sum(row.get("tax_total_due") or 0 for row in gilpin_taxes.values()), 2),
                    "payment_status_available": True,
                    "source": f"{GILPIN_BASE}/web/login.jsp",
                },
                *[
                    {
                        "name": name,
                        "coverage": "statewide_assessment_values",
                        "payment_status_available": False,
                        "source": source,
                    }
                    for name, source in [
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
