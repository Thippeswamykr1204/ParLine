"""Thin orchestration over the verified Tier 2-4 code. No modelling logic is reimplemented here:
features, splits, baselines, Holt-Winters, HistGBM, metrics, par formulas and the simulation loop all
come from src/data/tier{2,3,4}. Only the glue that tier2.main()/tier4.main() do inline is repeated."""
from __future__ import annotations
import numpy as np, pandas as pd
from .. import legacy
from ..naming import MODEL_KEYS, MODEL_DISPLAY, PRED_COL, POLICY_DEFS

def attach_context(merged: pd.DataFrame, abc: pd.DataFrame, series_class: pd.DataFrame) -> pd.DataFrame:
    """Same merges + tertile freq_bucket as tier2.main()."""
    m = merged.merge(abc[["Bar Name", "Brand Name", "abc_class"]], on=["Bar Name", "Brand Name"], how="left")
    m = m.merge(series_class[["Bar Name", "Brand Name", "pct_zero_days", "series_class"]],
                on=["Bar Name", "Brand Name"], how="left")
    m["freq_bucket"] = pd.qcut(m["pct_zero_days"], q=3, labels=["high-frequency", "mid-frequency", "low-frequency"])
    return m

def run_forecast(daily: pd.DataFrame, models=("seasonal_naive", "rolling_mean_7", "rolling_mean_14", "global_ml", "holt_winters")):
    """Tier 2 backtest on `daily` (daily_bar_consumption schema). Returns (wide predictions, metrics df, split_date)."""
    t2 = legacy.t2()
    models = set(models)
    df = daily.copy(); df["Date"] = pd.to_datetime(df["Date"])
    feat = t2.engineer_features(df)
    train, valid, split_date = t2.chronological_split(feat)
    merged = valid[["Date", "Bar Name", "Brand Name", "Alcohol Type", t2.TARGET_COL]].copy()
    base = t2.baseline_predictions(feat, valid).drop(columns=[t2.TARGET_COL])
    merged = merged.merge(base, on=["Date", "Bar Name", "Brand Name"], how="left")
    if "holt_winters" in models:
        merged = merged.merge(t2.holt_winters_predictions(train, valid), on=["Date", "Bar Name", "Brand Name"], how="left")
    if "global_ml" in models:
        ml_preds, _ = t2.global_ml_predictions(train, valid)
        merged = merged.merge(ml_preds, on=["Date", "Bar Name", "Brand Name"], how="left")
    return merged, split_date

def score_models(pred: pd.DataFrame) -> pd.DataFrame:
    """WAPE/MAE/RMSE per model using tier2.score, plus signed bias (extra, for drift monitoring)."""
    t2 = legacy.t2(); rows = []
    for key in MODEL_KEYS:
        col = PRED_COL[key]
        if col not in pred: continue
        p = pred[col].fillna(0); y = pred["consumed_ml"]
        s = t2.score(y, p)
        s["bias"] = float((p - y).sum() / y.abs().sum()) if y.abs().sum() else np.nan
        s["model_key"] = key; rows.append(s)
    return pd.DataFrame(rows)

def par_grid(pred: pd.DataFrame, model_key: str, lead_times=None, service_levels=None) -> pd.DataFrame:
    """Tier 3 series stats + build_recommendations for one forecast model."""
    t3 = legacy.t3()
    stats = t3.compute_series_forecast_and_error(pred, PRED_COL[model_key])
    return t3.build_recommendations(stats, lead_times or t3.LEAD_TIME_OPTIONS, service_levels or t3.SERVICE_LEVEL_OPTIONS)

def par_level_scalar(avg_forecast_demand_per_day: float, forecast_rmse: float, lead_time_days: int, service_level: str):
    t3 = legacy.t3(); z = t3.SERVICE_LEVEL_OPTIONS[service_level]
    ltd = t3.compute_lead_time_demand(avg_forecast_demand_per_day, lead_time_days)
    ss = t3.compute_safety_stock(forecast_rmse, lead_time_days, z)
    return {"z_score": z, "lead_time_demand_ml": ltd, "safety_stock_ml": ss,
            "par_level_ml": t3.compute_par_level(ltd, ss), "reorder_point_ml": t3.compute_reorder_point(ltd, ss)}

def series_inputs(pred: pd.DataFrame) -> pd.DataFrame:
    return legacy.t4().compute_series_inputs(pred)

def simulate_policies(pred: pd.DataFrame, policies=None, lead_time_days=2):
    """Tier 4: run each named policy across all series. Returns {policy: per-series sim df}."""
    t4 = legacy.t4(); inputs = t4.compute_series_inputs(pred); out = {}
    for name in (policies or POLICY_DEFS):
        model_key, sl = POLICY_DEFS[name]
        if model_key is None:
            out[name] = t4.run_policy_across_series(pred, inputs, name, lead_time_days, is_naive=True)
        else:
            out[name] = t4.run_policy_across_series(pred, inputs, name, lead_time_days,
                                                    model_col=PRED_COL[model_key], z=t4.SERVICE_LEVEL_Z[sl])
    return out

def simulate_raw(actual_demand, lead_time_days, reorder_point, par_level=None, fixed_order_qty=None, initial_stock=None):
    return legacy.t4().simulate_series(np.asarray(actual_demand, float), lead_time_days, reorder_point,
                                       par_level=par_level, fixed_order_qty=fixed_order_qty, initial_stock=initial_stock)

def aggregate(sim: pd.DataFrame, name: str) -> dict:
    return legacy.t4().aggregate_policy(sim, name)
