"""
Tier 1 — Exploratory Data Analysis
Hotel Bar Inventory Forecasting Project

Purpose: produce the empirical evidence that DRIVES Tier 2 modeling decisions.
Not decorative. Every chart/table here maps to a modeling choice.

Does ONLY:
  1. Business landscape KPIs
  2. Consumption concentration (bar / brand / alcohol type)
  3. ABC velocity classification (dynamic, cumulative-% thresholds)
  4. Day-of-week + monthly pattern testing (empirical, not assumed)
  5. Per-series stats -> stable/seasonal/intermittent/volatile classification
  6. Inventory depletion audit (with Tier 0 lost-demand caveat restated)
  7. EDA summary markdown ending in explicit Tier 2 modeling decisions

No forecasting models. That is Tier 2.
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from scipy import stats

sns.set_style("whitegrid")

PROCESSED_PATH = Path("data/processed/daily_bar_consumption.csv")
FIG_DIR = Path("report/figures")
FIG_DIR.mkdir(parents=True, exist_ok=True)
REPORT_PATH = Path("report/tier1_eda_report.md")
SERIES_STATS_PATH = Path("data/processed/series_classification.csv")
ABC_PATH = Path("data/processed/abc_classification.csv")


def load_grid() -> pd.DataFrame:
    df = pd.read_csv(PROCESSED_PATH, parse_dates=["Date"])
    return df


# ---------------------------------------------------------------------------
# 1. Business landscape KPIs
# ---------------------------------------------------------------------------
def business_kpis(df: pd.DataFrame) -> dict:
    observed = df[df["is_observed_day"]]
    return {
        "n_bars": df["Bar Name"].nunique(),
        "n_brands": df["Brand Name"].nunique(),
        "n_alcohol_types": df["Alcohol Type"].nunique(),
        "n_series": df.groupby(["Bar Name", "Brand Name"]).ngroups,
        "n_transactions": int(observed["n_transactions"].sum()),
        "total_consumed_ml": float(df["consumed_ml"].sum()),
        "total_consumed_liters": float(df["consumed_ml"].sum() / 1000),
        "date_min": df["Date"].min(),
        "date_max": df["Date"].max(),
        "n_calendar_days": df["Date"].nunique(),
    }


# ---------------------------------------------------------------------------
# 2. Consumption concentration
# ---------------------------------------------------------------------------
def concentration_analysis(df: pd.DataFrame):
    by_bar = df.groupby("Bar Name")["consumed_ml"].sum().sort_values(ascending=False)
    by_brand = df.groupby("Brand Name")["consumed_ml"].sum().sort_values(ascending=False)
    by_type = df.groupby("Alcohol Type")["consumed_ml"].sum().sort_values(ascending=False)

    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    by_bar.plot(kind="bar", ax=axes[0], color="steelblue")
    axes[0].set_title("Total Consumption by Bar")
    axes[0].set_ylabel("ml")
    by_type.plot(kind="bar", ax=axes[1], color="indianred")
    axes[1].set_title("Total Consumption by Alcohol Type")
    by_brand.plot(kind="bar", ax=axes[2], color="seagreen")
    axes[2].set_title("Total Consumption by Brand")
    plt.tight_layout()
    plt.savefig(FIG_DIR / "concentration_by_bar_type_brand.png", dpi=120)
    plt.close()

    return by_bar, by_brand, by_type


# ---------------------------------------------------------------------------
# 3. ABC velocity classification (dynamic cumulative-% thresholds, no hardcoding)
# ---------------------------------------------------------------------------
def abc_classification(df: pd.DataFrame, a_cutoff=0.80, b_cutoff=0.95) -> pd.DataFrame:
    """
    Classic ABC: rank series by total consumption, compute cumulative % of total volume,
    assign A/B/C by where each series' cumulative share falls.
    Thresholds (80/95) are configurable parameters, not hardcoded per-item rules —
    class boundaries emerge from the data's own cumulative distribution.
    """
    series_totals = (
        df.groupby(["Bar Name", "Brand Name"])["consumed_ml"]
        .sum()
        .sort_values(ascending=False)
        .reset_index()
    )
    total = series_totals["consumed_ml"].sum()
    series_totals["pct_of_total"] = series_totals["consumed_ml"] / total
    series_totals["cum_pct"] = series_totals["pct_of_total"].cumsum()

    def classify(cum_pct):
        if cum_pct <= a_cutoff:
            return "A"
        elif cum_pct <= b_cutoff:
            return "B"
        return "C"

    series_totals["abc_class"] = series_totals["cum_pct"].apply(classify)
    series_totals.to_csv(ABC_PATH, index=False)

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(range(1, len(series_totals) + 1), series_totals["cum_pct"] * 100, marker="o", markersize=3)
    ax.axhline(a_cutoff * 100, color="green", linestyle="--", label=f"A cutoff ({a_cutoff*100:.0f}%)")
    ax.axhline(b_cutoff * 100, color="orange", linestyle="--", label=f"B cutoff ({b_cutoff*100:.0f}%)")
    ax.set_xlabel("Series rank (by volume, descending)")
    ax.set_ylabel("Cumulative % of total consumption")
    ax.set_title("ABC Pareto Curve — Bar x Brand Series")
    ax.legend()
    plt.tight_layout()
    plt.savefig(FIG_DIR / "abc_pareto_curve.png", dpi=120)
    plt.close()

    return series_totals


# ---------------------------------------------------------------------------
# 4. Day-of-week / monthly pattern testing (empirical)
# ---------------------------------------------------------------------------
def temporal_pattern_tests(df: pd.DataFrame) -> dict:
    dow_means = df.groupby("dayofweek")["consumed_ml"].mean()
    dow_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    # ANOVA across day-of-week groups -> is there a statistically real difference?
    groups = [df.loc[df["dayofweek"] == d, "consumed_ml"].values for d in range(7)]
    f_stat, p_value = stats.f_oneway(*groups)

    fig, axes = plt.subplots(1, 2, figsize=(15, 5))
    axes[0].bar(dow_labels, dow_means.values, color="teal")
    axes[0].set_title(f"Mean Daily Consumption by Day of Week\n(ANOVA p={p_value:.4f})")
    axes[0].set_ylabel("Mean consumed ml per series-day")

    df["month"] = df["Date"].dt.month
    monthly = df.groupby("month")["consumed_ml"].mean()
    axes[1].plot(monthly.index, monthly.values, marker="o", color="darkorange")
    axes[1].set_title("Mean Daily Consumption by Month")
    axes[1].set_xlabel("Month")
    axes[1].set_xticks(range(1, 13))
    plt.tight_layout()
    plt.savefig(FIG_DIR / "dow_and_monthly_patterns.png", dpi=120)
    plt.close()

    weekend_mean = df.loc[df["is_weekend"] == 1, "consumed_ml"].mean()
    weekday_mean = df.loc[df["is_weekend"] == 0, "consumed_ml"].mean()
    t_stat, t_p = stats.ttest_ind(
        df.loc[df["is_weekend"] == 1, "consumed_ml"],
        df.loc[df["is_weekend"] == 0, "consumed_ml"],
        equal_var=False,
    )

    return {
        "dow_means": dow_means.to_dict(),
        "dow_anova_f": float(f_stat),
        "dow_anova_p": float(p_value),
        "dow_significant": bool(p_value < 0.05),
        "weekend_mean_ml": float(weekend_mean),
        "weekday_mean_ml": float(weekday_mean),
        "weekend_vs_weekday_uplift_pct": float((weekend_mean / weekday_mean - 1) * 100),
        "weekend_ttest_p": float(t_p),
        "weekend_effect_significant": bool(t_p < 0.05),
        "monthly_means": monthly.to_dict(),
    }


# ---------------------------------------------------------------------------
# 5. Per-series statistics + classification (stable/seasonal/intermittent/volatile)
# ---------------------------------------------------------------------------
def per_series_classification(df: pd.DataFrame) -> pd.DataFrame:
    grp = df.groupby(["Bar Name", "Brand Name"])["consumed_ml"]
    stats_df = grp.agg(
        mean_ml="mean",
        std_ml="std",
        n_days="count",
        pct_zero_days=lambda s: (s == 0).mean(),
    ).reset_index()
    stats_df["cv"] = stats_df["std_ml"] / stats_df["mean_ml"].replace(0, np.nan)

    # Active-day stats: every series in this dataset is intermittent (76-92% zero
    # days), so pct_zero_days alone cannot discriminate between series. To get a
    # useful sub-classification, compute mean/std/CV over NON-ZERO days only -
    # this measures how erratic demand is WHEN it actually occurs.
    active = df[df["consumed_ml"] > 0]
    active_stats = (
        active.groupby(["Bar Name", "Brand Name"])["consumed_ml"]
        .agg(active_mean_ml="mean", active_std_ml="std", n_active_days="count")
        .reset_index()
    )
    active_stats["active_cv"] = active_stats["active_std_ml"] / active_stats["active_mean_ml"].replace(0, np.nan)
    stats_df = stats_df.merge(active_stats, on=["Bar Name", "Brand Name"], how="left")

    # dow variability signal per series: ratio of weekend mean to weekday mean
    dow_ratio = (
        df.groupby(["Bar Name", "Brand Name", "is_weekend"])["consumed_ml"]
        .mean()
        .unstack()
        .rename(columns={0: "weekday_mean", 1: "weekend_mean"})
    )
    dow_ratio["weekend_uplift"] = dow_ratio["weekend_mean"] / dow_ratio["weekday_mean"].replace(0, np.nan) - 1
    stats_df = stats_df.merge(dow_ratio.reset_index(), on=["Bar Name", "Brand Name"], how="left")

    # Base tier: this data is uniformly intermittent (see Tier 0 sparsity: ~81%
    # implicit zeros). All series get an "intermittent-" prefix; the suffix is
    # decided by active-day CV (volatility when demand actually occurs) and
    # weekend uplift, using data-driven median splits rather than fixed cutoffs.
    active_cv_median = stats_df["active_cv"].median()

    def classify(row):
        if pd.notna(row["weekend_uplift"]) and row["weekend_uplift"] >= 0.25:
            return "intermittent-seasonal"
        if pd.notna(row["active_cv"]) and row["active_cv"] >= active_cv_median:
            return "intermittent-volatile"
        return "intermittent-stable"

    stats_df["series_class"] = stats_df.apply(classify, axis=1)
    stats_df.to_csv(SERIES_STATS_PATH, index=False)

    fig, ax = plt.subplots(figsize=(7, 5))
    stats_df["series_class"].value_counts().plot(kind="bar", ax=ax, color="slateblue")
    ax.set_title("Series Classification Counts (Bar x Brand)")
    ax.set_ylabel("Number of series")
    plt.tight_layout()
    plt.savefig(FIG_DIR / "series_classification_counts.png", dpi=120)
    plt.close()

    return stats_df


# ---------------------------------------------------------------------------
# 6. Inventory depletion audit (with Tier 0 caveat restated)
# ---------------------------------------------------------------------------
def depletion_audit(df: pd.DataFrame, near_zero_threshold=50.0) -> dict:
    observed = df[df["is_observed_day"]].copy()
    observed["depleted"] = observed["closing_balance_ml"] <= near_zero_threshold

    depletion_by_series = (
        observed.groupby(["Bar Name", "Brand Name"])["depleted"]
        .mean()
        .sort_values(ascending=False)
    )

    overall_depletion_rate = observed["depleted"].mean()

    fig, ax = plt.subplots(figsize=(10, 5))
    depletion_by_series.head(15).plot(kind="bar", ax=ax, color="crimson")
    ax.set_title(f"Top 15 Series by Depletion Frequency (closing <= {near_zero_threshold} ml)")
    ax.set_ylabel("Share of observed days depleted")
    plt.tight_layout()
    plt.savefig(FIG_DIR / "depletion_audit_top15.png", dpi=120)
    plt.close()

    return {
        "near_zero_threshold_ml": near_zero_threshold,
        "overall_depletion_rate_pct": float(overall_depletion_rate * 100),
        "top_depleted_series": depletion_by_series.head(10).to_dict(),
        "n_series_never_depleted": int((depletion_by_series == 0).sum()),
    }


# ---------------------------------------------------------------------------
# 7. Report writer
# ---------------------------------------------------------------------------
def write_report(kpis, by_bar, by_brand, by_type, abc_df, temporal, series_df, depletion):
    a_series = (abc_df["abc_class"] == "A").sum()
    b_series = (abc_df["abc_class"] == "B").sum()
    c_series = (abc_df["abc_class"] == "C").sum()

    class_counts = series_df["series_class"].value_counts().to_dict()

    lines = []
    lines.append("# Tier 1 — EDA Report\n")

    lines.append("## 1. Business Landscape KPIs\n")
    lines.append(f"- Bars: {kpis['n_bars']} | Brands: {kpis['n_brands']} | Alcohol types: {kpis['n_alcohol_types']}")
    lines.append(f"- Bar x Brand series: {kpis['n_series']}")
    lines.append(f"- Transactions: {kpis['n_transactions']:,}")
    lines.append(f"- Total consumption: {kpis['total_consumed_liters']:,.1f} liters")
    lines.append(f"- Date range: {kpis['date_min'].date()} to {kpis['date_max'].date()} "
                 f"({kpis['n_calendar_days']} days)\n")

    lines.append("## 2. Consumption Concentration\n")
    lines.append(f"- Top bar by volume: **{by_bar.index[0]}** ({by_bar.iloc[0]/1000:,.0f} L), "
                 f"bottom: {by_bar.index[-1]} ({by_bar.iloc[-1]/1000:,.0f} L)")
    lines.append(f"- Top alcohol type: **{by_type.index[0]}** ({by_type.iloc[0]/by_type.sum()*100:.1f}% of volume)")
    lines.append(f"- Top brand: **{by_brand.index[0]}** ({by_brand.iloc[0]/1000:,.0f} L)")
    lines.append("- See `figures/concentration_by_bar_type_brand.png`\n")

    lines.append("## 3. ABC Velocity Classification (dynamic, cumulative-% based)\n")
    lines.append(f"- Class A (top ~80% cumulative volume): **{a_series} series**")
    lines.append(f"- Class B (next ~15%, up to 95% cumulative): **{b_series} series**")
    lines.append(f"- Class C (remaining ~5%): **{c_series} series**")
    lines.append("- Thresholds are cumulative-share cutoffs (80%/95%) applied to the actual sorted "
                 "volume distribution — no brand/bar was hand-picked into a class.")
    lines.append("- See `figures/abc_pareto_curve.png`, full table in `data/processed/abc_classification.csv`\n")

    lines.append("## 4. Day-of-Week & Monthly Patterns (empirically tested)\n")
    lines.append(f"- One-way ANOVA across day-of-week groups: F={temporal['dow_anova_f']:.2f}, "
                 f"p={temporal['dow_anova_p']:.4f} -> "
                 f"{'**statistically significant**' if temporal['dow_significant'] else '**NOT significant**'} "
                 f"day-of-week effect at α=0.05.")
    lines.append(f"- Weekend mean vs weekday mean: {temporal['weekend_mean_ml']:.1f} ml vs "
                 f"{temporal['weekday_mean_ml']:.1f} ml "
                 f"({temporal['weekend_vs_weekday_uplift_pct']:+.1f}% uplift), "
                 f"Welch t-test p={temporal['weekend_ttest_p']:.4f} -> "
                 f"{'**significant**' if temporal['weekend_effect_significant'] else '**NOT significant**'}.")
    lines.append("- Conclusion: the assignment brief's assumption of a Fri/Sat spike is treated as a "
                 "hypothesis, not a given — see figures for the actual shape, and the number above for "
                 "whether it held up statistically in this dataset.")
    lines.append("- See `figures/dow_and_monthly_patterns.png`\n")

    lines.append("## 5. Per-Series Classification\n")
    lines.append(f"- All {len(series_df)} series have pct_zero_days between "
                 f"{series_df['pct_zero_days'].min()*100:.0f}% and {series_df['pct_zero_days'].max()*100:.0f}% "
                 f"— **the entire dataset is intermittent demand**, consistent with Tier 0's 81.29% sparsity finding. "
                 f"A stable/intermittent split on zero-rate alone would put 100% of series in one bucket, "
                 f"which is not actionable.")
    lines.append(f"- Sub-classification instead uses **active-day CV** (volatility of demand only on the "
                 f"days it actually occurs) and weekend uplift, with a data-driven median split rather than "
                 f"a fixed cutoff: {class_counts}")
    lines.append("- Rule: `weekend_uplift >= 25%` -> intermittent-seasonal; else `active_cv >= median` -> "
                 "intermittent-volatile; else intermittent-stable.")
    lines.append("- Full table: `data/processed/series_classification.csv`, chart: "
                 "`figures/series_classification_counts.png`\n")

    lines.append("## 6. Inventory Depletion Audit\n")
    lines.append(f"- Threshold for 'depleted': closing balance ≤ {depletion['near_zero_threshold_ml']} ml")
    lines.append(f"- Overall depletion rate across observed days: **{depletion['overall_depletion_rate_pct']:.2f}%**")
    lines.append(f"- Series never depleted: {depletion['n_series_never_depleted']} of {len(series_df)}")
    lines.append("- **Tier 0 caveat restated**: a depleted closing balance is NOT proof of a lost sale. "
                 "This dataset has no field recording turned-away guests. Depletion frequency here is a "
                 "*proxy for stockout risk*, not a stockout count. Any 'reduction in stockouts' claim in "
                 "later tiers must be against *simulated* stockouts from a controlled backtest, not this raw signal.")
    lines.append("- See `figures/depletion_audit_top15.png`\n")

    lines.append("## 7. Modeling Decisions for Tier 2\n")
    lines.append("Based on the evidence above:\n")
    lines.append(f"1. **Primary metric: WAPE**, not MAPE or plain MAE. Consumption is intermittent "
                 f"(~81% zero-demand slots per Tier 0), so MAPE is undefined on zero-actual days.")
    lines.append(f"2. **This is a 100%-intermittent-demand dataset (76-92% zero days per series) — standard "
                 f"exponential smoothing / plain Holt-Winters is the WRONG default for every series here**, "
                 f"not just a subset. Favor either Croston's method / TSB (built for intermittent demand) "
                 f"per series, or a single **pooled tree-based model** (RandomForest/LightGBM) trained across "
                 f"all 96 series with Bar and Brand as categorical features — pooling lets low-volume series "
                 f"borrow strength instead of fitting noise. Given the uniform intermittency, favor the pooled "
                 f"global model as the primary approach and use per-series statistical models only as a baseline "
                 f"comparison for Class A series.")
    lines.append(f"3. Day-of-week feature is {'justified' if temporal['dow_significant'] else 'NOT strongly justified by ANOVA, but'} "
                 f"kept as a candidate feature; weekend flag alone shows "
                 f"{temporal['weekend_vs_weekday_uplift_pct']:+.1f}% uplift "
                 f"({'significant' if temporal['weekend_effect_significant'] else 'not significant'} at p<0.05) — "
                 f"include it as an engineered feature and let the model/regularization decide its weight, "
                 f"rather than hardcoding a weekend multiplier.")
    lines.append(f"4. Class C / low-volume series are candidates for a simple rule-based par level "
                 f"(e.g. fixed small buffer) rather than a fitted model — the volume doesn't justify "
                 f"model complexity and CV will be unstable on such thin series.")
    lines.append(f"5. Train/validation split for Tier 2 must be temporal (last ~20% of the {kpis['n_calendar_days']}-day "
                 f"range held out), never k-fold, consistent with the assignment brief.")
    lines.append(f"6. Series flagged `volatile` (high CV, not explained by weekend seasonality) need wider "
                 f"safety-stock buffers in Tier 3 regardless of point-forecast accuracy — flag them for the "
                 f"par-level team as high-Z-score candidates.")

    report = "\n".join(lines)
    REPORT_PATH.write_text(report)
    return report


def main():
    df = load_grid()
    kpis = business_kpis(df)
    by_bar, by_brand, by_type = concentration_analysis(df)
    abc_df = abc_classification(df)
    temporal = temporal_pattern_tests(df)
    series_df = per_series_classification(df)
    depletion = depletion_audit(df)
    report = write_report(kpis, by_bar, by_brand, by_type, abc_df, temporal, series_df, depletion)
    print(report)


if __name__ == "__main__":
    main()
