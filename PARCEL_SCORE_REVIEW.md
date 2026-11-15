# Parcel score review — November 14, 2026

This review clarifies the existing published land-research ranking. It does not replace it with a homeowner grade, change parcel scores or rankings, or refresh county records.

## Scope and reconciliation

The published snapshot dated November 8, 2026 contains 22,707 scored parcels in 10 Sangamon County townships. All published totals equal the three component scores. All explanation patterns reconstruct their component scores and have the same source date. The explanation file's SHA-256 matches the LF-normalized score file; Git may check text files out with CRLF on Windows.

The model caps land characteristics at 40 points and ownership/purchase indicators at 35 points. Its third component begins with 25 points and subtracts classification, missing-acreage, ownership and tax-sale deductions, with a floor of zero. A higher third-component score means fewer model deductions. It is not a physical-risk assessment or a confidence measure.

## Limitations that matter to homeowners

- The model prioritizes land acquisition research and favors farms and larger lots. It does not estimate home quality, safety, condition, market value, willingness to sell, or probability of a successful purchase. Scores are point totals, not percentiles or percentages of desirable features.
- The existing upstream rule uses `cls.includes("IMPROVED RESIDENTIAL")`. This also matches `UNIMPROVED RESIDENTIAL`. Consequently all 1,385 published unimproved-residential rows receive the 12-point residential deduction, with an additional 8 points deducted when acreage is absent. This release preserves the published values and explains the current classification rule; the wording must not imply that the rule only affects houses. A future model correction requires a new, versioned calculation and review of changed rankings.
- There are 11,733 rows without positive acreage in the scoring snapshot. The upstream parser converts blank or invalid numeric fields to zero and selects the largest of three acreage fields. A stored zero therefore does not prove a lot has zero area. These rows receive no acreage or per-acre points and the missing-acreage deduction.
- There are 468 numeric zero total scores. A recorded zero, a parcel outside the published list, and a file that failed to load are different states.
- Public explanation data contains awarded assessment/tax-per-acre points, not raw input values or field-level completeness flags. Zero points can reflect absent/zero inputs or values outside the thresholds. The current public data cannot distinguish those cases.
- The ownership category is inferred from name/address text and holdings are grouped from normalized records. Those indicators do not verify an owner's intent, willingness to sell, title or record accuracy. No owner names or mailing addresses are added by this change.
- A missing upstream tax-sale file defaults parcel flags to `N`. A zero flag/count must not be described as independently verified absence of tax-sale issues.
- The score does not incorporate floodplains, wetlands, drainage, road access, utility availability, home condition or comparable sales. The current public signal summary has zero terrain-ready records. A full 25 points in the deduction component does not verify any of those physical conditions.

## Parcel maps and dates

The Chatham map contains 6,059 parcel outlines, 272 point-only locations and 11 unlocated scored parcels. Its `sourceDate` is copied from the score snapshot; the map file does not independently record when the county GIS geometry was retrieved. A point cannot establish property limits, and a GIS outline is not a boundary survey.

A live county GIS lookup can return acreage different from the stored scoring acreage. The interface may display the newer lookup result, but that does not recalculate the score. The data context must explain any difference or a newly available acreage value. A failed GIS request must remain distinguishable from a successful response with no usable geometry.

## Verification

Run `node --test scripts/test_score_context.mjs`. It reconciles every published score and explanation, verifies the source digest, and exercises zero/unavailable states, changed acreage, geometry coverage and failed/stale explanation inputs without network traffic.

Source implementation reviewed: upstream `import_sangamon_tax_zip.js` numeric parsing and `scoreBreakdown`; public `data/sangamon-parcel-scores.json`, `parcel-dashboard/data/score-reasons.json`, `data/public-signal-summary.json`, `parcel-dashboard/data/chatham-scored-map.json`, `scripts/import_chatham_scored_map.py`, and the property-result rendering code.
