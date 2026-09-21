"""Per-run monitoring rows -> model_metrics. Drift is measured against the previous run's stored value."""
from __future__ import annotations
import logging
import numpy as np, pandas as pd
from . import repo
from .config import BASELINE_POLICY, NUANCE, RECOMMENDED_POLICY, WAPE_DRIFT_ALERT
from .naming import PRED_COL

log = logging.getLogger("parline.monitoring")

def collect(conn, run_id, scores: pd.DataFrame, pred: pd.DataFrame, agg_by_policy: dict, recs: pd.DataFrame,
            ingest_stats: dict | None = None) -> list[dict]:
    rows, alerts = [], []
    winner_forecast = scores.sort_values("WAPE").iloc[0]["model_key"]
    for _, s in scores.iterrows():
        k = s["model_key"]
        for name, col in (("forecast_wape", "WAPE"), ("forecast_mae", "MAE"), ("forecast_rmse", "RMSE"), ("forecast_bias", "bias")):
            rows.append(dict(metric_name=name, model_key=k, value=float(s[col])))
        prev = repo.latest_metric(conn, "forecast_wape", k, run_id)
        if prev:
            drift = (s["WAPE"] - prev) / prev
            rows.append(dict(metric_name="forecast_wape_drift", model_key=k, value=float(drift),
                             details={"previous_wape": prev, "alert_threshold": WAPE_DRIFT_ALERT}))
            if drift > WAPE_DRIFT_ALERT: alerts.append(f"WAPE drift {drift:+.1%} for {k}")
        prev_b = repo.latest_metric(conn, "forecast_bias", k, run_id)
        if prev_b is not None and not pd.isna(s["bias"]):
            rows.append(dict(metric_name="forecast_bias_drift", model_key=k, value=float(s["bias"] - prev_b)))
    # per-ABC WAPE for the models that matter
    for k in ("rolling_mean_7", "global_ml"):
        if PRED_COL[k] not in pred or "abc_class" not in pred: continue
        for abc, g in pred.groupby("abc_class"):
            d = g["consumed_ml"].abs().sum()
            if d: rows.append(dict(metric_name="forecast_wape", model_key=k, scope="abc_class", scope_value=str(abc),
                                   value=float((g["consumed_ml"] - g[PRED_COL[k]].fillna(0)).abs().sum() / d)))
    # simulation / business metrics
    for pol, a in agg_by_policy.items():
        rows.append(dict(metric_name="stockout_rate_pct", model_key=pol, value=float(a["stockout_rate_pct"])))
        rows.append(dict(metric_name="stockout_days", model_key=pol, value=float(a["total_stockout_days"])))
        rows.append(dict(metric_name="lost_volume_ml", model_key=pol, value=float(a["total_lost_volume_ml"])))
    sim_winner = min(agg_by_policy, key=lambda p: agg_by_policy[p]["total_stockout_days"])
    if BASELINE_POLICY in agg_by_policy and agg_by_policy[BASELINE_POLICY]["total_stockout_days"]:
        red = 1 - agg_by_policy[sim_winner]["total_stockout_days"] / agg_by_policy[BASELINE_POLICY]["total_stockout_days"]
        rows.append(dict(metric_name="stockout_reduction_vs_naive", model_key=sim_winner, value=float(red)))
    rows.append(dict(metric_name="winner_summary", value=None, details={
        "forecast_accuracy_winner": winner_forecast, "simulation_winner": sim_winner,
        "same_model": winner_forecast == "global_ml" and sim_winner.startswith("Global ML"),
        "expected_simulation_winner": RECOMMENDED_POLICY, "nuance": NUANCE}))
    # recommendation acceptance: placeholders until buyers act on recommendations
    prev = conn.execute(__import__("sqlalchemy").text(
        "SELECT count(*) FILTER (WHERE acceptance_status='accepted'), count(*) FILTER (WHERE acceptance_status IN ('accepted','rejected')),"
        " count(*) FROM reorder_recommendations WHERE run_id<>:r"), {"r": run_id}).one()
    rows.append(dict(metric_name="recommendations_generated", value=float(len(recs))))
    rows.append(dict(metric_name="recommendation_acceptance_rate", value=(float(prev[0] / prev[1]) if prev[1] else None),
                     details={"placeholder": prev[1] == 0, "accepted": prev[0], "decided": prev[1], "issued_previously": prev[2]}))
    for k, v in (ingest_stats or {}).items():
        rows.append(dict(metric_name=f"ingest_{k}", value=float(v)))
    for a in alerts: log.warning("MONITORING ALERT run=%s %s", run_id, a)
    return rows
