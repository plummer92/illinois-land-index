import copy
import hashlib
import unittest

from recalculate_sangamon_scores import contributions, encode, owner_rollups, scores, validate_gis


def parcel(label="UNIMPROVED RESIDENTIAL", owner="A"):
    return dict(parcel_id="00000000001", property_class=label, owner_type="Individual", active_tax_sale="N", owner_mailing_address="", site_address="", owner_parcel_count="2", normalized_owner=owner)


class RecalculationTests(unittest.TestCase):
    def test_vacant_residential_no_longer_loses_occupied_home_points(self):
        row = parcel()
        old = contributions(row, 1, 1000, 100, 1)
        new = contributions(row, 1, 1000, 100, 1, corrected=True)
        self.assertEqual(scores(new)[2] - scores(old)[2], 12)
        self.assertEqual(new[:7], old[:7])
        self.assertEqual(scores(contributions(parcel(" IMPROVED   RESIDENTIAL "), 1, 1000, 100, 1, corrected=True))[2], 13)
        self.assertEqual(scores(contributions(parcel("IMPROVED RESIDENTIAL"), 0, 1000, 100, 1, corrected=True))[2], 5)

    def test_missing_stays_missing_and_unrelated_classes_keep_rules(self):
        self.assertEqual(scores(contributions(parcel(), 0, 1000, 100, 1, corrected=True))[2], 17)
        for label in ("FARM", "IMPROVED COMMERCIAL", "IMPROVED INDUSTRIAL", "TOTALLY EXEMPT"):
            row = parcel(label)
            self.assertEqual(contributions(row, 0, 1000, 100, 1), contributions(row, 0, 1000, 100, 1, corrected=True))

    def test_backfill_cascades_to_other_parcels_in_same_owner_group(self):
        first, second, unrelated = parcel(), parcel(), parcel(owner="B")
        second["parcel_id"] = "00000000002"
        unrelated["parcel_id"] = "00000000003"
        records = [dict(row=first, acres=0), dict(row=second, acres=19.99), dict(row=unrelated, acres=10)]
        totals = owner_rollups(records, {first["parcel_id"]: 0.02})
        before = contributions(second, 19.99, 1000, 100, 19.99, corrected=True)
        after = contributions(second, 19.99, 1000, 100, totals["A"], corrected=True)
        self.assertEqual(after[5] - before[5], 5)
        self.assertEqual(totals["B"], 10)
        with self.assertRaisesRegex(ValueError, "positive raw acreage"):
            owner_rollups(records, {second["parcel_id"]: 20})

    def test_incomplete_failed_or_conflicting_gis_cannot_backfill(self):
        rank = dict(source_date="2026-11-08", rows=[["00000000001", 0, 0, 0, 0, 0, 0, 0, 1]])
        raw = encode(rank)
        gis = dict(score_file_sha256=hashlib.sha256(raw).hexdigest(), source_score_date=rank["source_date"], summary=dict(requested=1, recovered=1, missing=0, no_match=0, conflict=0, error=0), policy=dict(positive_only=True, exact_pin_match=True, conflicts_fail_closed=True, geometry_derived=False), parcels={"00000000001": dict(status="recovered", acres=0.25, method="totacres")})
        gis["quality_screen"] = dict(polygon_area_used_as_fill=False, checked_at_utc="2026-11-15T00:00:00Z", rule="recorded total agrees with complete parcel footprint", candidates_checked=1, accepted_recorded_values=1, rejected_recorded_values=0)
        gis["parcels"]["00000000001"]["quality_check"] = dict(recorded_acreage_corroborated=True)
        self.assertEqual(validate_gis(gis, rank, raw), {"00000000001": 0.25})
        for mutation in ("missing", "error", "conflict", "nan", "unaudited", "uncorroborated", "geometry_fill"):
            broken = copy.deepcopy(gis)
            if mutation == "missing":
                broken["parcels"] = {}
            elif mutation == "error":
                broken["summary"]["error"] = 1
            elif mutation == "conflict":
                broken["parcels"]["00000000001"]["status"] = "conflict"
                broken["summary"].update(recovered=0, conflict=1)
            elif mutation == "nan":
                broken["parcels"]["00000000001"]["acres"] = float("nan")
            elif mutation == "unaudited":
                broken.pop("quality_screen")
            elif mutation == "uncorroborated":
                broken["parcels"]["00000000001"].pop("quality_check")
            elif mutation == "geometry_fill":
                broken["quality_screen"]["polygon_area_used_as_fill"] = True
            with self.assertRaises(ValueError):
                validate_gis(broken, rank, raw)


if __name__ == "__main__":
    unittest.main()
