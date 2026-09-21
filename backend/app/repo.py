"""All SQL lives here. Functions take an SQLAlchemy Connection; callers own the transaction."""
from __future__ import annotations
import json
import numpy as np, pandas as pd
from sqlalchemy import text
from . import transforms as T
from .naming import PAR_DB_TO_CSV, SIM_COLS, PROFILE_CSV_COLS

def _to_sql(conn, df, table):
    df = df.replace({np.nan: None}) if len(df) else df
    df.to_sql(table, conn, if_exists="append", index=False, method="multi", chunksize=2000)

# ---------------- dimensions ----------------
def ensure_property(conn, name="Hotel (assumed)"):
    conn.execute(text("INSERT INTO properties(name,is_assumed) VALUES(:n,TRUE) ON CONFLICT(name) DO NOTHING"), {"n": name})
    return conn.execute(text("SELECT id FROM properties WHERE name=:n"), {"n": name}).scalar()

def ensure_dimensions(conn, bars, brand_types: dict, property_name="Hotel (assumed)"):
    pid = ensure_property(conn, property_name)
    for b in bars:
        conn.execute(text("INSERT INTO bars(property_id,name) VALUES(:p,:n) ON CONFLICT DO NOTHING"), {"p": pid, "n": b})
    for b, t in brand_types.items():
        conn.execute(text("INSERT INTO brands(name,alcohol_type) VALUES(:n,:t) ON CONFLICT(name) DO NOTHING"), {"n": b, "t": t})
    return bar_map(conn), brand_map(conn)

def bar_map(conn): return dict(conn.execute(text("SELECT name,id FROM bars")).all())
def brand_map(conn): return dict(conn.execute(text("SELECT name,id FROM brands")).all())
def alcohol_map(conn): return pd.Series(dict(conn.execute(text("SELECT name,alcohol_type FROM brands")).all()))

def _ids(df, conn):
    b, r = bar_map(conn), brand_map(conn)
    out = df.copy(); out["bar_id"] = out["Bar Name"].map(b); out["brand_id"] = out["Brand Name"].map(r)
    if out[["bar_id", "brand_id"]].isna().any().any(): raise ValueError("unknown bar/brand in frame")
    return out.drop(columns=["Bar Name", "Brand Name"])

def _names(sql, conn, **params):
    return pd.read_sql(text(sql), conn, params=params)

# ---------------- runs ----------------
def create_run(conn, run_type, notes=None):
    return conn.execute(text("INSERT INTO forecast_runs(run_type,notes) VALUES(:t,:n) RETURNING id"),
                        {"t": run_type, "n": notes}).scalar()

def finish_run(conn, run_id, status, **fields):
    sets = ["status=:status", "finished_at=now()"] + [f"{k}=:{k}" for k in fields]
    params = {"status": status, "id": run_id}
    for k, v in fields.items(): params[k] = json.dumps(v, default=str) if isinstance(v, (dict, list)) else v
    conn.execute(text(f"UPDATE forecast_runs SET {', '.join(sets)} WHERE id=:id"), params)

def prune_runs(conn, keep):
    conn.execute(text("""DELETE FROM forecast_runs WHERE run_type <> 'seed' AND id NOT IN
        (SELECT id FROM forecast_runs WHERE status='success' ORDER BY id DESC LIMIT :k) AND status <> 'running'
        AND started_at < now() - interval '1 day'"""), {"k": keep})
    # model_metrics cascade with the run; keep history by copying is out of scope: KEEP_RUNS bounds it.

# ---------------- transactions / daily ----------------
RAW_TO_DB = {"Opening Balance (ml)": "opening_ml", "Purchase (ml)": "purchase_ml",
             "Consumed (ml)": "consumed_ml", "Closing Balance (ml)": "closing_ml"}

def insert_transactions(conn, raw: pd.DataFrame, source: str) -> int:
    """Idempotent: exact duplicates (same bar/brand/time/balances) are skipped. Returns rows actually inserted."""
    d = _ids(raw, conn).rename(columns=RAW_TO_DB)
    d["served_at"] = pd.to_datetime(d["Date Time Served"]).dt.to_pydatetime(); d["source"] = source
    d = d[["bar_id", "brand_id", "served_at", "opening_ml", "purchase_ml", "consumed_ml", "closing_ml", "source"]]
    before = conn.execute(text("SELECT count(*) FROM inventory_transactions")).scalar()
    conn.execute(text("""INSERT INTO inventory_transactions(bar_id,brand_id,served_at,opening_ml,purchase_ml,consumed_ml,closing_ml,source)
        VALUES(:bar_id,:brand_id,:served_at,:opening_ml,:purchase_ml,:consumed_ml,:closing_ml,:source) ON CONFLICT DO NOTHING"""),
        d.to_dict("records"))
    return conn.execute(text("SELECT count(*) FROM inventory_transactions")).scalar() - before

def load_raw_transactions(conn) -> pd.DataFrame:
    """Rebuild the raw-log schema tier0 expects, from the transactions table."""
    df = _names("""SELECT t.served_at AS "Date Time Served", b.name AS "Bar Name", r.alcohol_type AS "Alcohol Type",
        r.name AS "Brand Name", t.opening_ml AS "Opening Balance (ml)", t.purchase_ml AS "Purchase (ml)",
        t.consumed_ml AS "Consumed (ml)", t.closing_ml AS "Closing Balance (ml)"
        FROM inventory_transactions t JOIN bars b ON b.id=t.bar_id JOIN brands r ON r.id=t.brand_id
        ORDER BY t.served_at, t.id""", conn)
    df["Date Time Served"] = pd.to_datetime(df["Date Time Served"])
    df["Date"] = df["Date Time Served"].dt.floor("D")
    return df

def replace_daily(conn, daily: pd.DataFrame):
    conn.execute(text("DELETE FROM daily_demand"))
    _to_sql(conn, _ids(T.daily_to_db(daily), conn), "daily_demand")

def load_daily(conn) -> pd.DataFrame:
    d = _names("""SELECT b.name AS "Bar Name", r.name AS "Brand Name", d.* FROM daily_demand d
        JOIN bars b ON b.id=d.bar_id JOIN brands r ON r.id=d.brand_id""", conn)
    return T.daily_from_db(d, alcohol_map(conn))

# ---------------- profiles ----------------
def replace_profiles(conn, frame: pd.DataFrame):
    conn.execute(text("DELETE FROM series_profiles"))
    cols = ["Bar Name", "Brand Name", "abc_class", "series_class", "consumed_ml", "pct_of_total", "cum_pct"] + PROFILE_CSV_COLS
    _to_sql(conn, _ids(frame[cols], conn), "series_profiles")

def load_profiles(conn) -> pd.DataFrame:
    return _names("""SELECT b.name AS "Bar Name", r.name AS "Brand Name", p.* FROM series_profiles p
        JOIN bars b ON b.id=p.bar_id JOIN brands r ON r.id=p.brand_id""", conn).drop(columns=["bar_id", "brand_id", "updated_at"])

# ---------------- forecasts / par / sim ----------------
def write_forecasts(conn, run_id, pred_wide):
    d = _ids(T.wide_to_long_forecasts(pred_wide), conn); d["run_id"] = run_id
    _to_sql(conn, d, "forecasts")

def load_forecasts_wide(conn, run_id) -> pd.DataFrame:
    long = _names("""SELECT b.name AS "Bar Name", r.name AS "Brand Name", f.forecast_date, f.model_key, f.predicted_ml, f.actual_ml
        FROM forecasts f JOIN bars b ON b.id=f.bar_id JOIN brands r ON r.id=f.brand_id WHERE f.run_id=:r""", conn, r=run_id)
    return T.long_to_wide_forecasts(long, alcohol_map(conn), load_profiles(conn))

def write_par_levels(conn, run_id, grid: pd.DataFrame, model_key: str):
    d = grid.rename(columns={"z_score": "z_score"}).copy()
    d = _ids(d.drop(columns=["abc_class", "series_class"], errors="ignore"), conn)
    d["run_id"] = run_id; d["model_key"] = model_key
    _to_sql(conn, d, "par_levels")

def load_par_levels(conn, run_id, model_key) -> pd.DataFrame:
    return _names("""SELECT b.name AS "Bar Name", r.name AS "Brand Name", p.lead_time_days, p.service_level, p.z_score,
        p.avg_forecast_demand_per_day_ml, p.forecast_rmse_ml, p.lead_time_demand_ml, p.safety_stock_ml, p.par_level_ml, p.reorder_point_ml
        FROM par_levels p JOIN bars b ON b.id=p.bar_id JOIN brands r ON r.id=p.brand_id
        WHERE p.run_id=:r AND p.model_key=:m""", conn, r=run_id, m=model_key)

def write_sim(conn, run_id, policy: str, lead_time: int, sim: pd.DataFrame):
    d = _ids(sim[SIM_COLS + ["Bar Name", "Brand Name"]], conn)
    d["run_id"] = run_id; d["policy"] = policy; d["lead_time_days"] = lead_time
    _to_sql(conn, d, "simulation_results")

def load_sim(conn, run_id) -> pd.DataFrame:
    df = _names("""SELECT s.policy, s.lead_time_days, b.name AS "Bar Name", r.name AS "Brand Name", s.stockout_days,
        s.stockout_rate_pct, s.lost_volume_ml, s.avg_holding_ml, s.turnover_ratio, s.n_orders_placed, s.n_days_simulated
        FROM simulation_results s JOIN bars b ON b.id=s.bar_id JOIN brands r ON r.id=s.brand_id WHERE s.run_id=:r""", conn, r=run_id)
    return df

# ---------------- recommendations ----------------
def supersede_pending(conn):
    conn.execute(text("UPDATE reorder_recommendations SET acceptance_status='superseded' WHERE acceptance_status='pending'"))

def write_recommendations(conn, run_id, recs: pd.DataFrame, policy: str, lead_time: int):
    if recs.empty: return
    d = pd.DataFrame({
        "Bar Name": recs["bar"], "Brand Name": recs["brand"], "kind": recs["kind"], "severity": recs["severity"],
        "stock_status": recs["status"], "on_hand_ml": recs["on_hand"],
        "reading_date": pd.to_datetime(recs["reading_date"]).dt.date, "reading_age_days": recs["reading_age_days"],
        "is_stale": recs["stale"].astype(bool), "forecast_per_day_ml": recs["forecast_per_day"], "par_level_ml": recs["par"],
        "reorder_point_ml": recs["reorder_point"], "recommended_order_ml": recs["order_qty"], "excess_ml": recs["excess_qty"],
        "days_cover": recs["days_cover"], "days_to_reorder": recs["days_to_reorder"], "rationale": recs["rationale"]})
    d["reading_age_days"] = d["reading_age_days"].astype("Int64").astype(object)
    d = _ids(d, conn); d["run_id"] = run_id; d["policy"] = policy; d["lead_time_days"] = lead_time
    _to_sql(conn, d, "reorder_recommendations")

# ---------------- metrics ----------------
def write_metrics(conn, run_id, rows: list[dict]):
    if not rows: return
    for r in rows:
        r.setdefault("scope", "overall"); r.setdefault("scope_value", None); r.setdefault("model_key", None)
        r["details"] = json.dumps(r["details"]) if r.get("details") is not None else None
        r["run_id"] = run_id; r.setdefault("value", None)
    conn.execute(text("""INSERT INTO model_metrics(run_id,metric_name,model_key,scope,scope_value,value,details)
        VALUES(:run_id,:metric_name,:model_key,:scope,:scope_value,:value,CAST(:details AS jsonb))"""), rows)

def latest_metric(conn, name, model_key, before_run_id):
    return conn.execute(text("""SELECT value FROM model_metrics WHERE metric_name=:n AND model_key IS NOT DISTINCT FROM :m
        AND scope='overall' AND run_id<:r ORDER BY run_id DESC LIMIT 1"""), {"n": name, "m": model_key, "r": before_run_id}).scalar()

def load_ledger(conn) -> pd.DataFrame:
    """Latest observed closing balance per series (SQL twin of recommendation_engine.latest_ledger)."""
    df = _names("""SELECT DISTINCT ON (d.bar_id,d.brand_id) b.name AS "Bar Name", r.name AS "Brand Name",
        d.demand_date AS reading_date, d.closing_balance_ml AS on_hand
        FROM daily_demand d JOIN bars b ON b.id=d.bar_id JOIN brands r ON r.id=d.brand_id
        WHERE d.is_observed_day AND d.closing_balance_ml IS NOT NULL
        ORDER BY d.bar_id,d.brand_id,d.demand_date DESC""", conn)
    df["reading_date"] = pd.to_datetime(df["reading_date"]); return df
