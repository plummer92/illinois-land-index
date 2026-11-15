"""Conservative acreage-selection tests. No network or private source files."""
import unittest

from check_sangamon_acreage import SOURCES, TOLERANCE, reconcile
from screen_sangamon_acreage import accept_recorded_area, group_polygon_features


class AcreageSelectionTests(unittest.TestCase):
    def record(self, source, total=None, farm=None, nonfarm=None, joined=True):
        attributes = {source["pin"]: "fixture", source["acreage"]: total}
        if "join_pin" in source:
            attributes.update({source["join_pin"]: "fixture" if joined else "other",
                               source["farm"]: farm, source["nonfarm"]: nonfarm})
        return source, attributes

    def test_missing_zero_and_negative_do_not_become_usable_acres(self):
        for value in [None, 0, -1, float("nan"), float("inf"), "2", True]:
            result = reconcile([self.record(SOURCES[0], value)], [])
            self.assertEqual(result["status"], "missing")
            self.assertIsNone(result["acres"])

    def test_no_match_and_failed_layer_are_separate(self):
        self.assertEqual(reconcile([], [])["status"], "no_match")
        result = reconcile([self.record(SOURCES[0], 2)], ["point: incomplete"])
        self.assertEqual(result["status"], "error")
        self.assertIsNone(result["acres"])

    def test_positive_recorded_total_is_candidate_for_later_quality_screen(self):
        result = reconcile([self.record(SOURCES[0], 0.25)], [])
        self.assertEqual(result["status"], "recovered")
        self.assertEqual(result["acres"], .25)
        self.assertEqual(result["method"], "totacres")

    def test_duplicate_equal_records_do_not_sum_parcel_area(self):
        records = [self.record(SOURCES[0], 2), self.record(SOURCES[0], 2)]
        result = reconcile(records, [])
        self.assertEqual(result["acres"], 2)
        self.assertEqual(result["record_count"], 2)

    def test_conflicting_positive_totals_fail_closed(self):
        for source in [SOURCES[0], SOURCES[1]]:
            result = reconcile([self.record(SOURCES[0], .12), self.record(source, 135.47)], [])
            self.assertEqual(result["status"], "conflict")
            self.assertIsNone(result["acres"])

    def test_components_require_both_fields_and_matching_join(self):
        for farm, nonfarm, joined in [(1, None, True), (None, 1, True), (-1, 2, True), (1, 2, False)]:
            result = reconcile([self.record(SOURCES[1], None, farm, nonfarm, joined)], [])
            self.assertEqual(result["status"], "missing")
        result = reconcile([self.record(SOURCES[1], None, 0, 1)], [])
        self.assertEqual(result["acres"], 1)
        self.assertEqual(result["method"], "assessor_component_sum")

    def test_component_conflict_blocks_total(self):
        result = reconcile([self.record(SOURCES[1], 3, 1, 1)], [])
        self.assertEqual(result["status"], "conflict")
        self.assertIsNone(result["acres"])

    def test_small_float_noise_prefers_direct_polygon_value(self):
        records = [self.record(SOURCES[1], .3, 0, .300000011920929), self.record(SOURCES[0], .3)]
        result = reconcile(records, [])
        self.assertEqual(result["acres"], .3)
        self.assertEqual(result["selected_source"], "parcel")
        self.assertEqual(result["method"], "totacres")
        result = reconcile([self.record(SOURCES[0], 1), self.record(SOURCES[1], 1 + TOLERANCE * 2)], [])
        self.assertEqual(result["status"], "conflict")


class AcreageFootprintScreenTests(unittest.TestCase):
    def test_copied_parent_tract_values_fail_even_with_exact_pin_match(self):
        self.assertFalse(accept_recorded_area(5.72, 10300.395190492109 / 43560))
        self.assertFalse(accept_recorded_area(21.87, 11579.659294766521 / 43560))
        self.assertFalse(accept_recorded_area(41.47, 11406.422932570582 / 43560))

    def test_recorded_values_close_to_footprint_pass_without_substitution(self):
        self.assertTrue(accept_recorded_area(.14, 6110.843248846419 / 43560))
        self.assertTrue(accept_recorded_area(4.06, 4.3371))
        self.assertFalse(accept_recorded_area(.30, .2407))

    def test_small_parcel_absolute_tolerance_and_large_parcel_relative_tolerance(self):
        self.assertTrue(accept_recorded_area(.12, .1))
        self.assertFalse(accept_recorded_area(.14, .1))
        self.assertTrue(accept_recorded_area(1.1, 1))
        self.assertFalse(accept_recorded_area(1.2, 1))

    def test_missing_or_nonfinite_footprint_never_passes(self):
        for value in [None, True, "1", 0, -1, float("nan"), float("inf")]:
            self.assertFalse(accept_recorded_area(1, value))

    def test_same_polygon_oid_is_not_counted_twice(self):
        feature = {"attributes": {"OID": 1, "PIN": "fixture", "Shape.STArea()": 100}}
        self.assertEqual(len(group_polygon_features([feature, feature])["fixture"]), 1)
        second_part = {"attributes": {"OID": 2, "PIN": "fixture", "Shape.STArea()": 200}}
        self.assertEqual(len(group_polygon_features([feature, second_part])["fixture"]), 2)

    def test_contradictory_duplicate_oid_fails_closed(self):
        first = {"attributes": {"OID": 1, "PIN": "fixture", "Shape.STArea()": 100}}
        conflicting = {"attributes": {"OID": 1, "PIN": "fixture", "Shape.STArea()": 200}}
        with self.assertRaises(AssertionError):
            group_polygon_features([first, conflicting])


if __name__ == "__main__":
    unittest.main()
