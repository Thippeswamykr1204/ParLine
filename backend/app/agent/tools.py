"""Tier 7 agent tools.

Hard rule: every function here is READ-ONLY and calls the exact same code path
the existing `/api/v1/...` routes call (repo / app.ml.service / recommendation_engine).
Nothing here re-derives a forecast, par level, safety stock or recommendation.
If a number does not already exist in the DB / verified Tier 2-4 outputs, the
tool returns {"found": False, "reason": ...} instead of estimating one.

Each tool takes the same request-scoped `conn` the FastAPI routes use
(Depends(get_conn) in routes.py / ml_routes.py) so it is a thin wrapper around
the identical query/service call the corresponding endpoint makes -- not a
second implementation of it.
"""
from __future__ import annotations
from typing import Optional
from sqlalchemy import text
from .. import repo, recommendation_engine as eng, exports
from ..config import DEFAULT_LEAD_TIME, RECOMMENDED_POLICY, NUANCE
from ..db import current_run_id
from ..ml import service as svc
from ..naming import POLICY_DEFS


def _bar_id(conn, name: str) -> Optional[int]:
    return conn.execute(text("SELECT id FROM bars WHERE name=:n"), {"n": name}).scalar()

def _brand_id(conn, name: str) -> Optional[int]:
    return conn.execute(text("SELECT id FROM brands WHERE name=:n"), {"n": name}).scalar()

def _rows(conn, run, policy, lead_time_days):
    """Identical call chain to GET /api/v1/inventory (routes.inventory)."""
    ledger = repo.load_ledger(conn)
    as_of = conn.execute(text("SELECT max(demand_date) FROM daily_demand")).scalar()
    series_in = svc.series_inputs(repo.load_forecasts_wide(conn, run))
    return eng.build_rows(series_in, ledger, as_of, policy, lead_time_days), as_of


# ---- tools exposed to the agent ----

def get_inventory(conn, bar: str, brand: str) -> dict:
    """Same query as GET /api/v1/inventory, filtered to one bar/brand: on-hand, status, policy, forecast/day."""
    run = current_run_id(conn)
    if run is None:
        return {"found": False, "reason": "no completed pipeline run yet"}
    rows, as_of = _rows(conn, run, RECOMMENDED_POLICY, DEFAULT_LEAD_TIME)
    row = rows[(rows["bar"] == bar) & (rows["brand"] == brand)]
    if row.empty:
        return {"found": False, "reason": f"no series for bar={bar!r} brand={brand!r}"}
    r = row.iloc[0]
    return {"found": True, "as_of": str(as_of), "policy": RECOMMENDED_POLICY,
            "on_hand_ml": float(r["on_hand"]), "status": r["status"],
            "forecast_per_day_ml": float(r["forecast_per_day"]), "stale": bool(r["stale"])}


def get_forecast(conn, bar: str, brand: str, model_key: str = "global_ml") -> dict:
    """Same query as GET /api/v1/forecasts: validation-window predicted vs actual for the series, plus WAPE."""
    run = current_run_id(conn)
    if run is None:
        return {"found": False, "reason": "no completed pipeline run yet"}
    b, n = _bar_id(conn, bar), _brand_id(conn, brand)
    if b is None or n is None:
        return {"found": False, "reason": f"unknown bar or brand: {bar!r}/{brand!r}"}
    df = repo._names("""SELECT forecast_date, model_key, predicted_ml, actual_ml FROM forecasts
                         WHERE run_id=:r AND bar_id=:b AND brand_id=:n AND model_key=:m
                         ORDER BY forecast_date""", conn, r=run, b=b, n=n, m=model_key)
    if df.empty:
        return {"found": False, "reason": f"no forecast rows for model_key={model_key!r}"}
    actual_sum = df["actual_ml"].abs().sum()
    wape = float((df["predicted_ml"] - df["actual_ml"]).abs().sum() / actual_sum) if actual_sum else None
    return {"found": True, "model_key": model_key, "n_days": len(df), "wape": wape,
            "last_10_days": df.tail(10).astype(str).to_dict("records"), "note": NUANCE}


def get_par_level(conn, bar: str, brand: str, service_level: str = "99%", model_key: str = "global_ml") -> dict:
    """Same query as GET /api/v1/par-levels: the already-computed par level, safety stock, reorder point."""
    run = current_run_id(conn)
    if run is None:
        return {"found": False, "reason": "no completed pipeline run yet"}
    b, n = _bar_id(conn, bar), _brand_id(conn, brand)
    if b is None or n is None:
        return {"found": False, "reason": f"unknown bar or brand: {bar!r}/{brand!r}"}
    df = repo._names("""SELECT lead_time_days, service_level, z_score, avg_forecast_demand_per_day_ml,
                         forecast_rmse_ml, lead_time_demand_ml, safety_stock_ml, par_level_ml, reorder_point_ml
                         FROM par_levels WHERE run_id=:r AND bar_id=:b AND brand_id=:n
                         AND model_key=:m AND service_level=:sl""",
                      conn, r=run, b=b, n=n, m=model_key, sl=service_level)
    if df.empty:
        return {"found": False, "reason": f"no stored par level for model_key={model_key!r} service_level={service_level!r}"}
    return {"found": True, **df.iloc[0].to_dict()}


def get_stockout_risk(conn, bar: str, brand: str) -> dict:
    """Combines the same rows GET /api/v1/inventory and GET /api/v1/recommendations use, for one series."""
    run = current_run_id(conn)
    if run is None:
        return {"found": False, "reason": "no completed pipeline run yet"}
    rows, as_of = _rows(conn, run, RECOMMENDED_POLICY, DEFAULT_LEAD_TIME)
    row = rows[(rows["bar"] == bar) & (rows["brand"] == brand)]
    if row.empty:
        return {"found": False, "reason": f"no series for bar={bar!r} brand={brand!r}"}
    r = row.iloc[0]
    recs = repo._names("""SELECT r.kind, r.severity, r.rationale, r.days_cover, r.days_to_reorder,
                           r.recommended_order_ml FROM reorder_recommendations r
                           JOIN bars b ON b.id=r.bar_id JOIN brands n ON n.id=r.brand_id
                           WHERE b.name=:bar AND n.name=:brand AND r.acceptance_status='pending'
                           ORDER BY r.id DESC LIMIT 1""", conn, bar=bar, brand=brand)
    return {"found": True, "as_of": str(as_of), "status": r["status"],
            "on_hand_ml": float(r["on_hand"]), "forecast_per_day_ml": float(r["forecast_per_day"]),
            "days_cover": (float(r["on_hand"] / r["forecast_per_day"]) if r["forecast_per_day"] else None),
            "open_recommendation": (recs.iloc[0].to_dict() if not recs.empty else None)}


def get_recommendations(conn, bar: str) -> dict:
    """Same query as GET /api/v1/recommendations?bar_id=...: pending stockout/reorder/watch items for a bar."""
    b = _bar_id(conn, bar)
    if b is None:
        return {"found": False, "reason": f"unknown bar {bar!r}"}
    df = repo._names("""SELECT n.name AS brand, r.kind, r.severity, r.recommended_order_ml, r.days_cover,
                         r.days_to_reorder, r.rationale FROM reorder_recommendations r
                         JOIN brands n ON n.id=r.brand_id WHERE r.bar_id=:b AND r.acceptance_status='pending'
                         ORDER BY CASE r.kind WHEN 'stockout' THEN 0 WHEN 'reorder' THEN 1 ELSE 2 END""", conn, b=b)
    return {"found": True, "bar": bar, "count": len(df), "recommendations": df.to_dict("records")}


def simulate_policy(conn, policy: str = RECOMMENDED_POLICY, lead_time_days: int = DEFAULT_LEAD_TIME,
                     service_level: Optional[str] = None) -> dict:
    """Same query as GET /api/v1/analytics/policy-comparison: verified Tier 4 backtest KPIs. Does NOT run a new simulation."""
    if policy not in POLICY_DEFS:
        return {"found": False, "reason": f"unknown policy {policy!r}; choices: {list(POLICY_DEFS)}"}
    run = current_run_id(conn)
    if run is None:
        return {"found": False, "reason": "no completed pipeline run yet"}
    pol = exports.build(conn, "tier4_policy_comparison.csv")
    row = pol[pol["policy"] == policy]
    if row.empty:
        return {"found": False, "reason": f"no stored backtest for policy {policy!r}"}
    return {"found": True, "policy": policy, "simulation_winner": pol.iloc[0]["policy"],
            "note": NUANCE, **row.iloc[0].to_dict()}


TOOL_SPECS = [
    {"name": "get_inventory", "description": get_inventory.__doc__,
     "input_schema": {"type": "object", "properties": {"bar": {"type": "string"}, "brand": {"type": "string"}},
                       "required": ["bar", "brand"]}},
    {"name": "get_forecast", "description": get_forecast.__doc__,
     "input_schema": {"type": "object", "properties": {
         "bar": {"type": "string"}, "brand": {"type": "string"},
         "model_key": {"type": "string", "enum": ["seasonal_naive", "rolling_mean_7", "rolling_mean_14", "global_ml", "holt_winters"]}},
         "required": ["bar", "brand"]}},
    {"name": "get_par_level", "description": get_par_level.__doc__,
     "input_schema": {"type": "object", "properties": {
         "bar": {"type": "string"}, "brand": {"type": "string"},
         "service_level": {"type": "string", "enum": ["90%", "95%", "99%"]},
         "model_key": {"type": "string", "enum": ["rolling_mean_7", "global_ml", "holt_winters", "seasonal_naive"]}},
         "required": ["bar", "brand"]}},
    {"name": "get_stockout_risk", "description": get_stockout_risk.__doc__,
     "input_schema": {"type": "object", "properties": {"bar": {"type": "string"}, "brand": {"type": "string"}},
                       "required": ["bar", "brand"]}},
    {"name": "get_recommendations", "description": get_recommendations.__doc__,
     "input_schema": {"type": "object", "properties": {"bar": {"type": "string"}}, "required": ["bar"]}},
    {"name": "simulate_policy", "description": simulate_policy.__doc__,
     "input_schema": {"type": "object", "properties": {
         "policy": {"type": "string", "enum": list(POLICY_DEFS)},
         "lead_time_days": {"type": "integer"},
         "service_level": {"type": "string", "enum": ["90%", "95%", "99%"]}},
         "required": []}},
]

DISPATCH = {
    "get_inventory": get_inventory, "get_forecast": get_forecast, "get_par_level": get_par_level,
    "get_stockout_risk": get_stockout_risk, "get_recommendations": get_recommendations,
    "simulate_policy": simulate_policy,
}

def call_tool(conn, name: str, args: dict) -> dict:
    fn = DISPATCH.get(name)
    if fn is None:
        return {"found": False, "reason": f"no such tool {name!r}"}
    try:
        return fn(conn, **args)
    except TypeError as e:
        return {"found": False, "reason": f"bad arguments for {name}: {e}"}
