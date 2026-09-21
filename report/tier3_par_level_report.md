# Tier 3 — Par Level & Safety Stock Report

## 1. Inputs Carried From Tier 2

- Forecast model: **Rolling Mean (7d)** (lowest backtest WAPE — see `tier2_model_comparison.csv`).
- `avg_forecast_demand_per_day` = mean of this model's predicted daily demand over the Tier 2 validation window, per Bar x Brand series.
- `forecast_rmse` = per-series RMSE of (actual - predicted) on that same validation window — this is sigma for the safety-stock formula, NOT raw historical demand std.

## 2. Formulas

- Lead-Time Demand = avg_forecast_demand_per_day × L
- Safety Stock = Z × forecast_rmse × √L
- Par Level = Lead-Time Demand + Safety Stock
- Reorder Point = Lead-Time Demand + Safety Stock, evaluated against **inventory position (on-hand + on-order)**, not on-hand alone. See code docstring `compute_reorder_point()` for why ROP and Par Level share a formula but are NOT the same operational concept: Par Level is what you order UP TO; Reorder Point is the inventory-position THRESHOLD that triggers that order. Comparing the threshold to on-hand alone would trigger duplicate orders while a shipment is already in transit.

## 3. Configurable Parameters

- Lead time options: [2, 3, 5] days
- Service level options: ['90%', '95%', '99%'] (Z = [1.282, 1.645, 2.326])
- Default recommendation table uses L=2d, SL=95% — but the full grid (`tier3_par_level_full_grid.csv`) covers all 3×3 = 9 combinations for every series.

## 4. Default Recommendation Table (Top 10 by Par Level, L=2d, SL=95%)

| Bar Name       | Brand Name   | abc_class   |   lead_time_demand_ml |   safety_stock_ml |   par_level_ml |   reorder_point_ml |
|:---------------|:-------------|:------------|----------------------:|------------------:|---------------:|-------------------:|
| Brown's Bar    | Grey Goose   | A           |                 188.7 |             503.1 |          691.8 |              691.8 |
| Anderson's Bar | Jim Beam     | A           |                 191.3 |             480.0 |          671.3 |              671.3 |
| Thomas's Bar   | Grey Goose   | A           |                 207.1 |             446.8 |          653.9 |              653.9 |
| Brown's Bar    | Jameson      | A           |                 176.7 |             473.1 |          649.7 |              649.7 |
| Thomas's Bar   | Yellow Tail  | A           |                 199.8 |             447.4 |          647.1 |              647.1 |
| Brown's Bar    | Yellow Tail  | A           |                 157.9 |             483.1 |          641.0 |              641.0 |
| Taylor's Bar   | Jim Beam     | A           |                 155.7 |             473.6 |          629.3 |              629.3 |
| Taylor's Bar   | Smirnoff     | A           |                 173.4 |             452.4 |          625.8 |              625.8 |
| Taylor's Bar   | Sutter Home  | B           |                 138.7 |             480.9 |          619.6 |              619.6 |
| Brown's Bar    | Coors        | B           |                 139.0 |             470.9 |          609.8 |              609.8 |

Full table (96 series): `data/processed/tier3_par_level_recommendation_default.csv`

## 5. Sensitivity Table — Representative Series Sample

Sample: one series per (ABC class × series_class) combination (9 representative series), each shown across all 3×3 parameter combinations.

| Bar Name       | Brand Name   | abc_class   | series_class          |   lead_time_days | service_level   |   safety_stock_ml |   par_level_ml |
|:---------------|:-------------|:------------|:----------------------|-----------------:|:----------------|------------------:|---------------:|
| Anderson's Bar | Absolut      | C           | intermittent-stable   |                2 | 90%             |             249.7 |          367.3 |
| Anderson's Bar | Absolut      | C           | intermittent-stable   |                2 | 95%             |             320.4 |          438.0 |
| Anderson's Bar | Absolut      | C           | intermittent-stable   |                2 | 99%             |             453.0 |          570.6 |
| Anderson's Bar | Absolut      | C           | intermittent-stable   |                3 | 90%             |             305.8 |          482.2 |
| Anderson's Bar | Absolut      | C           | intermittent-stable   |                3 | 95%             |             392.4 |          568.8 |
| Anderson's Bar | Absolut      | C           | intermittent-stable   |                3 | 99%             |             554.8 |          731.2 |
| Anderson's Bar | Absolut      | C           | intermittent-stable   |                5 | 90%             |             394.8 |          688.8 |
| Anderson's Bar | Absolut      | C           | intermittent-stable   |                5 | 95%             |             506.6 |          800.6 |
| Anderson's Bar | Absolut      | C           | intermittent-stable   |                5 | 99%             |             716.3 |         1010.3 |
| Brown's Bar    | Coors        | B           | intermittent-seasonal |                2 | 90%             |             367.0 |          505.9 |
| Brown's Bar    | Coors        | B           | intermittent-seasonal |                2 | 95%             |             470.9 |          609.8 |
| Brown's Bar    | Coors        | B           | intermittent-seasonal |                2 | 99%             |             665.8 |          804.8 |
| Brown's Bar    | Coors        | B           | intermittent-seasonal |                3 | 90%             |             449.4 |          657.9 |
| Brown's Bar    | Coors        | B           | intermittent-seasonal |                3 | 95%             |             576.7 |          785.1 |
| Brown's Bar    | Coors        | B           | intermittent-seasonal |                3 | 99%             |             815.4 |         1023.9 |
| Brown's Bar    | Coors        | B           | intermittent-seasonal |                5 | 90%             |             580.2 |          927.6 |
| Brown's Bar    | Coors        | B           | intermittent-seasonal |                5 | 95%             |             744.5 |         1091.9 |
| Brown's Bar    | Coors        | B           | intermittent-seasonal |                5 | 99%             |            1052.7 |         1400.1 |
| Brown's Bar    | Grey Goose   | A           | intermittent-volatile |                2 | 90%             |             392.1 |          580.8 |
| Brown's Bar    | Grey Goose   | A           | intermittent-volatile |                2 | 95%             |             503.1 |          691.8 |
| Brown's Bar    | Grey Goose   | A           | intermittent-volatile |                2 | 99%             |             711.4 |          900.1 |
| Brown's Bar    | Grey Goose   | A           | intermittent-volatile |                3 | 90%             |             480.2 |          763.2 |
| Brown's Bar    | Grey Goose   | A           | intermittent-volatile |                3 | 95%             |             616.2 |          899.2 |
| Brown's Bar    | Grey Goose   | A           | intermittent-volatile |                3 | 99%             |             871.3 |         1154.3 |
| Brown's Bar    | Grey Goose   | A           | intermittent-volatile |                5 | 90%             |             620.0 |         1091.6 |
| Brown's Bar    | Grey Goose   | A           | intermittent-volatile |                5 | 95%             |             795.5 |         1267.1 |
| Brown's Bar    | Grey Goose   | A           | intermittent-volatile |                5 | 99%             |            1124.8 |         1596.5 |
| Johnson's Bar  | Jim Beam     | B           | intermittent-stable   |                2 | 90%             |             293.4 |          448.7 |
| Johnson's Bar  | Jim Beam     | B           | intermittent-stable   |                2 | 95%             |             376.4 |          531.7 |
| Johnson's Bar  | Jim Beam     | B           | intermittent-stable   |                2 | 99%             |             532.3 |          687.6 |
| Johnson's Bar  | Jim Beam     | B           | intermittent-stable   |                3 | 90%             |             359.3 |          592.2 |
| Johnson's Bar  | Jim Beam     | B           | intermittent-stable   |                3 | 95%             |             461.0 |          694.0 |
| Johnson's Bar  | Jim Beam     | B           | intermittent-stable   |                3 | 99%             |             651.9 |          884.9 |
| Johnson's Bar  | Jim Beam     | B           | intermittent-stable   |                5 | 90%             |             463.9 |          852.1 |
| Johnson's Bar  | Jim Beam     | B           | intermittent-stable   |                5 | 95%             |             595.2 |          983.4 |
| Johnson's Bar  | Jim Beam     | B           | intermittent-stable   |                5 | 99%             |             841.6 |         1229.8 |
| Smith's Bar    | Budweiser    | C           | intermittent-seasonal |                2 | 90%             |             265.6 |          358.3 |
| Smith's Bar    | Budweiser    | C           | intermittent-seasonal |                2 | 95%             |             340.8 |          433.5 |
| Smith's Bar    | Budweiser    | C           | intermittent-seasonal |                2 | 99%             |             481.9 |          574.6 |
| Smith's Bar    | Budweiser    | C           | intermittent-seasonal |                3 | 90%             |             325.3 |          464.4 |
| Smith's Bar    | Budweiser    | C           | intermittent-seasonal |                3 | 95%             |             417.4 |          556.5 |
| Smith's Bar    | Budweiser    | C           | intermittent-seasonal |                3 | 99%             |             590.2 |          729.3 |
| Smith's Bar    | Budweiser    | C           | intermittent-seasonal |                5 | 90%             |             420.0 |          651.7 |
| Smith's Bar    | Budweiser    | C           | intermittent-seasonal |                5 | 95%             |             538.9 |          770.6 |
| Smith's Bar    | Budweiser    | C           | intermittent-seasonal |                5 | 99%             |             762.0 |          993.7 |
| Taylor's Bar   | Sutter Home  | B           | intermittent-volatile |                2 | 90%             |             374.8 |          513.5 |
| Taylor's Bar   | Sutter Home  | B           | intermittent-volatile |                2 | 95%             |             480.9 |          619.6 |
| Taylor's Bar   | Sutter Home  | B           | intermittent-volatile |                2 | 99%             |             680.0 |          818.7 |
| Taylor's Bar   | Sutter Home  | B           | intermittent-volatile |                3 | 90%             |             459.0 |          667.0 |
| Taylor's Bar   | Sutter Home  | B           | intermittent-volatile |                3 | 95%             |             589.0 |          797.0 |
| Taylor's Bar   | Sutter Home  | B           | intermittent-volatile |                3 | 99%             |             832.8 |         1040.8 |
| Taylor's Bar   | Sutter Home  | B           | intermittent-volatile |                5 | 90%             |             592.6 |          939.3 |
| Taylor's Bar   | Sutter Home  | B           | intermittent-volatile |                5 | 95%             |             760.4 |         1107.1 |
| Taylor's Bar   | Sutter Home  | B           | intermittent-volatile |                5 | 99%             |            1075.2 |         1421.9 |
| Thomas's Bar   | Grey Goose   | A           | intermittent-stable   |                2 | 90%             |             348.2 |          555.3 |
| Thomas's Bar   | Grey Goose   | A           | intermittent-stable   |                2 | 95%             |             446.8 |          653.9 |
| Thomas's Bar   | Grey Goose   | A           | intermittent-stable   |                2 | 99%             |             631.8 |          838.9 |
| Thomas's Bar   | Grey Goose   | A           | intermittent-stable   |                3 | 90%             |             426.5 |          737.1 |
| Thomas's Bar   | Grey Goose   | A           | intermittent-stable   |                3 | 95%             |             547.3 |          857.9 |
| Thomas's Bar   | Grey Goose   | A           | intermittent-stable   |                3 | 99%             |             773.8 |         1084.5 |
| Thomas's Bar   | Grey Goose   | A           | intermittent-stable   |                5 | 90%             |             550.6 |         1068.3 |
| Thomas's Bar   | Grey Goose   | A           | intermittent-stable   |                5 | 95%             |             706.5 |         1224.2 |
| Thomas's Bar   | Grey Goose   | A           | intermittent-stable   |                5 | 99%             |             999.0 |         1516.7 |
| Thomas's Bar   | Heineken     | C           | intermittent-volatile |                2 | 90%             |             198.9 |          254.2 |
| Thomas's Bar   | Heineken     | C           | intermittent-volatile |                2 | 95%             |             255.2 |          310.5 |
| Thomas's Bar   | Heineken     | C           | intermittent-volatile |                2 | 99%             |             360.9 |          416.2 |
| Thomas's Bar   | Heineken     | C           | intermittent-volatile |                3 | 90%             |             243.6 |          326.5 |
| Thomas's Bar   | Heineken     | C           | intermittent-volatile |                3 | 95%             |             312.6 |          395.5 |
| Thomas's Bar   | Heineken     | C           | intermittent-volatile |                3 | 99%             |             442.0 |          524.9 |
| Thomas's Bar   | Heineken     | C           | intermittent-volatile |                5 | 90%             |             314.5 |          452.7 |
| Thomas's Bar   | Heineken     | C           | intermittent-volatile |                5 | 95%             |             403.6 |          541.7 |
| Thomas's Bar   | Heineken     | C           | intermittent-volatile |                5 | 99%             |             570.7 |          708.8 |
| Thomas's Bar   | Yellow Tail  | A           | intermittent-seasonal |                2 | 90%             |             348.6 |          548.4 |
| Thomas's Bar   | Yellow Tail  | A           | intermittent-seasonal |                2 | 95%             |             447.4 |          647.1 |
| Thomas's Bar   | Yellow Tail  | A           | intermittent-seasonal |                2 | 99%             |             632.5 |          832.3 |
| Thomas's Bar   | Yellow Tail  | A           | intermittent-seasonal |                3 | 90%             |             427.0 |          726.6 |
| Thomas's Bar   | Yellow Tail  | A           | intermittent-seasonal |                3 | 95%             |             547.9 |          847.6 |
| Thomas's Bar   | Yellow Tail  | A           | intermittent-seasonal |                3 | 99%             |             774.7 |         1074.4 |
| Thomas's Bar   | Yellow Tail  | A           | intermittent-seasonal |                5 | 90%             |             551.2 |         1050.7 |
| Thomas's Bar   | Yellow Tail  | A           | intermittent-seasonal |                5 | 95%             |             707.3 |         1206.8 |
| Thomas's Bar   | Yellow Tail  | A           | intermittent-seasonal |                5 | 99%             |            1000.1 |         1499.6 |

Full sensitivity data: `data/processed/tier3_sensitivity_table.csv`
- See `figures/tier3_par_level_sensitivity_example.png` (par level vs. lead time, by service level, one Class A series)
- See `figures/tier3_safety_stock_pct_by_abc.png` (safety stock as % of par level, by ABC class)

## 6. Key Observations

- At default parameters, safety stock makes up **76.4%** of the average par level — consistent with Tier 2's finding that forecast error (WAPE > 1.6 for every model) is large relative to the point forecast itself. The buffer term, not the point forecast, carries most of the par-level number here.
- Because safety stock scales with √L while lead-time demand scales linearly with L, longer lead times shift the par level composition further toward the point-forecast term — see the sensitivity chart for the concrete shape of this per series.
- Class C / low-volume series show the smallest absolute safety stock but often the **largest safety-stock share of par level**, because their forecast RMSE is large relative to their thin average demand — flagged consistent with Tier 1's guidance to treat Class C series differently (simpler rule-based buffers may be more defensible than trusting a volatile RMSE estimate built on few data points).

## 7. Notes for Tier 4

- Tier 4's simulation should use `tier3_par_level_recommendation_default.csv` as the baseline policy, then re-run against the full grid to show how stockout/overstock trade-offs shift across lead time and service level — this tier only computed the static recommendations, not their simulated performance.
- Reorder Point in Tier 4's simulation loop must be checked against inventory POSITION (on-hand + quantity already in transit), consistent with section 2 above, or the simulation will over-order during the lead-time window.