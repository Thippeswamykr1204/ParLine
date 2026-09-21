# Tier 0 — Data Validation Report

## 1. Dataset Profile

- Row count (raw transactions): **6,575**
- Bars (6): Anderson's Bar, Brown's Bar, Johnson's Bar, Smith's Bar, Taylor's Bar, Thomas's Bar
- Alcohol types (5): Beer, Rum, Vodka, Whiskey, Wine
- Brands (16): Absolut, Bacardi, Barefoot, Budweiser, Captain Morgan, Coors, Grey Goose, Heineken, Jack Daniels, Jameson, Jim Beam, Malibu, Miller, Smirnoff, Sutter Home, Yellow Tail
- Date range: 2023-01-01 to 2024-01-01 (366 calendar days)
- Duplicate rows: 0
- Null values per column: {'Date Time Served': 0, 'Bar Name': 0, 'Alcohol Type': 0, 'Brand Name': 0, 'Opening Balance (ml)': 0, 'Purchase (ml)': 0, 'Consumed (ml)': 0, 'Closing Balance (ml)': 0, 'Date': 0}

## 2. Inventory Conservation Check

Identity tested: `Closing = Opening + Purchase - Consumed`

- Tolerance used: ±0.01 ml
- Max absolute error observed: **0.0000 ml**
- Mean absolute error: 0.000000 ml
- Rows within tolerance: 6,575 (100.00%)
- Rows OUT of tolerance: 0

## 3. Sparsity Quantification

- Bars x Brands = 6 x 16 = 96 series
- Full calendar days in range: 366
- Possible slots (full calendar): 35,136
- Observed Bar x Brand x Day combos (>=1 txn): 6,575
- **Implicit zero-demand rate (full calendar basis): 81.29%**
- Implicit zero-demand rate (transaction-days basis): 81.29%

## 4. Canonical Daily Grid

- Output shape: 35,136 rows x 12 columns
- Written to `data/processed/daily_bar_consumption.csv`
