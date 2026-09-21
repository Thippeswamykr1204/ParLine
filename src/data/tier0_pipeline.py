"""
Tier 0 — Data Foundation Pipeline
Hotel Bar Inventory Forecasting Project

Does ONLY:
  1. Load + validate raw transaction log
  2. Check inventory conservation identity with tolerance
  3. Quantify sparsity (implicit zero-demand %)
  4. Build canonical daily Date x Bar x Brand demand grid, zero-filled
  5. Write validation report + processed dataset to disk

No forecasting. No UI. Tier 1+ only.
"""

import pandas as pd
import numpy as np
from pathlib import Path

RAW_PATH = Path("data/raw/bar_inventory_data.xlsx")
PROCESSED_PATH = Path("data/processed/daily_bar_consumption.csv")
REPORT_PATH = Path("report/tier0_validation_report.md")

TOLERANCE_ML = 0.01  # acceptable float rounding slack in the conservation identity


def load_raw(path: Path = RAW_PATH) -> pd.DataFrame:
    df = pd.read_excel(path)
    df["Date Time Served"] = pd.to_datetime(df["Date Time Served"])
    df["Date"] = df["Date Time Served"].dt.floor("D")
    return df


def basic_profile(df: pd.DataFrame) -> dict:
    return {
        "row_count": len(df),
        "bars": sorted(df["Bar Name"].unique().tolist()),
        "n_bars": df["Bar Name"].nunique(),
        "alcohol_types": sorted(df["Alcohol Type"].unique().tolist()),
        "n_alcohol_types": df["Alcohol Type"].nunique(),
        "brands": sorted(df["Brand Name"].unique().tolist()),
        "n_brands": df["Brand Name"].nunique(),
        "date_min": df["Date"].min(),
        "date_max": df["Date"].max(),
        "n_days_span": (df["Date"].max() - df["Date"].min()).days + 1,
        "null_counts": df.isnull().sum().to_dict(),
        "duplicate_rows": int(df.duplicated().sum()),
    }


def validate_conservation(df: pd.DataFrame, tol: float = TOLERANCE_ML) -> dict:
    """Closing = Opening + Purchase - Consumed, checked with explicit tolerance."""
    implied_closing = df["Opening Balance (ml)"] + df["Purchase (ml)"] - df["Consumed (ml)"]
    error = (implied_closing - df["Closing Balance (ml)"]).abs()
    within_tol = error <= tol
    return {
        "tolerance_ml": tol,
        "max_abs_error_ml": float(error.max()),
        "mean_abs_error_ml": float(error.mean()),
        "rows_within_tolerance": int(within_tol.sum()),
        "rows_out_of_tolerance": int((~within_tol).sum()),
        "pct_within_tolerance": float(within_tol.mean() * 100),
        "worst_offenders": df.loc[error.sort_values(ascending=False).index[:5]][
            ["Date Time Served", "Bar Name", "Brand Name",
             "Opening Balance (ml)", "Purchase (ml)", "Consumed (ml)", "Closing Balance (ml)"]
        ].assign(implied_closing=implied_closing, abs_error=error).to_dict(orient="records"),
    }


def quantify_sparsity(df: pd.DataFrame) -> dict:
    n_bars = df["Bar Name"].nunique()
    n_brands = df["Brand Name"].nunique()
    n_days = df["Date"].nunique()
    date_range_days = (df["Date"].max() - df["Date"].min()).days + 1

    possible_slots_observed_days = n_bars * n_brands * n_days
    possible_slots_full_calendar = n_bars * n_brands * date_range_days

    # actual observed (Date,Bar,Brand) combinations that have >=1 transaction row
    observed_combos = df.groupby(["Date", "Bar Name", "Brand Name"]).ngroups

    return {
        "n_bars": n_bars,
        "n_brands": n_brands,
        "n_unique_transaction_days": n_days,
        "calendar_days_in_range": date_range_days,
        "possible_slots_over_observed_days": possible_slots_observed_days,
        "possible_slots_over_full_calendar": possible_slots_full_calendar,
        "observed_bar_brand_day_combos": observed_combos,
        "implicit_zero_pct_over_observed_days": round(
            100 * (1 - observed_combos / possible_slots_observed_days), 2
        ),
        "implicit_zero_pct_over_full_calendar": round(
            100 * (1 - observed_combos / possible_slots_full_calendar), 2
        ),
    }


def build_daily_grid(df: pd.DataFrame) -> pd.DataFrame:
    """Full Cartesian product Date x Bar x Brand, zero-filled, aggregated from raw log."""
    daily_agg = (
        df.groupby(["Date", "Bar Name", "Brand Name"], as_index=False)
        .agg(
            consumed_ml=("Consumed (ml)", "sum"),
            purchase_ml=("Purchase (ml)", "sum"),
            opening_balance_ml=("Opening Balance (ml)", "first"),
            closing_balance_ml=("Closing Balance (ml)", "last"),
            n_transactions=("Consumed (ml)", "count"),
        )
    )

    bars = df["Bar Name"].unique()
    brands = df["Brand Name"].unique()
    dates = pd.date_range(df["Date"].min(), df["Date"].max(), freq="D")

    full_index = pd.MultiIndex.from_product(
        [dates, bars, brands], names=["Date", "Bar Name", "Brand Name"]
    )
    grid = (
        daily_agg.set_index(["Date", "Bar Name", "Brand Name"])
        .reindex(full_index)
        .reset_index()
    )

    grid["is_observed_day"] = grid["n_transactions"].notna()
    grid["consumed_ml"] = grid["consumed_ml"].fillna(0.0)
    grid["purchase_ml"] = grid["purchase_ml"].fillna(0.0)
    grid["n_transactions"] = grid["n_transactions"].fillna(0).astype(int)
    grid["dayofweek"] = grid["Date"].dt.dayofweek
    grid["is_weekend"] = grid["dayofweek"].isin([4, 5, 6]).astype(int)

    # map brand -> alcohol type (static lookup, brand is 1:1 with type in this dataset)
    brand_type_map = df.drop_duplicates("Brand Name").set_index("Brand Name")["Alcohol Type"]
    grid["Alcohol Type"] = grid["Brand Name"].map(brand_type_map)

    return grid.sort_values(["Bar Name", "Brand Name", "Date"]).reset_index(drop=True)


def write_report(profile: dict, conservation: dict, sparsity: dict, grid_shape: tuple) -> str:
    lines = []
    lines.append("# Tier 0 — Data Validation Report\n")
    lines.append("## 1. Dataset Profile\n")
    lines.append(f"- Row count (raw transactions): **{profile['row_count']:,}**")
    lines.append(f"- Bars ({profile['n_bars']}): {', '.join(profile['bars'])}")
    lines.append(f"- Alcohol types ({profile['n_alcohol_types']}): {', '.join(profile['alcohol_types'])}")
    lines.append(f"- Brands ({profile['n_brands']}): {', '.join(profile['brands'])}")
    lines.append(f"- Date range: {profile['date_min'].date()} to {profile['date_max'].date()} "
                 f"({profile['n_days_span']} calendar days)")
    lines.append(f"- Duplicate rows: {profile['duplicate_rows']}")
    lines.append(f"- Null values per column: {profile['null_counts']}\n")

    lines.append("## 2. Inventory Conservation Check\n")
    lines.append("Identity tested: `Closing = Opening + Purchase - Consumed`\n")
    lines.append(f"- Tolerance used: ±{conservation['tolerance_ml']} ml")
    lines.append(f"- Max absolute error observed: **{conservation['max_abs_error_ml']:.4f} ml**")
    lines.append(f"- Mean absolute error: {conservation['mean_abs_error_ml']:.6f} ml")
    lines.append(f"- Rows within tolerance: {conservation['rows_within_tolerance']:,} "
                 f"({conservation['pct_within_tolerance']:.2f}%)")
    lines.append(f"- Rows OUT of tolerance: {conservation['rows_out_of_tolerance']:,}\n")

    lines.append("## 3. Sparsity Quantification\n")
    lines.append(f"- Bars x Brands = {sparsity['n_bars']} x {sparsity['n_brands']} = "
                 f"{sparsity['n_bars'] * sparsity['n_brands']} series")
    lines.append(f"- Full calendar days in range: {sparsity['calendar_days_in_range']}")
    lines.append(f"- Possible slots (full calendar): {sparsity['possible_slots_over_full_calendar']:,}")
    lines.append(f"- Observed Bar x Brand x Day combos (>=1 txn): "
                 f"{sparsity['observed_bar_brand_day_combos']:,}")
    lines.append(f"- **Implicit zero-demand rate (full calendar basis): "
                 f"{sparsity['implicit_zero_pct_over_full_calendar']}%**")
    lines.append(f"- Implicit zero-demand rate (transaction-days basis): "
                 f"{sparsity['implicit_zero_pct_over_observed_days']}%\n")

    lines.append("## 4. Canonical Daily Grid\n")
    lines.append(f"- Output shape: {grid_shape[0]:,} rows x {grid_shape[1]} columns")
    lines.append("- Written to `data/processed/daily_bar_consumption.csv`\n")

    report = "\n".join(lines)
    REPORT_PATH.write_text(report)
    return report


def main():
    df = load_raw()
    profile = basic_profile(df)
    conservation = validate_conservation(df)
    sparsity = quantify_sparsity(df)
    grid = build_daily_grid(df)
    grid.to_csv(PROCESSED_PATH, index=False)
    report = write_report(profile, conservation, sparsity, grid.shape)
    print(report)


if __name__ == "__main__":
    main()
