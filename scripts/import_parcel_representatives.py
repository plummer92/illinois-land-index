"""Build a sourced office-holder directory and precinct crosswalk; no voter records.

Usage: python -B scripts/import_parcel_representatives.py --evidence-dir OUTSIDE_REPO
Requires requests, beautifulsoup4 and pdfplumber. --cached uses preserved source files.
Live parcel assignment belongs to the UI: query county GIS at the selected parcel
point, reject multiple/boundary matches, and preserve split precinct districts.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urljoin, quote

import pdfplumber
import requests
from bs4 import BeautifulSoup

COUNTY = "https://sangamonil.gov"
CLERK = COUNTY + "/departments/a-c/county-clerk"
BOARD = COUNTY + "/departments/a-c/county-board"
SOURCES = {
    "county": BOARD + "/districts/members",
    "state": CLERK + "/elected-officials/state-officials",
    "federal": CLERK + "/elected-officials/federal-officials",
    "local": CLERK + "/elected-officials/local-officials/city-village-officials",
    "schools": CLERK + "/elected-officials/local-officials/school-board-members",
    "chatham": "https://www.chathamil.gov/government",
    "contact-the-board": "https://www.chathamschools.org/page/contact-the-board",
    "board-of-education-meetings": "https://www.chathamschools.org/page/board-of-education-meetings",
    "precincts": "https://sangamondepartments.blob.core.windows.net/dnnfiles/Clerk/Elections/Vote/documents/8-23Cong-Rep-Sen-CB-ListingbyPct.pdf",
}
GIS_BASE = "https://sangis.co.sangamon.il.us/server/rest/services/"
GIS = {
    "municipal": {"url": GIS_BASE + "Sangamon_MajorBoundaries/MapServer/6", "fields": ["Corp_Name"]},
    "school": {"url": GIS_BASE + "Sangamon_County_School_Districts/MapServer/0", "fields": ["SchoolDistrict"]},
    "county_board": {"url": GIS_BASE + "CountyBoardDistricts/MapServer/0", "fields": ["DISTRICT"]},
    "precinct": {"url": GIS_BASE + "ElectionPrecincts2023/MapServer/1", "fields": ["Precinct", "Name"]},
}
VOTES = {
    "municipal": "https://www.chathamil.gov/information-center?anchorAgenda",
    "county": CLERK + "/vital-records/county-board/written-minutes",
    "state": "https://www.ilga.gov/legislation/",
    "house": "https://clerk.house.gov/Votes",
    "senate": "https://www.senate.gov/legislative/votes_new.htm",
    "school": "https://chathamschools.community.diligentoneplatform.com/Portal/",
}


def normalized_precinct(value):
    value = " ".join(value.upper().split())
    match = re.search(r"\s+(\d+)$", value)
    return value[:match.start()] + " " + str(int(match[1])) if match else value + " 1"


def read_source(folder, key, cached=False):
    extension = ".pdf" if key == "precincts" else ".html"
    path = folder / (key + extension)
    if not cached:
        response = requests.get(SOURCES[key], timeout=30)
        response.raise_for_status()
        path.write_bytes(response.content)
    return path


def html(path):
    return BeautifulSoup(path.read_bytes(), "html.parser")


def official(name, office, source_url, votes_url, district=None, contact_url=None):
    result = dict(name=name, office=office, contact_url=contact_url or source_url, votes_url=votes_url, source_url=source_url)
    if district is not None:
        result["district"] = str(district)
    return result


def build(folder, output, cached=False):
    if folder.resolve().is_relative_to(output.parent.parent.parent.resolve()):
        raise ValueError("Raw evidence must remain outside the public checkout")
    folder.mkdir(parents=True, exist_ok=True)
    files = {key: read_source(folder, key, cached) for key in SOURCES}
    county = {}
    for anchor in html(files["county"]).find_all("a"):
        match = re.fullmatch(r"District\s+(\d+)", anchor.get_text(" ", strip=True))
        if not match:
            continue
        name = str(anchor.next_sibling or "").strip().lstrip("-\xa0 ")
        if not name:
            raise ValueError("County roster name missing")
        district = match[1]
        county[district] = official(name, "Sangamon County Board", SOURCES["county"], VOTES["county"], district, urljoin(COUNTY, anchor["href"]))
    if set(county) != {str(i) for i in range(1, 30)}:
        raise ValueError("Expected 29 county board districts")
    state = dict(senate={}, house={})
    for anchor in html(files["state"]).find_all("a"):
        text = anchor.get_text(" ", strip=True)
        match = re.fullmatch(r"(Senator|Representative) \((\d+)(?:st|nd|rd|th) District\) (.+) \(([DR])\)", text)
        if not match:
            continue
        role, district, name, party = match.groups()
        key = "senate" if role == "Senator" else "house"
        item = official(name, "Illinois State " + role, SOURCES["state"], VOTES["state"], district, SOURCES["state"] + quote(anchor["href"], safe="#"))
        item["party"] = party
        state[key][district] = item
    if set(state["senate"]) != {"44", "48", "54"} or set(state["house"]) != {"87", "95", "96", "108"}:
        raise ValueError("Unexpected state legislative district roster")
    federal_text = html(files["federal"]).get_text(" ", strip=True)
    for name in ("Tammy Duckworth", "Richard J. Durbin", "Nikki Budzinski", "Mary Miller"):
        if name not in federal_text:
            raise ValueError("Federal roster changed; review office holders")
    federal = dict(senators=[official("Tammy Duckworth", "U.S. Senator", SOURCES["federal"], VOTES["senate"], contact_url="https://www.duckworth.senate.gov/"), official("Richard J. Durbin", "U.S. Senator", SOURCES["federal"], VOTES["senate"], contact_url="https://www.durbin.senate.gov/")], house={"13": official("Nikki Budzinski", "U.S. Representative", SOURCES["federal"], VOTES["house"], "13", "https://budzinski.house.gov/"), "15": official("Mary Miller", "U.S. Representative", SOURCES["federal"], VOTES["house"], "15", "https://marymiller.house.gov/")})
    municipal = []
    for heading in html(files["chatham"]).find_all("h2"):
        small = heading.find("small")
        if not small:
            continue
        parts = list(small.stripped_strings)
        if not parts or parts[0] not in ("Village President", "Trustee", "Clerk"):
            continue
        name = str(heading.contents[0]).strip()
        item = official(name, parts[0], SOURCES["chatham"], VOTES["municipal"])
        item["term"] = parts[1]
        municipal.append(item)
    if len(municipal) != 8:
        raise ValueError("Expected president, six trustees and clerk")
    school_link = next(a["href"] for a in html(files["schools"]).find_all("a") if a.get_text(" ", strip=True) == "Ball-Chatham CUSD #5 Board Members")
    school_pdf = folder / "schools.pdf"
    if not cached:
        response = requests.get(school_link, timeout=30)
        response.raise_for_status()
        school_pdf.write_bytes(response.content)
    school = []
    with pdfplumber.open(school_pdf) as pdf:
        rows = pdf.pages[0].extract_table()
        for row in rows[1:]:
            item = official(" ".join(row[:2]), "Ball-Chatham school board member", SOURCES["schools"], VOTES["school"])
            item["term_ends"] = row[9]
            school.append(item)
        roster_date = re.search(r"Updated\s+(\d+/\d+/\d+)", pdf.pages[0].extract_text())
    if len(school) != 7 or not roster_date:
        raise ValueError("School roster needs review")
    school_page = html(files["contact-the-board"])
    school_state = json.loads(school_page.find("script", id="__NUXT_DATA__").string)
    school_strings = " ".join(value for value in school_state if isinstance(value, str))
    if not all(member["name"] in school_strings for member in school):
        raise ValueError("County school roster does not match the current district website")
    for member in school:
        member["source_url"] = SOURCES["contact-the-board"]
        member["contact_url"] = SOURCES["contact-the-board"]
        member["office"] = {"Ryan Murphy": "School board president", "Joe Bolletta": "School board vice president", "Amanda Ostermeier": "School board secretary"}.get(member["name"], "School board member")
    if VOTES["school"] not in files["board-of-education-meetings"].read_text(encoding="utf8"):
        raise ValueError("School meeting portal link no longer appears on the district website")
    chart = {}
    with pdfplumber.open(files["precincts"]) as pdf:
        for page in pdf.pages:
            for row in page.extract_table()[1:]:
                key = normalized_precinct(row[0])
                if key in chart or len(row) != 5:
                    raise ValueError("Ambiguous precinct chart row")
                chart[key] = {kind: [int(n) for n in re.findall(r"\d+", value)] for kind, value in zip(("congress", "senate", "house", "county_board"), row[1:])}
    gis_path = folder / "precinct-gis.json"
    if not cached:
        response = requests.get(GIS["precinct"]["url"] + "/query", params=dict(f="json", where="1=1", outFields="Precinct,Name", returnGeometry="false"), timeout=30)
        response.raise_for_status()
        gis_path.write_bytes(response.content)
    gis_result = json.loads(gis_path.read_bytes())
    if gis_result.get("error") or gis_result.get("exceededTransferLimit"):
        raise ValueError("Incomplete precinct GIS lookup")
    precincts = {}
    for feature in gis_result["features"]:
        values = feature["attributes"]
        code = values["Precinct"].upper().strip()
        key = normalized_precinct(values["Name"])
        if code in precincts or key not in chart:
            raise ValueError("Precinct GIS/chart join differs")
        precincts[code] = dict(name=values["Name"], **chart[key])
    if len(precincts) != len(chart) or len(chart) != 166:
        raise ValueError("Expected all 166 current GIS/chart precincts")
    result = dict(schema_version=1, checked_at=dt.datetime.now(dt.timezone.utc).isoformat(), officeholder_note="Names are the office holders listed by official directories when checked. Election winners are not substituted before taking office. Verify with the office if the directory is stale.", district_note="County GIS point matching is a boundary check, not official voter assignment. Split precincts retain every possible district. Confirm at the county voter lookup.", voter_lookup_url=CLERK + "/elections/vote/where-do-i-vote-view-a-sample-ballot", sources=[dict(id=k, url=v) for k, v in SOURCES.items()], local=dict(municipalities={"CHATHAM": dict(name="Village of Chatham", officials=municipal, meetings_url=VOTES["municipal"], source_url=SOURCES["chatham"])}, schools={"CHATHAM UNIT #5": dict(name="Ball-Chatham CUSD #5", officials=school, meetings_url=VOTES["school"], source_url=SOURCES["schools"], roster_updated=roster_date[1], note="County-posted school roster was updated May 1, 2025; later appointments may not appear.")}), county_board=county, state=state, federal=federal, precinct_districts=precincts, precinct_chart_date="2023-08-03", gis=GIS)
    school_group = result["local"]["schools"]["CHATHAM UNIT #5"]
    school_group["source_url"] = SOURCES["contact-the-board"]
    school_group["note"] = "All seven names were also checked against the district's current Contact the Board page. Term end years come from the county's May 2025 directory."
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf8")
    manifest = dict(checked_at=result["checked_at"], source_files={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.iterdir() if p.suffix in (".html", ".pdf", ".json") and p.name != "manifest.json"}, counts=dict(county_board=len(county), precincts=len(precincts), municipal=len(municipal), school=len(school)))
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print(json.dumps(manifest["counts"]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("parcel-dashboard/data/representatives.json"))
    parser.add_argument("--cached", action="store_true")
    args = parser.parse_args()
    build(args.evidence_dir, args.output, args.cached)
