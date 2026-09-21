# Tier 1 — EDA Report

## 1. Business Landscape KPIs

- Bars: 6 | Brands: 16 | Alcohol types: 5
- Bar x Brand series: 96
- Transactions: 6,575
- Total consumption: 1,968.7 liters
- Date range: 2023-01-01 to 2024-01-01 (366 days)

## 2. Consumption Concentration

- Top bar by volume: **Johnson's Bar** (344 L), bottom: Taylor's Bar (315 L)
- Top alcohol type: **Vodka** (20.9% of volume)
- Top brand: **Grey Goose** (159 L)
- See `figures/concentration_by_bar_type_brand.png`

## 3. ABC Velocity Classification (dynamic, cumulative-% based)

- Class A (top ~80% cumulative volume): **69 series**
- Class B (next ~15%, up to 95% cumulative): **19 series**
- Class C (remaining ~5%): **8 series**
- Thresholds are cumulative-share cutoffs (80%/95%) applied to the actual sorted volume distribution — no brand/bar was hand-picked into a class.
- See `figures/abc_pareto_curve.png`, full table in `data/processed/abc_classification.csv`

## 4. Day-of-Week & Monthly Patterns (empirically tested)

- One-way ANOVA across day-of-week groups: F=0.62, p=0.7138 -> **NOT significant** day-of-week effect at α=0.05.
- Weekend mean vs weekday mean: 56.3 ml vs 55.8 ml (+0.8% uplift), Welch t-test p=0.7682 -> **NOT significant**.
- Conclusion: the assignment brief's assumption of a Fri/Sat spike is treated as a hypothesis, not a given — see figures for the actual shape, and the number above for whether it held up statistically in this dataset.
- See `figures/dow_and_monthly_patterns.png`

## 5. Per-Series Classification

- All 96 series have pct_zero_days between 77% and 92% — **the entire dataset is intermittent demand**, consistent with Tier 0's 81.29% sparsity finding. A stable/intermittent split on zero-rate alone would put 100% of series in one bucket, which is not actionable.
- Sub-classification instead uses **active-day CV** (volatility of demand only on the days it actually occurs) and weekend uplift, with a data-driven median split rather than a fixed cutoff: {'intermittent-stable': 39, 'intermittent-volatile': 38, 'intermittent-seasonal': 19}
- Rule: `weekend_uplift >= 25%` -> intermittent-seasonal; else `active_cv >= median` -> intermittent-volatile; else intermittent-stable.
- Full table: `data/processed/series_classification.csv`, chart: `figures/series_classification_counts.png`

## 6. Inventory Depletion Audit

- Threshold for 'depleted': closing balance ≤ 50.0 ml
- Overall depletion rate across observed days: **15.83%**
- Series never depleted: 22 of 96
- **Tier 0 caveat restated**: a depleted closing balance is NOT proof of a lost sale. This dataset has no field recording turned-away guests. Depletion frequency here is a *proxy for stockout risk*, not a stockout count. Any 'reduction in stockouts' claim in later tiers must be against *simulated* stockouts from a controlled backtest, not this raw signal.
- See `figures/depletion_audit_top15.png`

## 7. Modeling Decisions for Tier 2

Based on the evidence above:

1. **Primary metric: WAPE**, not MAPE or plain MAE. Consumption is intermittent (~81% zero-demand slots per Tier 0), so MAPE is undefined on zero-actual days.
2. **This is a 100%-intermittent-demand dataset (76-92% zero days per series) — standard exponential smoothing / plain Holt-Winters is the WRONG default for every series here**, not just a subset. Favor either Croston's method / TSB (built for intermittent demand) per series, or a single **pooled tree-based model** (RandomForest/LightGBM) trained across all 96 series with Bar and Brand as categorical features — pooling lets low-volume series borrow strength instead of fitting noise. Given the uniform intermittency, favor the pooled global model as the primary approach and use per-series statistical models only as a baseline comparison for Class A series.
3. Day-of-week feature is NOT strongly justified by ANOVA, but kept as a candidate feature; weekend flag alone shows +0.8% uplift (not significant at p<0.05) — include it as an engineered feature and let the model/regularization decide its weight, rather than hardcoding a weekend multiplier.
4. Class C / low-volume series are candidates for a simple rule-based par level (e.g. fixed small buffer) rather than a fitted model — the volume doesn't justify model complexity and CV will be unstable on such thin series.
5. Train/validation split for Tier 2 must be temporal (last ~20% of the 366-day range held out), never k-fold, consistent with the assignment brief.
6. Series flagged `volatile` (high CV, not explained by weekend seasonality) need wider safety-stock buffers in Tier 3 regardless of point-forecast accuracy — flag them for the par-level team as high-Z-score candidates.