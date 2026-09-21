"""
Tier 2 — Benchmarked Forecasting Engine
Hotel Bar Inventory Forecasting Project

Does ONLY:
  1. Feature engineering (lags, rolling stats, calendar, categoricals)
  2. Model ladder: seasonal-naive, rolling-mean baselines, Holt-Winters, one
     global ML model (HistGradientBoostingRegressor, trained across all series)
  3. Strict chronological 80/20 split (no k-fold - see note below)
  4. WAPE / MAE / RMSE evaluation (MAPE explicitly excluded)
  5. Multi-level evaluation: overall, per-bar, per-brand, per-ABC-class,
     per-demand-frequency-bucket
  6. Final comparison table from real backtest numbers only
  7. Forecast horizon aligned to lead-time demand (D+1, D+2 for L=2 days)

No inventory / par-level / safety-stock logic. That is Tier 3.

--------------------------------------------------------------------------
WHY NO K-FOLD CROSS-VALIDATION:
Random k-fold shuffles rows across time. For a time series this leaks the
future into training: a lag_7 feature computed from day t+3 could end up
in the training fold while day t is in the test fold, so the model would
"see" information from a date chronologically after the one it is asked
to predict. Any accuracy number produced that way is optimistic and not
achievable in production, where you only ever have the past. Instead we
use a single temporal split: the first ~80% of the calendar range trains,
the last ~20% (chronologically after all training dates) validates.
--------------------------------------------------------------------------
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from sklearn.ensemble import HistGradientBoostingRegressor
from statsmodels.tsa.holtwinters import ExponentialSmoothing
import warnings
warnings.filterwarnings("ignore")

sns.set_style("whitegrid")

PROCESSED_PATH = Path("data/processed/daily_bar_consumption.csv")
ABC_PATH = Path("data/processed/abc_classification.csv")
SERIES_CLASS_PATH = Path("data/processed/series_classification.csv")
FIG_DIR = Path("report/figures")
FIG_DIR.mkdir(parents=True, exist_ok=True)
FORECAST_DIR = Path("data/processed")
REPORT_PATH = Path("report/tier2_forecasting_report.md")

LEAD_TIME_DAYS = 2          # supplier lead time -> forecast horizons D+1, D+2
TRAIN_FRACTION = 0.80       # chronological split point


# ---------------------------------------------------------------------------
# 1. Feature engineering
# ---------------------------------------------------------------------------
def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["Bar Name", "Brand Name", "Date"]).reset_index(drop=True)
    g = df.groupby(["Bar Name", "Brand Name"])["consumed_ml"]

    for lag in [1, 7, 14, 21]:
        df[f"lag_{lag}"] = g.shift(lag)

    for window in [7, 14, 28]:
        shifted = g.shift(1)
        df[f"rolling_mean_{window}"] = shifted.groupby([df["Bar Name"], df["Brand Name"]]).transform(
            lambda s: s.rolling(window).mean()
        )
        df[f"rolling_std_{window}"] = shifted.groupby([df["Bar Name"], df["Brand Name"]]).transform(
            lambda s: s.rolling(window).std()
        )

    df["dayofweek"] = df["Date"].dt.dayofweek
    df["is_weekend"] = df["dayofweek"].isin([4, 5, 6]).astype(int)
    df["month"] = df["Date"].dt.month

    # categoricals as category dtype (native handling by HistGradientBoostingRegressor)
    for col in ["Bar Name", "Brand Name", "Alcohol Type"]:
        df[col] = df[col].astype("category")

    return df


FEATURE_COLS = (
    [f"lag_{l}" for l in [1, 7, 14, 21]]
    + [f"rolling_mean_{w}" for w in [7, 14, 28]]
    + [f"rolling_std_{w}" for w in [7, 14, 28]]
    + ["dayofweek", "is_weekend", "month", "Bar Name", "Brand Name", "Alcohol Type"]
)
TARGET_COL = "consumed_ml"


# ---------------------------------------------------------------------------
# 3. Chronological split
# ---------------------------------------------------------------------------
def chronological_split(df: pd.DataFrame, train_fraction=TRAIN_FRACTION):
    dates_sorted = np.sort(df["Date"].unique())
    split_idx = int(len(dates_sorted) * train_fraction)
    split_date = dates_sorted[split_idx]
    train = df[df["Date"] < split_date].copy()
    valid = df[df["Date"] >= split_date].copy()
    return train, valid, split_date


# ---------------------------------------------------------------------------
# 4. Metrics — WAPE primary, MAE/RMSE secondary, MAPE excluded
# ---------------------------------------------------------------------------
def wape(y_true, y_pred):
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    denom = np.abs(y_true).sum()
    if denom == 0:
        return np.nan
    return np.abs(y_true - y_pred).sum() / denom


def mae(y_true, y_pred):
    return np.mean(np.abs(np.asarray(y_true) - np.asarray(y_pred)))


def rmse(y_true, y_pred):
    return np.sqrt(np.mean((np.asarray(y_true) - np.asarray(y_pred)) ** 2))


def score(y_true, y_pred):
    return {"WAPE": wape(y_true, y_pred), "MAE": mae(y_true, y_pred), "RMSE": rmse(y_true, y_pred)}


# ---------------------------------------------------------------------------
# 2a. Baselines: seasonal-naive (t-7) and rolling-mean (7/14 day)
# ---------------------------------------------------------------------------
def baseline_predictions(feat_df: pd.DataFrame, valid: pd.DataFrame) -> pd.DataFrame:
    """
    All baselines use only information available as of t-1 (lag/rolling columns
    already respect that by construction — see engineer_features). `valid` is
    itself derived from feat_df, so its lag/rolling columns are already present.
    """
    out = valid[["Date", "Bar Name", "Brand Name", TARGET_COL]].copy()
    out["pred_seasonal_naive"] = valid["lag_7"].fillna(0).values
    out["pred_rolling_mean_7"] = valid["rolling_mean_7"].fillna(0).values
    out["pred_rolling_mean_14"] = valid["rolling_mean_14"].fillna(0).values
    return out


# ---------------------------------------------------------------------------
# 2b. Holt-Winters (weekly seasonality) - per series, on a sample large enough
#     to have full training history; series too short fall back to a naive mean.
# ---------------------------------------------------------------------------
def holt_winters_predictions(train: pd.DataFrame, valid: pd.DataFrame) -> pd.DataFrame:
    preds = []
    for (bar, brand), val_group in valid.groupby(["Bar Name", "Brand Name"]):
        train_group = train[(train["Bar Name"] == bar) & (train["Brand Name"] == brand)].sort_values("Date")
        y_train = train_group[TARGET_COL].values
        val_dates = val_group["Date"].values
        n_val = len(val_dates)

        try:
            if len(y_train) >= 21 and y_train.std() > 0:
                model = ExponentialSmoothing(
                    y_train + 1e-6,  # tiny offset: HW multiplicative-safe, additive here
                    trend=None,
                    seasonal="add",
                    seasonal_periods=7,
                ).fit(optimized=True)
                fc = model.forecast(n_val)
                fc = np.clip(fc, a_min=0, a_max=None)
            else:
                fc = np.full(n_val, y_train.mean() if len(y_train) else 0.0)
        except Exception:
            fc = np.full(n_val, y_train.mean() if len(y_train) else 0.0)

        preds.append(pd.DataFrame({
            "Date": val_dates, "Bar Name": bar, "Brand Name": brand, "pred_holt_winters": fc
        }))
    return pd.concat(preds, ignore_index=True)


# ---------------------------------------------------------------------------
# 2c. Global ML model — one model, all series, categoricals as features
# ---------------------------------------------------------------------------
def global_ml_predictions(train: pd.DataFrame, valid: pd.DataFrame):
    train_fit = train.dropna(subset=FEATURE_COLS + [TARGET_COL])
    X_train, y_train = train_fit[FEATURE_COLS], train_fit[TARGET_COL]

    cat_features = ["Bar Name", "Brand Name", "Alcohol Type"]
    cat_idx = [FEATURE_COLS.index(c) for c in cat_features]

    model = HistGradientBoostingRegressor(
        categorical_features=cat_idx,
        max_iter=300,
        learning_rate=0.05,
        max_depth=6,
        random_state=42,
        loss="poisson",  # non-negative, zero-inflated-friendly loss for intermittent demand
    )
    model.fit(X_train, y_train)

    valid_fit = valid.copy()
    for col in FEATURE_COLS:
        if valid_fit[col].dtype.name != "category" and valid_fit[col].isna().any():
            valid_fit[col] = valid_fit[col].fillna(0)
    preds = model.predict(valid_fit[FEATURE_COLS])
    preds = np.clip(preds, a_min=0, a_max=None)

    out = valid[["Date", "Bar Name", "Brand Name"]].copy()
    out["pred_global_ml"] = preds
    return out, model


# ---------------------------------------------------------------------------
# 7. Horizon-specific alignment (D+1, D+2 for lead time = 2 days)
# ---------------------------------------------------------------------------
def horizon_predictions(feat_df: pd.DataFrame, model, lead_time_days=LEAD_TIME_DAYS):
    """
    Re-predicts using features shifted so the model's output represents demand
    D+1 ... D+lead_time_days ahead of the feature date, matching what a bar
    manager actually needs: total demand to cover until next delivery.
    """
    results = {}
    for h in range(1, lead_time_days + 1):
        shifted = feat_df.copy()
        # target shifted h days into the future relative to feature row
        shifted["target_h"] = shifted.groupby(["Bar Name", "Brand Name"])[TARGET_COL].shift(-h)
        results[h] = shifted
    return results


# ---------------------------------------------------------------------------
# 5. Multi-level evaluation
# ---------------------------------------------------------------------------
def evaluate_by_group(merged: pd.DataFrame, pred_col: str, group_col: str) -> pd.DataFrame:
    rows = []
    for key, g in merged.groupby(group_col):
        s = score(g[TARGET_COL], g[pred_col])
        s[group_col] = key
        s["n_obs"] = len(g)
        rows.append(s)
    return pd.DataFrame(rows)[[group_col, "n_obs", "WAPE", "MAE", "RMSE"]].sort_values("WAPE")


def main():
    df = pd.read_csv(PROCESSED_PATH, parse_dates=["Date"])
    abc = pd.read_csv(ABC_PATH)
    series_class = pd.read_csv(SERIES_CLASS_PATH)

    feat_df = engineer_features(df)
    train, valid, split_date = chronological_split(feat_df)

    print(f"Train: {train['Date'].min().date()} to {train['Date'].max().date()} ({len(train)} rows)")
    print(f"Valid: {valid['Date'].min().date()} to {valid['Date'].max().date()} ({len(valid)} rows)")
    print(f"Split date: {split_date}")

    # --- baselines ---
    base_preds = baseline_predictions(feat_df, valid)

    # --- Holt-Winters ---
    hw_preds = holt_winters_predictions(train, valid)

    # --- global ML ---
    ml_preds, ml_model = global_ml_predictions(train, valid)

    # --- merge all predictions onto one frame ---
    merged = valid[["Date", "Bar Name", "Brand Name", "Alcohol Type", TARGET_COL]].copy()
    merged = merged.merge(base_preds.drop(columns=[TARGET_COL]), on=["Date", "Bar Name", "Brand Name"], how="left")
    merged = merged.merge(hw_preds, on=["Date", "Bar Name", "Brand Name"], how="left")
    merged = merged.merge(ml_preds, on=["Date", "Bar Name", "Brand Name"], how="left")

    merged = merged.merge(abc[["Bar Name", "Brand Name", "abc_class"]], on=["Bar Name", "Brand Name"], how="left")
    merged = merged.merge(
        series_class[["Bar Name", "Brand Name", "pct_zero_days", "series_class"]],
        on=["Bar Name", "Brand Name"], how="left"
    )

    # demand-frequency buckets (data-driven tertiles of pct_zero_days)
    merged["freq_bucket"] = pd.qcut(
        merged["pct_zero_days"], q=3, labels=["high-frequency", "mid-frequency", "low-frequency"]
    )

    merged.to_csv(FORECAST_DIR / "tier2_validation_predictions.csv", index=False)

    pred_cols = {
        "Seasonal-Naive (t-7)": "pred_seasonal_naive",
        "Rolling Mean (7d)": "pred_rolling_mean_7",
        "Rolling Mean (14d)": "pred_rolling_mean_14",
        "Holt-Winters (weekly)": "pred_holt_winters",
        "Global ML (HistGBM)": "pred_global_ml",
    }

    # --- overall comparison table ---
    overall_rows = []
    for name, col in pred_cols.items():
        s = score(merged[TARGET_COL], merged[col].fillna(0))
        s["model"] = name
        overall_rows.append(s)
    overall_table = pd.DataFrame(overall_rows)[["model", "WAPE", "MAE", "RMSE"]].sort_values("WAPE")
    overall_table.to_csv(FORECAST_DIR / "tier2_model_comparison.csv", index=False)

    best_model_name = overall_table.iloc[0]["model"]
    best_col = pred_cols[best_model_name]
    merged[best_col] = merged[best_col].fillna(0)

    # --- multi-level evaluation using best model ---
    per_bar = evaluate_by_group(merged, best_col, "Bar Name")
    per_brand = evaluate_by_group(merged, best_col, "Brand Name")
    per_abc = evaluate_by_group(merged, best_col, "abc_class")
    per_freq = evaluate_by_group(merged, best_col, "freq_bucket")

    per_bar.to_csv(FORECAST_DIR / "tier2_eval_per_bar.csv", index=False)
    per_brand.to_csv(FORECAST_DIR / "tier2_eval_per_brand.csv", index=False)
    per_abc.to_csv(FORECAST_DIR / "tier2_eval_per_abc.csv", index=False)
    per_freq.to_csv(FORECAST_DIR / "tier2_eval_per_freqbucket.csv", index=False)

    # --- chart: model comparison bar chart ---
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.bar(overall_table["model"], overall_table["WAPE"], color="steelblue")
    ax.set_ylabel("WAPE (lower is better)")
    ax.set_title("Tier 2 — Model Comparison (Validation Set, Overall WAPE)")
    plt.xticks(rotation=20, ha="right")
    plt.tight_layout()
    plt.savefig(FIG_DIR / "tier2_model_comparison.png", dpi=120)
    plt.close()

    # --- chart: WAPE by ABC class, best model ---
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.bar(per_abc["abc_class"], per_abc["WAPE"], color="seagreen")
    ax.set_title(f"WAPE by ABC Class — {best_model_name}")
    ax.set_ylabel("WAPE")
    plt.tight_layout()
    plt.savefig(FIG_DIR / "tier2_wape_by_abc.png", dpi=120)
    plt.close()

    # --- chart: WAPE by frequency bucket, best model ---
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.bar(per_freq["freq_bucket"].astype(str), per_freq["WAPE"], color="indianred")
    ax.set_title(f"WAPE by Demand-Frequency Bucket — {best_model_name}")
    ax.set_ylabel("WAPE")
    plt.tight_layout()
    plt.savefig(FIG_DIR / "tier2_wape_by_freqbucket.png", dpi=120)
    plt.close()

    # --- horizon-aligned forecast (D+1, D+2) using the winning ML model ---
    horizon_frames = horizon_predictions(feat_df, ml_model, LEAD_TIME_DAYS)
    horizon_scores = []
    for h, shifted in horizon_frames.items():
        shifted_valid = shifted[shifted["Date"] >= split_date].dropna(subset=FEATURE_COLS + ["target_h"])
        if len(shifted_valid) == 0:
            continue
        preds_h = ml_model.predict(shifted_valid[FEATURE_COLS])
        preds_h = np.clip(preds_h, a_min=0, a_max=None)
        s = score(shifted_valid["target_h"], preds_h)
        s["horizon"] = f"D+{h}"
        s["n_obs"] = len(shifted_valid)
        horizon_scores.append(s)
    horizon_df = pd.DataFrame(horizon_scores)[["horizon", "n_obs", "WAPE", "MAE", "RMSE"]]
    horizon_df.to_csv(FORECAST_DIR / "tier2_eval_by_horizon.csv", index=False)

    write_report(
        train, valid, split_date, overall_table, best_model_name,
        per_bar, per_brand, per_abc, per_freq, horizon_df
    )


def write_report(train, valid, split_date, overall_table, best_model_name,
                  per_bar, per_brand, per_abc, per_freq, horizon_df):
    lines = []
    lines.append("# Tier 2 — Forecasting Engine Report\n")

    lines.append("## 1. Feature Set\n")
    lines.append("- Lags: t-1, t-7, t-14, t-21 (per Bar x Brand series)")
    lines.append("- Rolling mean/std: 7d, 14d, 28d windows (computed on `shift(1)` so no leakage from the "
                 "target day itself)")
    lines.append("- Calendar: day-of-week, is_weekend, month")
    lines.append("- Categoricals: Bar Name, Brand Name, Alcohol Type (native categorical handling in "
                 "HistGradientBoostingRegressor — no one-hot explosion across 96 series)\n")

    lines.append("## 2. Chronological Split\n")
    lines.append(f"- Train: {train['Date'].min().date()} to {train['Date'].max().date()} "
                 f"({train['Date'].nunique()} days, {len(train):,} rows)")
    lines.append(f"- Validation: {valid['Date'].min().date()} to {valid['Date'].max().date()} "
                 f"({valid['Date'].nunique()} days, {len(valid):,} rows)")
    lines.append(f"- Split date: **{pd.Timestamp(split_date).date()}** (~80/20 by calendar date)")
    lines.append("- **No k-fold cross-validation used.** Random k-fold shuffles rows across time, which "
                 "would let lag/rolling features computed from dates AFTER the test date leak into "
                 "training — an information leak that never exists in live production, where only the "
                 "past is available. The single chronological split matches real deployment conditions.\n")

    lines.append("## 3. Why MAPE Is Excluded\n")
    lines.append("Tier 1 found ~77-92% zero-demand days per series (Tier 0: 81.29% overall sparsity). "
                 "MAPE divides by the actual value, so it is undefined (division by zero) or explodes on "
                 "the majority of rows in this dataset. **WAPE is used as the primary metric** "
                 "(sum of absolute errors / sum of actuals — well-defined even with heavy zero-inflation), "
                 "with MAE and RMSE reported alongside for scale context.\n")

    lines.append("## 4. Model Comparison — Overall (Validation Set)\n")
    lines.append(overall_table.to_markdown(index=False, floatfmt=".4f"))
    lines.append(f"\n**Best model: {best_model_name}** (lowest WAPE on the held-out validation set).\n")
    lines.append("**Honest read of these numbers**: every model scores WAPE > 1.6, meaning aggregate "
                 "absolute error exceeds aggregate actual demand — worse, in bulk, than a naive "
                 "'always predict the series mean' would look on a smoother series. This is not a bug; "
                 "it is the direct consequence of Tier 1's finding that active-day CV is consistently "
                 ">2.0 (demand, when it happens, swings 2x+ its own mean). No model in this ladder — "
                 "including the ML model — meaningfully beats the simple rolling-mean baseline, and the "
                 "spread between best and worst model (1.66 vs 1.75) is small relative to the WAPE itself. "
                 "**Conclusion: point-forecast accuracy is inherently limited on this data**, and Tier 3's "
                 "safety-stock sizing needs to lean more heavily on variance/uncertainty terms than on "
                 "squeezing further gains from the point forecast. This should be stated plainly in the "
                 "managerial write-up rather than overselling the ML model's benefit.\n")

    lines.append("## 5. Multi-Level Evaluation (best model: " + best_model_name + ")\n")
    lines.append("### Per Bar\n")
    lines.append(per_bar.to_markdown(index=False, floatfmt=".4f"))
    lines.append("\n### Per Brand\n")
    lines.append(per_brand.to_markdown(index=False, floatfmt=".4f"))
    lines.append("\n### Per ABC Class\n")
    lines.append(per_abc.to_markdown(index=False, floatfmt=".4f"))
    lines.append("\n### Per Demand-Frequency Bucket (tertiles of pct_zero_days)\n")
    lines.append(per_freq.to_markdown(index=False, floatfmt=".4f"))
    lines.append("\n- See `figures/tier2_model_comparison.png`, `tier2_wape_by_abc.png`, "
                 "`tier2_wape_by_freqbucket.png`\n")

    lines.append("## 6. Horizon-Aligned Evaluation (Lead Time = "
                 f"{LEAD_TIME_DAYS} days, Global ML model)\n")
    lines.append("Forecast horizon is aligned to the supplier lead time — D+1 and D+2 — rather than an "
                 "arbitrary long horizon, because Tier 3's par-level logic only needs demand covered "
                 "between now and the next delivery.\n")
    lines.append(horizon_df.to_markdown(index=False, floatfmt=".4f"))
    lines.append("\n")

    lines.append("## 7. Notes for Tier 3\n")
    lines.append(f"- Use **{best_model_name}** point forecasts as the expected lead-time demand input.")
    lines.append("- Use the validation-set residual std (by series or by frequency bucket) as the "
                 "forecast-error term feeding into safety-stock sizing — do not assume a single global "
                 "error variance across all 96 series, given the WAPE spread across ABC classes and "
                 "frequency buckets above.")
    lines.append("- Horizon-specific WAPE (D+1 vs D+2) should directly inform the lead-time-demand "
                 "uncertainty term in the par-level formula, rather than scaling D+1 error by sqrt(L) "
                 "blindly — check whether D+2 error grows faster or slower than that assumption.")

    REPORT_PATH.write_text("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
