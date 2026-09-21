# Tier 2 — Forecasting Engine Report

## 1. Feature Set

- Lags: t-1, t-7, t-14, t-21 (per Bar x Brand series)
- Rolling mean/std: 7d, 14d, 28d windows (computed on `shift(1)` so no leakage from the target day itself)
- Calendar: day-of-week, is_weekend, month
- Categoricals: Bar Name, Brand Name, Alcohol Type (native categorical handling in HistGradientBoostingRegressor — no one-hot explosion across 96 series)

## 2. Chronological Split

- Train: 2023-01-01 to 2023-10-19 (292 days, 28,032 rows)
- Validation: 2023-10-20 to 2024-01-01 (74 days, 7,104 rows)
- Split date: **2023-10-20** (~80/20 by calendar date)
- **No k-fold cross-validation used.** Random k-fold shuffles rows across time, which would let lag/rolling features computed from dates AFTER the test date leak into training — an information leak that never exists in live production, where only the past is available. The single chronological split matches real deployment conditions.

## 3. Why MAPE Is Excluded

Tier 1 found ~77-92% zero-demand days per series (Tier 0: 81.29% overall sparsity). MAPE divides by the actual value, so it is undefined (division by zero) or explodes on the majority of rows in this dataset. **WAPE is used as the primary metric** (sum of absolute errors / sum of actuals — well-defined even with heavy zero-inflation), with MAE and RMSE reported alongside for scale context.

## 4. Model Comparison — Overall (Validation Set)

| model                 |   WAPE |     MAE |     RMSE |
|:----------------------|-------:|--------:|---------:|
| Rolling Mean (7d)     | 1.6626 | 92.6244 | 153.1969 |
| Rolling Mean (14d)    | 1.6669 | 92.8618 | 148.5946 |
| Global ML (HistGBM)   | 1.6741 | 93.2650 | 143.8987 |
| Holt-Winters (weekly) | 1.6753 | 93.3314 | 145.8527 |
| Seasonal-Naive (t-7)  | 1.7506 | 97.5272 | 203.5972 |

**Best model: Rolling Mean (7d)** (lowest WAPE on the held-out validation set).

**Honest read of these numbers**: every model scores WAPE > 1.6, meaning aggregate absolute error exceeds aggregate actual demand — worse, in bulk, than a naive 'always predict the series mean' would look on a smoother series. This is not a bug; it is the direct consequence of Tier 1's finding that active-day CV is consistently >2.0 (demand, when it happens, swings 2x+ its own mean). No model in this ladder — including the ML model — meaningfully beats the simple rolling-mean baseline, and the spread between best and worst model (1.66 vs 1.75) is small relative to the WAPE itself. **Conclusion: point-forecast accuracy is inherently limited on this data**, and Tier 3's safety-stock sizing needs to lean more heavily on variance/uncertainty terms than on squeezing further gains from the point forecast. This should be stated plainly in the managerial write-up rather than overselling the ML model's benefit.

## 5. Multi-Level Evaluation (best model: Rolling Mean (7d))

### Per Bar

| Bar Name       |   n_obs |   WAPE |      MAE |     RMSE |
|:---------------|--------:|-------:|---------:|---------:|
| Taylor's Bar   |    1184 | 1.6505 |  89.4601 | 158.0721 |
| Thomas's Bar   |    1184 | 1.6563 |  90.2310 | 147.3615 |
| Johnson's Bar  |    1184 | 1.6618 | 101.1944 | 155.4826 |
| Smith's Bar    |    1184 | 1.6619 |  93.5182 | 149.2492 |
| Anderson's Bar |    1184 | 1.6674 |  88.7617 | 151.2340 |
| Brown's Bar    |    1184 | 1.6778 |  92.5808 | 157.4540 |

### Per Brand

| Brand Name     |   n_obs |   WAPE |      MAE |     RMSE |
|:---------------|--------:|-------:|---------:|---------:|
| Grey Goose     |     444 | 1.5671 | 124.9661 | 184.0884 |
| Jim Beam       |     444 | 1.5931 | 114.2255 | 174.2242 |
| Malibu         |     444 | 1.6017 |  93.0678 | 148.4841 |
| Bacardi        |     444 | 1.6148 | 101.6035 | 160.5156 |
| Jameson        |     444 | 1.6183 |  89.7267 | 152.3354 |
| Smirnoff       |     444 | 1.6462 | 112.6210 | 172.5933 |
| Absolut        |     444 | 1.6498 |  87.9726 | 140.9020 |
| Yellow Tail    |     444 | 1.6547 | 112.0728 | 169.7556 |
| Sutter Home    |     444 | 1.6588 | 102.0736 | 165.4415 |
| Coors          |     444 | 1.6740 |  76.3723 | 142.8503 |
| Captain Morgan |     444 | 1.6935 |  91.2965 | 143.6129 |
| Barefoot       |     444 | 1.7317 |  93.4546 | 147.8241 |
| Jack Daniels   |     444 | 1.7391 |  79.1820 | 143.1437 |
| Heineken       |     444 | 1.7660 |  76.5362 | 138.7097 |
| Budweiser      |     444 | 1.7733 |  61.5809 | 122.5468 |
| Miller         |     444 | 1.8457 |  65.2376 | 129.5634 |

### Per ABC Class

| abc_class   |   n_obs |   WAPE |      MAE |     RMSE |
|:------------|--------:|-------:|---------:|---------:|
| A           |    5106 | 1.6445 | 101.6788 | 160.1625 |
| B           |    1406 | 1.7075 |  76.9337 | 142.4274 |
| C           |     592 | 1.8353 |  51.7954 | 110.4751 |

### Per Demand-Frequency Bucket (tertiles of pct_zero_days)

| freq_bucket    |   n_obs |   WAPE |      MAE |     RMSE |
|:---------------|--------:|-------:|---------:|---------:|
| high-frequency |    2590 | 1.6259 | 109.1301 | 167.6469 |
| mid-frequency  |    2220 | 1.6566 |  95.6500 | 153.1515 |
| low-frequency  |    2294 | 1.7390 |  71.0608 | 135.0866 |

- See `figures/tier2_model_comparison.png`, `tier2_wape_by_abc.png`, `tier2_wape_by_freqbucket.png`

## 6. Horizon-Aligned Evaluation (Lead Time = 2 days, Global ML model)

Forecast horizon is aligned to the supplier lead time — D+1 and D+2 — rather than an arbitrary long horizon, because Tier 3's par-level logic only needs demand covered between now and the next delivery.

| horizon   |   n_obs |   WAPE |     MAE |     RMSE |
|:----------|--------:|-------:|--------:|---------:|
| D+1       |    7008 | 1.6743 | 93.3255 | 144.0624 |
| D+2       |    6912 | 1.6733 | 93.3335 | 144.1411 |


## 7. Notes for Tier 3

- Use **Rolling Mean (7d)** point forecasts as the expected lead-time demand input.
- Use the validation-set residual std (by series or by frequency bucket) as the forecast-error term feeding into safety-stock sizing — do not assume a single global error variance across all 96 series, given the WAPE spread across ABC classes and frequency buckets above.
- Horizon-specific WAPE (D+1 vs D+2) should directly inform the lead-time-demand uncertainty term in the par-level formula, rather than scaling D+1 error by sqrt(L) blindly — check whether D+2 error grows faster or slower than that assumption.