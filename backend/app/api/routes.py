from datetime import date, timedelta
from typing import Literal, Optional
import threading
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import text
from .. import exports, recommendation_engine as eng, repo
from ..config import DEFAULT_LEAD_TIME, NUANCE, OVERSTOCK_MULTIPLE, RECOMMENDED_POLICY
from ..db import current_run_id, get_conn
from ..ml import service as svc
from ..naming import POLICY_DEFS
from .deps import records, require_key

router = APIRouter()

def _run(conn):
    r = current_run_id(conn)
    if r is None: raise HTTPException(503, "no successful run yet; seeding or the daily job has not completed")
    return r

_inputs_cache: dict[int, object] = {}
_lock = threading.Lock()

def series_inputs(conn, run):
    with _lock:
        if run not in _inputs_cache:
            _inputs_cache.clear()
            _inputs_cache[run] = svc.series_inputs(repo.load_forecasts_wide(conn, run))
        return _inputs_cache[run]

# ---------- health ----------
@router.get("/health", tags=["meta"])
def health(conn=Depends(get_conn)):
    conn.execute(text("SELECT 1"))
    return {"status": "ok", "current_run_id": current_run_id(conn)}

# ---------- reference data ----------
@router.get("/bars", tags=["reference"])
def bars(conn=Depends(get_conn)):
    return records(repo._names("SELECT b.id, b.name, p.name AS property FROM bars b JOIN properties p ON p.id=b.property_id ORDER BY b.name", conn))

@router.get("/bars/{bar_id}", tags=["reference"])
def bar(bar_id: int, conn=Depends(get_conn)):
    df = repo._names("""SELECT b.id, b.name, p.name AS property,
        (SELECT count(*) FROM series_profiles s WHERE s.bar_id=b.id) AS n_series,
        (SELECT coalesce(sum(consumed_ml),0) FROM daily_demand d WHERE d.bar_id=b.id) AS total_consumed_ml
        FROM bars b JOIN properties p ON p.id=b.property_id WHERE b.id=:i""", conn, i=bar_id)
    if df.empty: raise HTTPException(404, "bar not found")
    return records(df)[0]

@router.get("/brands", tags=["reference"])
def brands(conn=Depends(get_conn)):
    return records(repo._names("SELECT id, name, alcohol_type FROM brands ORDER BY name", conn))

@router.get("/suppliers", tags=["reference"])
def suppliers(conn=Depends(get_conn)):
    return records(repo._names("""SELECT s.id, s.name, s.is_assumed, l.lead_time_days, l.source AS lead_time_source
        FROM suppliers s LEFT JOIN lead_times l ON l.supplier_id=s.id AND l.brand_id IS NULL""", conn))

# ---------- inventory ----------
@router.get("/inventory", tags=["inventory"])
def inventory(policy: Literal[tuple(POLICY_DEFS)] = RECOMMENDED_POLICY, lead_time_days: int = Query(DEFAULT_LEAD_TIME, ge=1, le=30),  # type: ignore
              overstock_multiple: float = OVERSTOCK_MULTIPLE, bar_id: Optional[int] = None, status: Optional[str] = None,
              conn=Depends(get_conn)):
    """Per-series stock status vs par/reorder point under the chosen policy (default: the simulation winner)."""
    run = _run(conn)
    ledger = repo.load_ledger(conn)
    as_of = conn.execute(text("SELECT max(demand_date) FROM daily_demand")).scalar()
    rows = eng.build_rows(series_inputs(conn, run), ledger, as_of, policy, lead_time_days, overstock_multiple)
    if bar_id is not None:
        name = conn.execute(text("SELECT name FROM bars WHERE id=:i"), {"i": bar_id}).scalar()
        if name is None: raise HTTPException(404, "bar not found")
        rows = rows[rows["bar"] == name]
    if status: rows = rows[rows["status"] == status]
    rows = rows.assign(_o=rows["status"].map(eng.STATUS_ORDER)).sort_values(["_o", "forecast_per_day"], ascending=[True, False]).drop(columns="_o")
    return {"run_id": run, "as_of": str(as_of), "policy": policy, "lead_time_days": lead_time_days, "rows": records(rows)}

# ---------- forecasts ----------
@router.get("/forecasts/runs", tags=["forecasts"])
def runs(limit: int = 20, conn=Depends(get_conn)):
    return records(repo._names("""SELECT id, run_type, status, started_at, finished_at, data_max_date, split_date, n_series, notes
        FROM forecast_runs ORDER BY id DESC LIMIT :l""", conn, l=limit))

@router.get("/forecasts", tags=["forecasts"])
def forecasts(bar_id: int, brand_id: int, model_key: Optional[str] = None, run_id: Optional[int] = None, conn=Depends(get_conn)):
    run = run_id or _run(conn)
    q = """SELECT forecast_date, model_key, predicted_ml, actual_ml FROM forecasts
           WHERE run_id=:r AND bar_id=:b AND brand_id=:n""" + (" AND model_key=:m" if model_key else "") + " ORDER BY forecast_date, model_key"
    df = repo._names(q, conn, r=run, b=bar_id, n=brand_id, m=model_key)
    if df.empty: raise HTTPException(404, "no forecasts for that series/run")
    return {"run_id": run, "rows": records(df)}

@router.get("/par-levels", tags=["forecasts"])
def par_levels(bar_id: Optional[int] = None, model_key: Literal["rolling_mean_7", "global_ml"] = "global_ml",
               lead_time_days: Optional[int] = None, service_level: Optional[str] = None, conn=Depends(get_conn)):
    run = _run(conn); q = """SELECT bar_id, brand_id, model_key, lead_time_days, service_level, z_score, avg_forecast_demand_per_day_ml,
        forecast_rmse_ml, lead_time_demand_ml, safety_stock_ml, par_level_ml, reorder_point_ml FROM par_levels WHERE run_id=:r AND model_key=:m"""
    p = dict(r=run, m=model_key)
    for col, val in (("bar_id", bar_id), ("lead_time_days", lead_time_days), ("service_level", service_level)):
        if val is not None: q += f" AND {col}=:{col}"; p[col] = val
    return {"run_id": run, "rows": records(repo._names(q, conn, **p))}

# ---------- recommendations ----------
@router.get("/recommendations", tags=["recommendations"])
def recommendations(status: str = "pending", kind: Optional[str] = None, bar_id: Optional[int] = None, conn=Depends(get_conn)):
    q = """SELECT r.id, r.run_id, b.name AS bar, n.name AS brand, r.bar_id, r.brand_id, r.kind, r.severity, r.stock_status, r.policy,
        r.lead_time_days, r.on_hand_ml, r.reading_date, r.is_stale, r.forecast_per_day_ml, r.par_level_ml, r.reorder_point_ml,
        r.recommended_order_ml, r.excess_ml, r.days_cover, r.days_to_reorder, r.rationale, r.acceptance_status, r.decided_at
        FROM reorder_recommendations r JOIN bars b ON b.id=r.bar_id JOIN brands n ON n.id=r.brand_id WHERE r.acceptance_status=:s"""
    p = {"s": status}
    if kind: q += " AND r.kind=:k"; p["k"] = kind
    if bar_id: q += " AND r.bar_id=:b"; p["b"] = bar_id
    q += " ORDER BY CASE r.kind WHEN 'stockout' THEN 0 WHEN 'reorder' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END, r.recommended_order_ml DESC"
    return records(repo._names(q, conn, **p))

class Decision(BaseModel):
    decided_by: Optional[str] = None
    quantity_ml: Optional[float] = None

def _decide(conn, rec_id, status, body: Decision):
    with conn.begin():
        r = conn.execute(text("SELECT * FROM reorder_recommendations WHERE id=:i FOR UPDATE"), {"i": rec_id}).mappings().first()
        if not r: raise HTTPException(404, "recommendation not found")
        if r["acceptance_status"] != "pending": raise HTTPException(409, f"already {r['acceptance_status']}")
        conn.execute(text("UPDATE reorder_recommendations SET acceptance_status=:s, decided_at=now(), decided_by=:u WHERE id=:i"),
                     {"s": status, "u": body.decided_by, "i": rec_id})
        po = None
        qty = body.quantity_ml if body.quantity_ml is not None else r["recommended_order_ml"]
        if status == "accepted" and qty and qty > 0:
            sup = conn.execute(text("SELECT id FROM suppliers ORDER BY id LIMIT 1")).scalar()
            lt = conn.execute(text("SELECT lead_time_days FROM lead_times WHERE brand_id IS NULL ORDER BY id LIMIT 1")).scalar() or DEFAULT_LEAD_TIME
            po = conn.execute(text("""INSERT INTO purchase_orders(recommendation_id,supplier_id,bar_id,brand_id,quantity_ml,expected_delivery_date,notes)
                VALUES(:r,:s,:b,:n,:q,:d,'created from accepted recommendation') RETURNING id"""),
                {"r": rec_id, "s": sup, "b": r["bar_id"], "n": r["brand_id"], "q": qty, "d": date.today() + timedelta(days=lt)}).scalar()
    return {"id": rec_id, "acceptance_status": status, "purchase_order_id": po}

@router.post("/recommendations/{rec_id}/accept", tags=["recommendations"], dependencies=[Depends(require_key)])
def accept(rec_id: int, body: Decision = Decision(), conn=Depends(get_conn)): return _decide(conn, rec_id, "accepted", body)

@router.post("/recommendations/{rec_id}/reject", tags=["recommendations"], dependencies=[Depends(require_key)])
def reject(rec_id: int, body: Decision = Decision(), conn=Depends(get_conn)): return _decide(conn, rec_id, "rejected", body)

@router.get("/purchase-orders", tags=["recommendations"])
def purchase_orders(conn=Depends(get_conn)):
    return records(repo._names("""SELECT p.id, p.recommendation_id, s.name AS supplier, b.name AS bar, n.name AS brand, p.quantity_ml, p.status,
        p.expected_delivery_date, p.created_at FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id
        JOIN bars b ON b.id=p.bar_id JOIN brands n ON n.id=p.brand_id ORDER BY p.id DESC""", conn))

# ---------- analytics ----------
@router.get("/analytics/policy-comparison", tags=["analytics"])
def policy_comparison(conn=Depends(get_conn)):
    run = _run(conn)
    pol = exports.build(conn, "tier4_policy_comparison.csv"); mc = exports.build(conn, "tier2_model_comparison.csv")
    return {"run_id": run, "recommended_policy": RECOMMENDED_POLICY, "simulation_winner": pol.iloc[0]["policy"],
            "forecast_accuracy_winner": mc.iloc[0]["model"], "note": NUANCE,
            "policies": records(pol), "lead_time_sensitivity": records(exports.build(conn, "tier4_leadtime_sensitivity.csv"))}

@router.get("/analytics/model-comparison", tags=["analytics"])
def model_comparison(conn=Depends(get_conn)):
    _run(conn); return {"note": NUANCE, "models": records(exports.build(conn, "tier2_model_comparison.csv"))}

@router.get("/analytics/demand-trend", tags=["analytics"])
def demand_trend(bar_id: Optional[int] = None, brand_id: Optional[int] = None, conn=Depends(get_conn)):
    q = "SELECT demand_date AS date, sum(consumed_ml) AS consumed_ml FROM daily_demand WHERE TRUE"; p = {}
    if bar_id: q += " AND bar_id=:b"; p["b"] = bar_id
    if brand_id: q += " AND brand_id=:n"; p["n"] = brand_id
    return records(repo._names(q + " GROUP BY demand_date ORDER BY demand_date", conn, **p))

@router.get("/analytics/kpis", tags=["analytics"])
def kpis(conn=Depends(get_conn)):
    run = _run(conn)
    rows = eng.build_rows(series_inputs(conn, run), repo.load_ledger(conn),
                          conn.execute(text("SELECT max(demand_date) FROM daily_demand")).scalar(), RECOMMENDED_POLICY, DEFAULT_LEAD_TIME)
    return {"run_id": run, "status_counts": rows["status"].value_counts().to_dict(), "on_hand_ml": float(rows["on_hand"].sum()),
            "order_now_ml": float(rows["order_qty"].sum()), "stale_series": int(rows["stale"].sum()), "series": len(rows)}

@router.get("/analytics/metrics-history", tags=["analytics"])
def metrics_history(metric: str, model_key: Optional[str] = None, conn=Depends(get_conn)):
    q = "SELECT run_id, recorded_at, model_key, scope, scope_value, value, details FROM model_metrics WHERE metric_name=:m"
    p = {"m": metric}
    if model_key: q += " AND model_key=:k"; p["k"] = model_key
    return records(repo._names(q + " ORDER BY recorded_at, run_id", conn, **p))

# ---------- pipeline ----------
@router.post("/pipeline/run", tags=["pipeline"], dependencies=[Depends(require_key)], status_code=202)
def trigger(bg: BackgroundTasks):
    from ..pipeline import daily_job
    bg.add_task(lambda: daily_job.run("manual")); return {"accepted": True}

# ---------- CSV export (what the frontend's API mode reads) ----------
@router.get("/export/{filename}", tags=["export"])
def export_csv(filename: str, conn=Depends(get_conn)):
    """Serves the DB as the exact CSV schema the Next.js loader expects. See frontend/src/lib/data/api-source.ts."""
    if filename not in exports.FILES: raise HTTPException(404, f"unknown export; choose one of {exports.FILES}")
    try: body = exports.to_csv_text(conn, filename)
    except LookupError as e: raise HTTPException(503, str(e))
    return Response(body, media_type="text/csv", headers={"Cache-Control": "public, max-age=60"})
