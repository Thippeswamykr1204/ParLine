"""Pure DataFrame <-> normalized-table transforms (no DB). Unit-tested for lossless CSV round trips."""
from __future__ import annotations
import numpy as np, pandas as pd
from .naming import MODEL_KEYS, PRED_COL, PROFILE_CSV_COLS, SIM_COLS, DISPLAY_TO_KEY, MODEL_DISPLAY

DAILY_COLS = ["Date", "Bar Name", "Brand Name", "consumed_ml", "purchase_ml", "opening_balance_ml",
              "closing_balance_ml", "n_transactions", "is_observed_day", "dayofweek", "is_weekend", "Alcohol Type"]

def daily_to_db(daily: pd.DataFrame) -> pd.DataFrame:
    d = pd.DataFrame({
        "Bar Name": daily["Bar Name"], "Brand Name": daily["Brand Name"],
        "demand_date": pd.to_datetime(daily["Date"]).dt.date,
        "consumed_ml": daily["consumed_ml"], "purchase_ml": daily["purchase_ml"],
        "opening_balance_ml": daily["opening_balance_ml"], "closing_balance_ml": daily["closing_balance_ml"],
        "n_transactions": daily["n_transactions"].astype(int), "is_observed_day": daily["is_observed_day"].astype(bool),
        "day_of_week": daily["dayofweek"].astype(int), "is_weekend": daily["is_weekend"].astype(int)})
    return d

def daily_from_db(d: pd.DataFrame, alcohol: pd.Series) -> pd.DataFrame:
    out = pd.DataFrame({
        "Date": pd.to_datetime(d["demand_date"]), "Bar Name": d["Bar Name"], "Brand Name": d["Brand Name"],
        "consumed_ml": d["consumed_ml"].astype(float), "purchase_ml": d["purchase_ml"].astype(float),
        "opening_balance_ml": d["opening_balance_ml"].astype(float), "closing_balance_ml": d["closing_balance_ml"].astype(float),
        "n_transactions": d["n_transactions"].astype(int), "is_observed_day": d["is_observed_day"].astype(bool),
        "dayofweek": d["day_of_week"].astype(int), "is_weekend": d["is_weekend"].astype(int)})
    out["Alcohol Type"] = out["Brand Name"].map(alcohol)
    return out.sort_values(["Bar Name", "Brand Name", "Date"]).reset_index(drop=True)[DAILY_COLS]

def wide_to_long_forecasts(pred: pd.DataFrame) -> pd.DataFrame:
    parts = []
    for key in MODEL_KEYS:
        col = PRED_COL[key]
        if col not in pred: continue
        parts.append(pd.DataFrame({"Bar Name": pred["Bar Name"], "Brand Name": pred["Brand Name"],
                                   "forecast_date": pd.to_datetime(pred["Date"]).dt.date, "model_key": key,
                                   "predicted_ml": pred[col].fillna(0.0), "actual_ml": pred["consumed_ml"]}))
    return pd.concat(parts, ignore_index=True)

def long_to_wide_forecasts(long: pd.DataFrame, alcohol: pd.Series, profiles: pd.DataFrame | None = None) -> pd.DataFrame:
    """Back to tier2_validation_predictions layout (needed columns; freq_bucket recomputed if profiles given)."""
    w = long.pivot_table(index=["forecast_date", "Bar Name", "Brand Name"], columns="model_key",
                         values="predicted_ml", aggfunc="first").reset_index()
    act = long.drop_duplicates(["forecast_date", "Bar Name", "Brand Name"])[["forecast_date", "Bar Name", "Brand Name", "actual_ml"]]
    w = w.merge(act, on=["forecast_date", "Bar Name", "Brand Name"])
    out = pd.DataFrame({"Date": pd.to_datetime(w["forecast_date"]), "Bar Name": w["Bar Name"], "Brand Name": w["Brand Name"]})
    out["Alcohol Type"] = out["Brand Name"].map(alcohol)
    out["consumed_ml"] = w["actual_ml"].values
    for key in MODEL_KEYS:
        if key in w: out[PRED_COL[key]] = w[key].values
    if profiles is not None:
        out = out.merge(profiles[["Bar Name", "Brand Name", "abc_class", "pct_zero_days", "series_class"]],
                        on=["Bar Name", "Brand Name"], how="left")
        out["freq_bucket"] = pd.qcut(out["pct_zero_days"], q=3, labels=["high-frequency", "mid-frequency", "low-frequency"])
    return out.sort_values(["Bar Name", "Brand Name", "Date"]).reset_index(drop=True)

def profiles_to_frame(series_class: pd.DataFrame, abc: pd.DataFrame) -> pd.DataFrame:
    m = series_class.merge(abc[["Bar Name", "Brand Name", "consumed_ml", "pct_of_total", "cum_pct", "abc_class"]],
                           on=["Bar Name", "Brand Name"], how="outer")
    return m

def profiles_export(p: pd.DataFrame) -> pd.DataFrame:
    cols = ["Bar Name", "Brand Name"] + PROFILE_CSV_COLS + ["series_class"]
    return p[cols].sort_values(["Bar Name", "Brand Name"]).reset_index(drop=True)

def sim_export(sim: pd.DataFrame, policy: str) -> pd.DataFrame:
    out = sim[SIM_COLS + ["Bar Name", "Brand Name"]].copy()
    prof = sim[["abc_class", "series_class"]] if "abc_class" in sim else None
    if prof is not None: out[["abc_class", "series_class"]] = prof
    out["policy"] = policy
    return out.sort_values(["Bar Name", "Brand Name"]).reset_index(drop=True)

def model_comparison_frame(metrics: pd.DataFrame) -> pd.DataFrame:
    """metrics: model_key, WAPE, MAE, RMSE -> tier2_model_comparison.csv layout (sorted by WAPE)."""
    m = metrics.copy(); m["model"] = m["model_key"].map(MODEL_DISPLAY)
    return m[["model", "WAPE", "MAE", "RMSE"]].sort_values("WAPE").reset_index(drop=True)

def policy_comparison(sims: dict, aggregate) -> pd.DataFrame:
    rows = [aggregate(df, name) for name, df in sims.items()]
    return pd.DataFrame(rows).sort_values("stockout_rate_pct").reset_index(drop=True)
