"""ML service layer: HTTP wrappers over the verified Tier 2-4 code (see app/ml/service.py). Nothing is reimplemented."""
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from .. import repo
from ..config import NUANCE
from ..db import current_run_id, get_conn
from ..ml import service as svc
from ..naming import MODEL_KEYS, POLICY_DEFS
from .deps import heavy, records, require_key

router = APIRouter(prefix="/ml", tags=["ml"])

class ForecastReq(BaseModel):
    models: list[Literal["seasonal_naive", "rolling_mean_7", "rolling_mean_14", "global_ml", "holt_winters"]] = ["global_ml", "rolling_mean_7"]
    bar: Optional[str] = None
    brand: Optional[str] = None

@router.post("/forecast", dependencies=[Depends(require_key)])
def forecast(req: ForecastReq, conn=Depends(get_conn)):
    """Re-runs the Tier 2 backtest on current daily_demand (NOT persisted; the daily job persists). Holt-Winters is slow."""
    with heavy:
        pred, split = svc.run_forecast(repo.load_daily(conn), req.models)
        scores = svc.score_models(pred)
        if req.bar: pred = pred[pred["Bar Name"] == req.bar]
        if req.brand: pred = pred[pred["Brand Name"] == req.brand]
    if pred.empty: raise HTTPException(404, "no matching series")
    return {"split_date": str(split)[:10], "metrics_all_series": records(scores), "note": NUANCE, "predictions": records(pred)}

class ParReq(BaseModel):
    service_level: Literal["90%", "95%", "99%"] = "95%"
    lead_time_days: int = Field(2, ge=1, le=30)
    avg_forecast_demand_per_day: Optional[float] = Field(None, ge=0)
    forecast_rmse: Optional[float] = Field(None, ge=0)
    bar: Optional[str] = None
    brand: Optional[str] = None
    model: Literal["rolling_mean_7", "global_ml", "holt_winters", "seasonal_naive"] = "global_ml"

@router.post("/par-level")
def par_level(req: ParReq, conn=Depends(get_conn)):
    """Scalar mode (give demand + RMSE) or series mode (give bar+brand; inputs come from the latest run). Tier 3 formulas."""
    if req.avg_forecast_demand_per_day is None:
        if not (req.bar and req.brand): raise HTTPException(422, "provide avg_forecast_demand_per_day+forecast_rmse, or bar+brand")
        run = current_run_id(conn)
        inp = svc.series_inputs(repo.load_forecasts_wide(conn, run))
        row = inp[(inp["Bar Name"] == req.bar) & (inp["Brand Name"] == req.brand)]
        if row.empty: raise HTTPException(404, "unknown series")
        avg, rmse = float(row[f"pred_{req.model}_mean"].iloc[0]), float(row[f"pred_{req.model}_rmse"].iloc[0])
    else:
        if req.forecast_rmse is None: raise HTTPException(422, "forecast_rmse required")
        avg, rmse = req.avg_forecast_demand_per_day, req.forecast_rmse
    return {"inputs": {"avg_forecast_demand_per_day_ml": avg, "forecast_rmse_ml": rmse, "lead_time_days": req.lead_time_days,
                       "service_level": req.service_level}, **svc.par_level_scalar(avg, rmse, req.lead_time_days, req.service_level)}

class SimReq(BaseModel):
    policy: Literal[tuple(POLICY_DEFS)] = "Global ML (99% SL)"   # type: ignore[valid-type]
    lead_time_days: int = Field(2, ge=1, le=30)
    bar: Optional[str] = None
    brand: Optional[str] = None
    # raw mode: simulate an arbitrary demand vector with explicit parameters
    actual_demand: Optional[list[float]] = None
    reorder_point: Optional[float] = None
    par_level: Optional[float] = None
    fixed_order_qty: Optional[float] = None

@router.post("/simulate", dependencies=[Depends(require_key)])
def simulate(req: SimReq, conn=Depends(get_conn)):
    if req.actual_demand is not None:
        if req.reorder_point is None or (req.par_level is None) == (req.fixed_order_qty is None):
            raise HTTPException(422, "raw mode needs reorder_point and exactly one of par_level / fixed_order_qty")
        return svc.simulate_raw(req.actual_demand, req.lead_time_days, req.reorder_point, req.par_level, req.fixed_order_qty)
    with heavy:
        pred = repo.load_forecasts_wide(conn, current_run_id(conn))
        sim = svc.simulate_policies(pred, [req.policy], req.lead_time_days)[req.policy]
    agg = svc.aggregate(sim, req.policy)
    if req.bar and req.brand: sim = sim[(sim["Bar Name"] == req.bar) & (sim["Brand Name"] == req.brand)]
    return {"policy": req.policy, "lead_time_days": req.lead_time_days, "aggregate": agg, "per_series": records(sim), "note": NUANCE}

@router.get("/model-metrics")
def model_metrics(conn=Depends(get_conn)):
    run = current_run_id(conn)
    rows = conn.execute(text("""SELECT metric_name, model_key, scope, scope_value, value, details, recorded_at
        FROM model_metrics WHERE run_id=:r ORDER BY metric_name, model_key, scope, scope_value"""), {"r": run}).mappings().all()
    return {"run_id": run, "note": NUANCE, "metrics": [dict(r) | {"recorded_at": r["recorded_at"].isoformat()} for r in rows]}
