"""
Tier 3 — Par Level & Safety Stock Recommendation Engine
Hotel Bar Inventory Forecasting Project

Does ONLY:
  1. Lead-time demand = forecasted daily demand x L
  2. Safety stock = Z x sigma x sqrt(L), where sigma = per-series RMSE from the
     Tier 2 backtest (actual model error), NOT raw historical std
  3. Par Level = Lead-Time Demand + Safety Stock
  4. Reorder Point defined on inventory POSITION (on-hand + on-order), distinct
     from Par Level
  5. Lead time (2/3/5 days) and service level (90/95/99%) as configurable
     parameters, not hardcoded
  6. Sensitivity table across parameter combinations for a representative
     series sample

No daily simulation loop. That is Tier 4.

--------------------------------------------------------------------------
WHY BACKTEST RMSE INSTEAD OF RAW HISTORICAL STD:
Tier 1 showed active-day CV > 2.0 for most series - raw demand is extremely
volatile. But safety stock exists to buffer FORECAST ERROR, not raw demand
variance: if the forecast already captures some of that swing (e.g. a
day-of-week pattern), using raw std double-counts variance the model
already explains. Tier 2's backtest RMSE isolates the part of variance the
model actually failed to predict, which is the correct sigma for the
classic safety-stock formula. Since Tier 2 found the ML/statistical models
barely beat the rolling-mean baseline, this correction matters less here
than it would on an easier dataset - but it is still the methodologically
correct choice.
--------------------------------------------------------------------------
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path

sns.set_style("whitegrid")

PROCESSED_DIR = Path("data/processed")
PRED_PATH = PROCESSED_DIR / "tier2_validation_predictions.csv"
FIG_DIR = Path("report/figures")
FIG_DIR.mkdir(parents=True, exist_ok=True)
REPORT_PATH = Path("report/tier3_par_level_report.md")

# Best model from Tier 2 backtest — see tier2_model_comparison.csv
BEST_MODEL_COL = "pred_rolling_mean_7"
BEST_MODEL_NAME = "Rolling Mean (7d)"

# Configurable parameter grids (NOT hardcoded single values)
LEAD_TIME_OPTIONS = [2, 3, 5]          # days
SERVICE_LEVEL_OPTIONS = {
    "90%": 1.282,
    "95%": 1.645,
    "99%": 2.326,
}

DEFAULT_LEAD_TIME = 2
DEFAULT_SERVICE_LEVEL = "95%"


# ---------------------------------------------------------------------------
# Step A: per-series forecast + per-series forecast-error sigma (RMSE)
# ---------------------------------------------------------------------------
def compute_series_forecast_and_error(pred_df: pd.DataFrame, model_col: str) -> pd.DataFrame:
    """
    - avg_forecast_demand_per_day: mean of the model's predicted daily demand
      over the validation window, used as the expected daily demand going
      forward (last known model output level).
    - forecast_rmse: per-series RMSE of (actual - predicted) on the SAME
      validation backtest used in Tier 2 -> this is sigma for safety stock.
    """
    pred_df = pred_df.copy()
    pred_df["abs_error"] = (pred_df["consumed_ml"] - pred_df[model_col]).abs()
    pred_df["sq_error"] = (pred_df["consumed_ml"] - pred_df[model_col]) ** 2

    grp = pred_df.groupby(["Bar Name", "Brand Name"])
    out = grp.agg(
        avg_forecast_demand_per_day=(model_col, "mean"),
        avg_actual_demand_per_day=("consumed_ml", "mean"),
        forecast_rmse=("sq_error", lambda s: np.sqrt(s.mean())),
        n_obs=("consumed_ml", "count"),
    ).reset_index()

    # carry through classification context
    context_cols = ["abc_class", "pct_zero_days", "series_class", "freq_bucket"]
    context = pred_df.groupby(["Bar Name", "Brand Name"])[context_cols].first().reset_index()
    out = out.merge(context, on=["Bar Name", "Brand Name"], how="left")
    return out


# ---------------------------------------------------------------------------
# Step B: core par-level formulas
# ---------------------------------------------------------------------------
def compute_lead_time_demand(avg_daily_demand: float, lead_time_days: int) -> float:
    return avg_daily_demand * lead_time_days


def compute_safety_stock(forecast_rmse: float, lead_time_days: int, z: float) -> float:
    """Safety stock = Z x sigma x sqrt(L), sigma = backtest forecast RMSE."""
    return z * forecast_rmse * np.sqrt(lead_time_days)


def compute_par_level(lead_time_demand: float, safety_stock: float) -> float:
    return lead_time_demand + safety_stock


def compute_reorder_point(lead_time_demand: float, safety_stock: float) -> float:
    """
    Reorder Point (ROP) is evaluated against INVENTORY POSITION
    (on-hand + on-order), not on-hand alone. Structurally ROP has the same
    formula as par level here (lead-time demand + safety stock) because both
    represent "how much coverage is needed until the next delivery lands" -
    the distinction is NOT in the formula, it's in what they are compared
    against operationally:

      - Par Level: the target level inventory POSITION is topped up TO when
        a reorder triggers ("order up to Par").
      - Reorder Point: the inventory POSITION threshold that TRIGGERS that
        order. Checking on-hand alone would cause duplicate orders while a
        shipment is already in transit, because on-hand looks low even
        though replenishment is already coming. Checking inventory position
        (on-hand + on-order) avoids that.

    In an order-up-to-par policy (used in Tier 4's simulation), ROP and Par
    Level are numerically identical by design: order whenever inventory
    position < ROP, and top up TO Par. Keeping them as separate named
    outputs here (rather than silently collapsing them into one number)
    preserves the conceptual distinction for Tier 4 and for the business
    write-up, even though their values are the same under this policy.
    """
    return lead_time_demand + safety_stock


# ---------------------------------------------------------------------------
# Step C: build recommendations across the configurable parameter grid
# ---------------------------------------------------------------------------
def build_recommendations(series_stats: pd.DataFrame, lead_times, service_levels) -> pd.DataFrame:
    rows = []
    for _, row in series_stats.iterrows():
        for L in lead_times:
            for sl_label, z in service_levels.items():
                ltd = compute_lead_time_demand(row["avg_forecast_demand_per_day"], L)
                ss = compute_safety_stock(row["forecast_rmse"], L, z)
                par = compute_par_level(ltd, ss)
                rop = compute_reorder_point(ltd, ss)
                rows.append({
                    "Bar Name": row["Bar Name"],
                    "Brand Name": row["Brand Name"],
                    "abc_class": row["abc_class"],
                    "series_class": row["series_class"],
                    "lead_time_days": L,
                    "service_level": sl_label,
                    "z_score": z,
                    "avg_forecast_demand_per_day_ml": round(row["avg_forecast_demand_per_day"], 1),
                    "forecast_rmse_ml": round(row["forecast_rmse"], 1),
                    "lead_time_demand_ml": round(ltd, 1),
                    "safety_stock_ml": round(ss, 1),
                    "par_level_ml": round(par, 1),
                    "reorder_point_ml": round(rop, 1),
                })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Step D: sensitivity table for a representative sample of series
# ---------------------------------------------------------------------------
def pick_representative_sample(series_stats: pd.DataFrame, n_per_class=1) -> pd.DataFrame:
    """One example per ABC class x series_class combo, so the sensitivity
    table shows how parameters behave across genuinely different series
    profiles rather than an arbitrary random pick."""
    picks = []
    for (abc, sclass), g in series_stats.groupby(["abc_class", "series_class"]):
        picks.append(g.sort_values("avg_forecast_demand_per_day", ascending=False).head(n_per_class))
    return pd.concat(picks, ignore_index=True)


def main():
    pred_df = pd.read_csv(PRED_PATH, parse_dates=["Date"])
    series_stats = compute_series_forecast_and_error(pred_df, BEST_MODEL_COL)
    series_stats.to_csv(PROCESSED_DIR / "tier3_series_forecast_and_error.csv", index=False)

    # full recommendation grid across all configurable parameter combinations
    full_grid = build_recommendations(series_stats, LEAD_TIME_OPTIONS, SERVICE_LEVEL_OPTIONS)
    full_grid.to_csv(PROCESSED_DIR / "tier3_par_level_full_grid.csv", index=False)

    # default recommendation (L=2, 95%) — the "production" recommendation table
    default_reco = full_grid[
        (full_grid["lead_time_days"] == DEFAULT_LEAD_TIME) &
        (full_grid["service_level"] == DEFAULT_SERVICE_LEVEL)
    ].sort_values("par_level_ml", ascending=False)
    default_reco.to_csv(PROCESSED_DIR / "tier3_par_level_recommendation_default.csv", index=False)

    # sensitivity sample
    sample = pick_representative_sample(series_stats)
    sample_keys = sample[["Bar Name", "Brand Name"]]
    sensitivity = full_grid.merge(sample_keys, on=["Bar Name", "Brand Name"], how="inner")
    sensitivity.to_csv(PROCESSED_DIR / "tier3_sensitivity_table.csv", index=False)

    # --- chart: par level vs lead time, by service level, for one representative A-class series ---
    a_series = sample[sample["abc_class"] == "A"]
    if len(a_series) > 0:
        example = a_series.iloc[0]
        ex_data = sensitivity[
            (sensitivity["Bar Name"] == example["Bar Name"]) &
            (sensitivity["Brand Name"] == example["Brand Name"])
        ]
        fig, ax = plt.subplots(figsize=(8, 5))
        for sl_label in SERVICE_LEVEL_OPTIONS:
            sub = ex_data[ex_data["service_level"] == sl_label].sort_values("lead_time_days")
            ax.plot(sub["lead_time_days"], sub["par_level_ml"], marker="o", label=f"Service Level {sl_label}")
        ax.set_xlabel("Lead Time (days)")
        ax.set_ylabel("Par Level (ml)")
        ax.set_title(f"Par Level Sensitivity — {example['Bar Name']} / {example['Brand Name']} (Class A)")
        ax.legend()
        plt.tight_layout()
        plt.savefig(FIG_DIR / "tier3_par_level_sensitivity_example.png", dpi=120)
        plt.close()

    # --- chart: safety stock as % of par level, across ABC classes, default params ---
    default_reco2 = default_reco.copy()
    default_reco2["safety_stock_pct_of_par"] = default_reco2["safety_stock_ml"] / default_reco2["par_level_ml"] * 100
    fig, ax = plt.subplots(figsize=(7, 5))
    sns.boxplot(data=default_reco2, x="abc_class", y="safety_stock_pct_of_par", order=["A", "B", "C"], ax=ax)
    ax.set_title(f"Safety Stock as % of Par Level, by ABC Class (L={DEFAULT_LEAD_TIME}d, SL={DEFAULT_SERVICE_LEVEL})")
    ax.set_ylabel("Safety stock / Par level (%)")
    plt.tight_layout()
    plt.savefig(FIG_DIR / "tier3_safety_stock_pct_by_abc.png", dpi=120)
    plt.close()

    write_report(series_stats, default_reco, sensitivity, sample)


def write_report(series_stats, default_reco, sensitivity, sample):
    lines = []
    lines.append("# Tier 3 — Par Level & Safety Stock Report\n")

    lines.append("## 1. Inputs Carried From Tier 2\n")
    lines.append(f"- Forecast model: **{BEST_MODEL_NAME}** (lowest backtest WAPE — see "
                 f"`tier2_model_comparison.csv`).")
    lines.append("- `avg_forecast_demand_per_day` = mean of this model's predicted daily demand over the "
                 "Tier 2 validation window, per Bar x Brand series.")
    lines.append("- `forecast_rmse` = per-series RMSE of (actual - predicted) on that same validation "
                 "window — this is sigma for the safety-stock formula, NOT raw historical demand std.\n")

    lines.append("## 2. Formulas\n")
    lines.append("- Lead-Time Demand = avg_forecast_demand_per_day × L")
    lines.append("- Safety Stock = Z × forecast_rmse × √L")
    lines.append("- Par Level = Lead-Time Demand + Safety Stock")
    lines.append("- Reorder Point = Lead-Time Demand + Safety Stock, evaluated against **inventory "
                 "position (on-hand + on-order)**, not on-hand alone. See code docstring "
                 "`compute_reorder_point()` for why ROP and Par Level share a formula but are NOT the same "
                 "operational concept: Par Level is what you order UP TO; Reorder Point is the inventory-"
                 "position THRESHOLD that triggers that order. Comparing the threshold to on-hand alone "
                 "would trigger duplicate orders while a shipment is already in transit.\n")

    lines.append("## 3. Configurable Parameters\n")
    lines.append(f"- Lead time options: {LEAD_TIME_OPTIONS} days")
    lines.append(f"- Service level options: {list(SERVICE_LEVEL_OPTIONS.keys())} "
                 f"(Z = {list(SERVICE_LEVEL_OPTIONS.values())})")
    lines.append(f"- Default recommendation table uses L={DEFAULT_LEAD_TIME}d, "
                 f"SL={DEFAULT_SERVICE_LEVEL} — but the full grid (`tier3_par_level_full_grid.csv`) "
                 f"covers all {len(LEAD_TIME_OPTIONS)}×{len(SERVICE_LEVEL_OPTIONS)} = "
                 f"{len(LEAD_TIME_OPTIONS)*len(SERVICE_LEVEL_OPTIONS)} combinations for every series.\n")

    lines.append("## 4. Default Recommendation Table (Top 10 by Par Level, L="
                 f"{DEFAULT_LEAD_TIME}d, SL={DEFAULT_SERVICE_LEVEL})\n")
    cols = ["Bar Name", "Brand Name", "abc_class", "lead_time_demand_ml", "safety_stock_ml",
            "par_level_ml", "reorder_point_ml"]
    lines.append(default_reco[cols].head(10).to_markdown(index=False, floatfmt=".1f"))
    lines.append(f"\nFull table ({len(default_reco)} series): "
                 f"`data/processed/tier3_par_level_recommendation_default.csv`\n")

    lines.append("## 5. Sensitivity Table — Representative Series Sample\n")
    lines.append(f"Sample: one series per (ABC class × series_class) combination "
                 f"({len(sample)} representative series), each shown across all "
                 f"{len(LEAD_TIME_OPTIONS)}×{len(SERVICE_LEVEL_OPTIONS)} parameter combinations.\n")
    sens_cols = ["Bar Name", "Brand Name", "abc_class", "series_class", "lead_time_days",
                 "service_level", "safety_stock_ml", "par_level_ml"]
    lines.append(sensitivity[sens_cols].to_markdown(index=False, floatfmt=".1f"))
    lines.append(f"\nFull sensitivity data: `data/processed/tier3_sensitivity_table.csv`")
    lines.append("- See `figures/tier3_par_level_sensitivity_example.png` "
                 "(par level vs. lead time, by service level, one Class A series)")
    lines.append("- See `figures/tier3_safety_stock_pct_by_abc.png` "
                 "(safety stock as % of par level, by ABC class)\n")

    lines.append("## 6. Key Observations\n")
    avg_ss_pct = (default_reco["safety_stock_ml"] / default_reco["par_level_ml"]).mean() * 100
    lines.append(f"- At default parameters, safety stock makes up **{avg_ss_pct:.1f}%** of the "
                 f"average par level — consistent with Tier 2's finding that forecast error (WAPE > 1.6 "
                 f"for every model) is large relative to the point forecast itself. The buffer term, not "
                 f"the point forecast, carries most of the par-level number here.")
    lines.append("- Because safety stock scales with √L while lead-time demand scales linearly with L, "
                 "longer lead times shift the par level composition further toward the point-forecast "
                 "term — see the sensitivity chart for the concrete shape of this per series.")
    lines.append("- Class C / low-volume series show the smallest absolute safety stock but often the "
                 "**largest safety-stock share of par level**, because their forecast RMSE is large "
                 "relative to their thin average demand — flagged consistent with Tier 1's guidance to "
                 "treat Class C series differently (simpler rule-based buffers may be more defensible "
                 "than trusting a volatile RMSE estimate built on few data points).\n")

    lines.append("## 7. Notes for Tier 4\n")
    lines.append("- Tier 4's simulation should use `tier3_par_level_recommendation_default.csv` as the "
                 "baseline policy, then re-run against the full grid to show how stockout/overstock "
                 "trade-offs shift across lead time and service level — this tier only computed the "
                 "static recommendations, not their simulated performance.")
    lines.append("- Reorder Point in Tier 4's simulation loop must be checked against inventory "
                 "POSITION (on-hand + quantity already in transit), consistent with section 2 above, "
                 "or the simulation will over-order during the lead-time window.")

    REPORT_PATH.write_text("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
