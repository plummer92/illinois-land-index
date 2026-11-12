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
