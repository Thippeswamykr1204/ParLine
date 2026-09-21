"""Rebuilds the exact CSV files the static-mode frontend reads (public/data/*.csv), from the database.
The frontend's own loader + TypeScript engine then run on top unchanged, so API mode == CSV mode by construction."""
from __future__ import annotations
import pandas as pd
from sqlalchemy import text
from . import repo, transforms as T, legacy
from .db import current_run_id
from .naming import PERSERIES_FILE, POLICY_DEFS

FILES = ["daily_bar_consumption.csv", "series_classification.csv", "tier2_model_comparison.csv",
         "tier2_validation_predictions.csv", "tier3_par_level_full_grid.csv", "tier4_series_model_inputs.csv",
         "tier4_policy_comparison.csv", "tier4_leadtime_sensitivity.csv", *PERSERIES_FILE.values()]

def _sims(conn, run_id, profiles):
    sim = repo.load_sim(conn, run_id)
    ctx = profiles[["Bar Name", "Brand Name", "abc_class", "series_class"]]
    return sim.merge(ctx, on=["Bar Name", "Brand Name"], how="left")

def model_metrics_frame(conn, run_id):
    rows = conn.execute(text("""SELECT model_key, metric_name, value FROM model_metrics WHERE run_id=:r AND scope='overall'
        AND metric_name IN ('forecast_wape','forecast_mae','forecast_rmse','forecast_bias') AND model_key IS NOT NULL"""), {"r": run_id}).all()
    df = pd.DataFrame(rows, columns=["model_key", "metric", "value"]).pivot(index="model_key", columns="metric", values="value").reset_index()
    return df.rename(columns={"forecast_wape": "WAPE", "forecast_mae": "MAE", "forecast_rmse": "RMSE", "forecast_bias": "bias"})

def build(conn, filename: str) -> pd.DataFrame:
    run = current_run_id(conn)
    if run is None: raise LookupError("no successful forecast run in the database yet (run the seed or the daily job)")
    if filename == "daily_bar_consumption.csv": return repo.load_daily(conn)
    profiles = repo.load_profiles(conn)
    if filename == "series_classification.csv": return T.profiles_export(profiles)
    if filename == "tier2_model_comparison.csv": return T.model_comparison_frame(model_metrics_frame(conn, run))
    if filename == "tier2_validation_predictions.csv": return repo.load_forecasts_wide(conn, run)
    if filename == "tier3_par_level_full_grid.csv":
        g = repo.load_par_levels(conn, run, "rolling_mean_7").merge(
            profiles[["Bar Name", "Brand Name", "abc_class", "series_class"]], on=["Bar Name", "Brand Name"])
        g = g.sort_values(["Bar Name", "Brand Name", "lead_time_days", "z_score"]).reset_index(drop=True)
        return g[["Bar Name", "Brand Name", "abc_class", "series_class", "lead_time_days", "service_level", "z_score",
                  "avg_forecast_demand_per_day_ml", "forecast_rmse_ml", "lead_time_demand_ml", "safety_stock_ml",
                  "par_level_ml", "reorder_point_ml"]]
    if filename == "tier4_series_model_inputs.csv":
        return legacy.t4().compute_series_inputs(repo.load_forecasts_wide(conn, run))
    sims = _sims(conn, run, profiles); t4 = legacy.t4()
    base = sims[sims["lead_time_days"] == 2]
    if filename == "tier4_policy_comparison.csv":
        return T.policy_comparison({p: base[base["policy"] == p] for p in POLICY_DEFS}, t4.aggregate_policy)
    if filename == "tier4_leadtime_sensitivity.csv":
        comp = T.policy_comparison({p: base[base["policy"] == p] for p in POLICY_DEFS}, t4.aggregate_policy)
        best = comp[comp["policy"] != "Naive (fixed qty)"].iloc[0]["policy"]
        rows = [t4.aggregate_policy(sims[(sims["policy"] == best) & (sims["lead_time_days"] == L)], f"{best} @ L={L}d")
                for L in (2, 3, 5)]
        return pd.DataFrame(rows)
    for policy, fname in PERSERIES_FILE.items():
        if fname == filename:
            return T.sim_export(base[base["policy"] == policy], policy)
    raise KeyError(filename)

def to_csv_text(conn, filename: str) -> str:
    return build(conn, filename).to_csv(index=False)
