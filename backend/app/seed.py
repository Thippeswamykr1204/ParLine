"""Seed migration: loads the verified Tier 0-4 outputs (data/raw + data/processed) into Postgres.
Predictions, ABC/series classes, per-series simulation results come straight from the CSVs; only what the
CSVs do not contain (Global-ML par grid, L=3/5 sensitivity sims, initial recommendations, bias metric) is derived,
using the same Tier 2-4 code paths the daily job uses."""
from __future__ import annotations
import logging
import pandas as pd
from sqlalchemy import text
from . import repo, legacy, transforms as T
from .config import PROJECT_ROOT
from .db import transaction
from .naming import PERSERIES_FILE, POLICY_DEFS
from .ml import service as svc
from .pipeline import stages

log = logging.getLogger("parline.seed")
P = PROJECT_ROOT / "data" / "processed"

def seed(force: bool = False) -> bool:
    with transaction() as conn:
        if conn.execute(text("SELECT count(*) FROM forecast_runs")).scalar() and not force:
            log.info("database already seeded; skipping"); return False
        if force:
            for t in ("purchase_orders", "reorder_recommendations", "model_metrics", "simulation_results", "par_levels",
                      "forecasts", "forecast_runs", "series_profiles", "daily_demand", "inventory_transactions"):
                conn.execute(text(f"DELETE FROM {t}"))
        raw = legacy.t0().load_raw(PROJECT_ROOT / "data" / "raw" / "bar_inventory_data.xlsx")
        daily = pd.read_csv(P / "daily_bar_consumption.csv", parse_dates=["Date"])
        brand_types = daily.drop_duplicates("Brand Name").set_index("Brand Name")["Alcohol Type"].to_dict()
        repo.ensure_dimensions(conn, daily["Bar Name"].unique(), brand_types)
        # supplier + lead time are ASSUMPTIONS (Data Contract: no supplier/lead-time data exists)
        conn.execute(text("INSERT INTO suppliers(name) VALUES('Default supplier (assumed)') ON CONFLICT DO NOTHING"))
        conn.execute(text("""INSERT INTO lead_times(supplier_id,brand_id,lead_time_days,source)
            SELECT id,NULL,2,'assumption: Tier 2-4 default' FROM suppliers WHERE name='Default supplier (assumed)' ON CONFLICT DO NOTHING"""))
        n = repo.insert_transactions(conn, raw, "seed")
        repo.replace_daily(conn, daily)
        abc, sc = pd.read_csv(P / "abc_classification.csv"), pd.read_csv(P / "series_classification.csv")
        repo.replace_profiles(conn, T.profiles_to_frame(sc, abc))

        run_id = repo.create_run(conn, "seed", "loaded from data/raw + data/processed")
        pred = pd.read_csv(P / "tier2_validation_predictions.csv", parse_dates=["Date"])
        sims = {}
        for pol, fname in PERSERIES_FILE.items():
            sims[pol] = pd.read_csv(P / fname)
        derived = stages.derive(pred, sims_l2=sims)
        scores = svc.score_models(pred)
        out = stages.persist(conn, run_id, pred, scores, derived, daily, {"new_transactions": n, "rejected_rows": 0})
        repo.finish_run(conn, run_id, "success", data_max_date=daily["Date"].max().date(),
                        split_date=pred["Date"].min().date(), n_series=len(sc),
                        models=list(POLICY_DEFS), validation_report={"seeded": True, "transactions": int(n)})
        log.info("seed complete: run=%s transactions=%s recs=%s", run_id, n, out["recommendations"])
    return True
