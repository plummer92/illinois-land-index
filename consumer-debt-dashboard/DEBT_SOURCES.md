# County debt comparison

The public dashboard uses 11 aggregate credit measures from the Urban Institute's August 2025 and August 2026 releases. Each release covers a nationally representative 4 percent sample of deidentified credit records. The measures refer to the populations specified in the metric definitions. Both releases define card and auto/retail delinquency as at least 60 days late. Student loan delinquency also includes default.

Sangamon County and its eight Illinois neighbors are listed individually. The Illinois and United States benchmarks come directly from the publisher's state and national tables. The national and state figures represent their full respective geographies.

Each year's dollar measures use the dollars reported for that year. A difference between years combines changes in balances, prices and the group observed. Rate differences are expressed in percentage points. Urban suppresses credit measures based on fewer than 50 people. Missing or suppressed figures are stored as JSON null. The site does not use population counts to extrapolate borrower delinquency rates.

Illinois restricts reporting of medical debt on credit records. The displayed county comparisons omit this measure because the credit figures cannot establish how many residents owe medical bills. Consumer-level data are unavailable in this dataset.

## Release files and credit

- Breno Braga, Signe-Mary McKernan, and Thea Garon, *Debt in America*, updated November 9, 2026. [Urban Data Catalog](https://datacatalog.urban.org/dataset/debt-america-2026) · [August 2026 county CSV](https://apps.urban.org/features/debt-interactive-map/data/20261022-update/county_overall.csv) · [August 2026 state and national CSV](https://apps.urban.org/features/debt-interactive-map/data/20261022-update/state_national_overall.csv) · [2026 technical appendix](https://apps.urban.org/features/debt-interactive-map/downloadable-docs/debt_interactive_technical_appendix_2026.pdf)
- Breno Braga, Signe-Mary McKernan, Samantha Atherton, and Kassandra Martinchek, *Debt in America*, 2025 edition. [Publisher's archived data files](https://github.com/UrbanInstitute/debt-interactive-map/tree/master/data/20251023-update) · [August 2025 county CSV](https://apps.urban.org/features/debt-interactive-map/data/20251023-update/county_overall.csv) · [2025 technical appendix](https://apps.urban.org/features/debt-interactive-map/downloadable-docs/debt_interactive_technical_appendix_2025.pdf)

The Urban Data Catalog identifies the dataset as ODC-By. The linked aggregate comparison is adapted from the Urban Institute data and is made available under the [Open Data Commons Attribution License 1.0](https://opendatacommons.org/licenses/by/1-0/).

## Reproduce the local extract

Run `python scripts/import_urban_debt_comparison.py` from the repository root. Python 3.10 or later is sufficient. The importer loads six dated CSVs per release, selects the overall population column for each measure and matches the county/state identifiers. It checks geographic names, duplicates, units and required fields before replacing `consumer-debt-dashboard/data/processed/urban_county_comparison.json`. Each metric definition carries its source column and the release metadata lists all 12 original file URLs.

## Sangamon County eviction and foreclosure filings

Run `python scripts/import_sangamon_housing_filings.py` to refresh the aggregate quarterly series from the Administrative Office of the Illinois Courts. It selects Sangamon County, the “New Filed” status and the eviction and foreclosure case categories. The comparison uses the same quarters for each year. The source supplies combined residential and commercial case counts. It does not report how many people moved out or how many properties sold. [Illinois Courts quarterly reports](https://www.illinoiscourts.gov/courts/circuit-court/illinois-circuit-court-statistical-reports/)

On November 12, 2026, the latest published quarter ended June 30, 2026. The 2025 statewide annual report also confirms the county's full-year totals of 1,766 eviction cases and 248 foreclosure cases. The county clerk's separate reports end in August 2024. For 2023 the clerk lists 13 foreclosure filings and Illinois Courts lists 227. The reports do not explain the difference. The dashboard uses the state series throughout and links to the clerk's archive separately. [Illinois Courts annual reports](https://www.illinoiscourts.gov/reports/annual-report-illinois-courts/) · [Clerk eviction report](https://www.sangamoncountycircuitclerk.org/download_file/view/3210/) · [Clerk foreclosure report](https://www.sangamoncountycircuitclerk.org/download_file/view/3211/)

## Sangamon County housing market

The market section uses two independent series. Run `python scripts/import_sangamon_home_sales.py` for Illinois MyDec and `python scripts/import_sangamon_listing_market.py consumer-debt-dashboard/data/processed/sangamon_listing_market.json` for Realtor.com® Economic Research. The GitHub Actions workflow checks on Mondays and Thursdays. It retains each source’s last successful extract when a refresh fails.

The MyDec series starts with January 2025 recordings. It uses PTAX-203 property use B, an advertised property, one whole parcel, eligible deed instruments, positive line 13 real estate consideration, no transfer tax exemptions, and no flagged line 10 conditions. The importer checks distinct document and declaration counts and reconciles volume to a separate aggregate query. The Chatham selection uses the declared property city. One-to-four-sale groups show only counts. The newest recording month is marked partial until the county posts records for a later month. Late submissions and corrections may revise historical months. [IDOR data and documentation](https://tax.illinois.gov/localgovernments/property/mydecdatafiles.html)

Realtor.com® Economic Research publishes a monthly county series and a current-month ZIP file, both covering all price levels. ZIP 62629 has different boundaries from the property-city selection. The listing library defines median days on market using first listing through closing or removal. Independent property sales do not supply listing dates or identify an agent. The site links to RealTrends’ dated agent and team profiles and explicitly identifies its office-based geography. [Realtor.com data library](https://www.realtor.com/research/data/) · [RealTrends rankings FAQ](https://www.realtrends.com/rankings-faqs/)

The optional listing CSV calculator runs locally in a separate page with no analytics and a content policy that forbids network connections. Its tables describe only the submitted export. The public website stores and refreshes aggregate data only.
