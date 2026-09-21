"""Stages shared by the seed loader and the daily job so both persist a run identically."""
from __future__ import annotations
import pandas as pd
from .. import monitoring, repo
from ..config import DEFAULT_LEAD_TIME, RECOMMENDED_POLICY
from ..ml import service as svc
from ..naming import POLICY_DEFS
from .. import recommendation_engine as eng

LT_SENSITIVITY = (2, 3, 5)

def derive(pred: pd.DataFrame, sims_l2: dict | None = None) -> dict:
    """Everything downstream of the forecasts. `sims_l2` lets the seed reuse the verified Tier 4 CSVs."""
    sims = sims_l2 or svc.simulate_policies(pred, lead_time_days=DEFAULT_LEAD_TIME)
    agg = {p: svc.aggregate(df, p) for p, df in sims.items()}
    ranked = sorted((p for p in agg if p != "Naive (fixed qty)"), key=lambda p: agg[p]["stockout_rate_pct"])
    best = ranked[0]
    lt = {DEFAULT_LEAD_TIME: sims[best]}
    for L in LT_SENSITIVITY:
        if L not in lt: lt[L] = svc.simulate_policies(pred, [best], lead_time_days=L)[best]
    return dict(inputs=svc.series_inputs(pred), sims=sims, agg=agg, best_policy=best, sims_lt=lt,
                grids={"rolling_mean_7": svc.par_grid(pred, "rolling_mean_7"), "global_ml": svc.par_grid(pred, "global_ml")})

def persist(conn, run_id, pred, scores, derived, daily, ingest_stats=None) -> dict:
    ledger = eng.latest_ledger(daily)
    as_of = daily["Date"].max()
    rows = eng.build_rows(derived["inputs"], ledger, as_of, RECOMMENDED_POLICY, DEFAULT_LEAD_TIME)
    recs = eng.build_recommendations(rows, DEFAULT_LEAD_TIME)

    repo.write_forecasts(conn, run_id, pred)
    for key, grid in derived["grids"].items(): repo.write_par_levels(conn, run_id, grid, key)
    for pol, sim in derived["sims"].items(): repo.write_sim(conn, run_id, pol, DEFAULT_LEAD_TIME, sim)
    for L, sim in derived["sims_lt"].items():
        if L != DEFAULT_LEAD_TIME: repo.write_sim(conn, run_id, derived["best_policy"], L, sim)
    repo.supersede_pending(conn)
    repo.write_recommendations(conn, run_id, recs, RECOMMENDED_POLICY, DEFAULT_LEAD_TIME)
    repo.write_metrics(conn, run_id, monitoring.collect(conn, run_id, scores, pred, derived["agg"], recs, ingest_stats))
    return {"recommendations": len(recs), "best_policy": derived["best_policy"]}
