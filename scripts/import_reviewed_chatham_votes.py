"""Export a bounded, previously reviewed public roll-call ledger; no correspondence."""
import argparse
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
source = json.loads(args.source.read_text(encoding="utf-8-sig"))
records = []
for row in source:
    votes = {"Kristen Chiaro": row["Chiaro"], "John Fletcher": row["Fletcher"], "Tim Nice": row["Nice"]}
    if row["vote_type"] == "voice" and any(v in ("Yes", "No") for v in votes.values()):
        raise ValueError("Voice vote cannot establish an individual yes/no")
    if not row["source_url"].startswith("https://chathamil.community.highbond.com/"):
        raise ValueError("Unexpected source")
    records.append(dict(date=row["date"], item=re.sub(r"(Resolution|Ordinance)(?=\d)", r"\1 ", row["item"]),
        board_tally=row["board_tally"], votes=votes, note=row["note"], source_url=row["source_url"],
        original_pdf_pages=row["original_pdf_pages"], vote_type=row["vote_type"]))
result = dict(reviewed_at="2026-11-04", scope="Selected utility-rate and village-hall decisions reviewed for Kristen Chiaro, John Fletcher and Tim Nice, February 2024 through April 2026. This is not a complete voting history or a rating. Other trustees' individual votes have not been transcribed into this view. A voice vote does not establish an individual yes vote. Absence, abstention and opposition are different actions.", records=records)
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
