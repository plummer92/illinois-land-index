"""Build monthly aggregate residential transfer statistics from the Illinois MyDec public file."""
import argparse
import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from statistics import median
from tempfile import NamedTemporaryFile
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DATASET = "it54-y4c6"
HOST = "https://data.illinois.gov"
SOURCE = {
    "name": "Illinois Department of Revenue, MyDec PTAX-203",
    "url": HOST + "/d/" + DATASET,
    "method_url": "https://tax.illinois.gov/localgovernments/property/mydecdatafiles.html",
    "form_url": "https://tax.illinois.gov/content/dam/soi/en/web/tax/localgovernments/property/documents/ptax-203.pdf",
}
START = date(2025, 1, 1)
DEEDS = ("Warranty Deed", "Limited Warranty Deed", "Special Warranty Deed", "Trustee Deed",
         "Executor Deed", "Administrator's Deed", "Guardian's Deed", "Deed in Trust")
FLAGS = ("line_10b_sale_between_related", "line_10c_transfer_of_100", "line_10d_court_ordered_sale",
         "line_10e_sale_in_lieu_of", "line_10f_condemnation", "line_10g_short_sale",
         "line_10h_bank_reo", "line_10i_auction_sale", "line_10j_seller_buyer_is",
         "line_10k_seller_buyer_is", "line_10l_buyer_is_a_real", "line_10m_buyer_is_a_pension",
         "line_10n_buyer_is_an_adjacent", "line_10o_buyer_is_exercising", "line_10p_trade_of_property",
         "line_10q_sale_leaseback", "line_10r_other")
BANDS = [
    {"id": "under150", "label": "Under $150,000", "min": 0, "max": 150000},
    {"id": "150to250", "label": "$150,000 to under $250,000", "min": 150000, "max": 250000},
    {"id": "250to350", "label": "$250,000 to under $350,000", "min": 250000, "max": 350000},
    {"id": "350to500", "label": "$350,000 to under $500,000", "min": 350000, "max": 500000},
    {"id": "500plus", "label": "$500,000 and over", "min": 500000, "max": None},
]
AREAS = {"county": "Sangamon County", "chatham": "Chatham property-city entries"}
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "consumer-debt-dashboard/data/processed/sangamon_home_sales.json"


def read_json(url, params=None):
    if params:
        url += "?" + urlencode(params)
    with urlopen(Request(url, headers={"Accept": "application/json", "User-Agent": "Illinois-Land-Index/1.0"}), timeout=75) as response:
        return json.load(response)


def query(select, where, **options):
    return read_json(f"{HOST}/resource/{DATASET}.json", {"$select": select, "$where": where, **options})


def summary(prices):
    # Do not turn a one-transaction band into a published individual sale price.
    if not prices:
        return {"count": 0, "volume": 0, "median": None}
    if len(prices) < 5:
        return {"count": len(prices), "volume": None, "median": None}
    return {"count": len(prices), "volume": sum(prices), "median": median(prices)}


def aggregate(region, prices, latest, latest_full):
    month = START
    months = []
    while month <= latest:
        key = month.strftime("%Y-%m")
        values = prices[region, key]
        bands = []
        for band in BANDS:
            group = [p for p in values if p >= band["min"] and (band["max"] is None or p < band["max"])]
            bands.append({"id": band["id"], **summary(group)})
        months.append({"month": key, "partial": key > latest_full, **summary(values), "bands": bands})
        month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
    return {"label": AREAS[region], "months": months}


def collect():
    metadata_url = f"{HOST}/api/views/{DATASET}.json"
    version = read_json(metadata_url)["rowsUpdatedAt"]
    release = datetime.fromtimestamp(version, timezone.utc).date()
    county = "upper(line_1_county) = 'SANGAMON' and status = 'Deed Recorded'"
    last = query("max(date_recorded) as latest", county)[0]["latest"]
    latest = date.fromisoformat(last[:10])
    if latest < START or latest > release:
        raise ValueError("Unexpected recording date relative to release")
    # Wait for at least one Sangamon recording in a later month before labeling the prior month full.
    latest_full = (latest.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    instruments = ", ".join("'" + deed.replace("'", "''") + "'" for deed in DEEDS)
    where = " and ".join([county, f"date_recorded >= '{START.isoformat()}'",
        "line_8_current_use = 'B'", "line_7_property_advertised = true",
        "line_2_total_parcels = 1", "line_1_split_parcel = false", "line_3_additional_pins = false",
        "line_13_net_consideration > 0", "state_exemption is null", "line_16_state_exemption is null",
        f"line_5_instrument_type in ({instruments})", "line_10a_fulfillment_of = 0",
        *(f"{flag} = false" for flag in FLAGS)])
    check = query("count(*) as n, count(distinct declaration_id) as declarations, "
                  "count(distinct document_number) as documents, sum(line_13_net_consideration) as volume", where)[0]
    expected = int(check["n"])
    if not expected or expected != int(check["declarations"]) or expected != int(check["documents"]):
        raise ValueError("Missing or duplicate declaration/document numbers require review")
    prices = defaultdict(list)
    seen = set()
    page_size = 5000
    for offset in range(0, expected, page_size):
        records = query("declaration_id,date_recorded,line_1_city,line_13_net_consideration", where,
                        **{"$order": "declaration_id", "$offset": offset, "$limit": page_size})
        for row in records:
            transfer = row["declaration_id"]
            if transfer in seen:
                raise ValueError("Duplicate declaration in paginated results")
            seen.add(transfer)
            net = Decimal(row["line_13_net_consideration"])
            if net <= 0 or net != net.to_integral_value():
                raise ValueError("Unexpected nonpositive or fractional declared price")
            month = row["date_recorded"][:7]
            prices["county", month].append(int(net))
            if row.get("line_1_city", "").strip().upper() == "CHATHAM":
                prices["chatham", month].append(int(net))
    volume = sum(sum(group) for (key, _), group in prices.items() if key == "county")
    if len(seen) != expected or volume != Decimal(check["volume"]) or read_json(metadata_url)["rowsUpdatedAt"] != version:
        raise ValueError("Source changed during download or totals disagree")
    return {"source": SOURCE, "release_date": release.isoformat(), "latest_recorded": latest.isoformat(),
            "latest_full_month": latest_full, "bands": BANDS,
            "areas": {key: aggregate(key, prices, latest, latest_full) for key in AREAS}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    path = parser.parse_args().output
    result = collect()
    if path.is_file() and json.loads(path.read_text(encoding="utf-8"))["latest_recorded"] > result["latest_recorded"]:
        raise ValueError("Source returned an older latest recording date")
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temp:
        json.dump(result, temp, ensure_ascii=False, indent=2)
        temp.write("\n")
    Path(temp.name).replace(path)


if __name__ == "__main__":
    main()
