"""Stable keys + column maps shared by seed, pipeline, exports and API."""
MODEL_DISPLAY = {
    "seasonal_naive": "Seasonal-Naive (t-7)",
    "rolling_mean_7": "Rolling Mean (7d)",
    "rolling_mean_14": "Rolling Mean (14d)",
    "holt_winters": "Holt-Winters (weekly)",
    "global_ml": "Global ML (HistGBM)",
}
MODEL_KEYS = list(MODEL_DISPLAY)
DISPLAY_TO_KEY = {v: k for k, v in MODEL_DISPLAY.items()}
PRED_COL = {k: f"pred_{k}" for k in MODEL_KEYS}

# tier4 policy name -> (model_key or None, service level or None)
POLICY_DEFS = {
    "Naive (fixed qty)": (None, None),
    "Moving Average (95% SL)": ("rolling_mean_7", "95%"),
    "Holt-Winters (95% SL)": ("holt_winters", "95%"),
    "Global ML (95% SL)": ("global_ml", "95%"),
    "Global ML (99% SL)": ("global_ml", "99%"),
}
PERSERIES_FILE = {p: "tier4_perseries_" + p.replace(" ", "_").replace("(", "").replace(")", "").replace("%", "pct") + ".csv"
                  for p in POLICY_DEFS}

PAR_DB_TO_CSV = {
    "avg_forecast_demand_per_day_ml": "avg_forecast_demand_per_day_ml", "forecast_rmse_ml": "forecast_rmse_ml",
    "lead_time_demand_ml": "lead_time_demand_ml", "safety_stock_ml": "safety_stock_ml",
    "par_level_ml": "par_level_ml", "reorder_point_ml": "reorder_point_ml",
    "lead_time_days": "lead_time_days", "service_level": "service_level", "z_score": "z_score",
}
SIM_COLS = ["stockout_days", "stockout_rate_pct", "lost_volume_ml", "avg_holding_ml", "turnover_ratio",
            "n_orders_placed", "n_days_simulated"]
PROFILE_CSV_COLS = ["mean_ml", "std_ml", "n_days", "pct_zero_days", "cv", "active_mean_ml", "active_std_ml",
                    "n_active_days", "active_cv", "weekday_mean", "weekend_mean", "weekend_uplift"]
