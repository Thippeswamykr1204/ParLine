"""Python port of frontend/src/lib/engine/{policy,inventory}.ts (status, order qty, recommendation kinds).
Kept pure so it can be unit tested. The par formulas themselves come from Tier 4 inputs (avg forecast + RMSE)."""
from __future__ import annotations
import math
import pandas as pd
from .config import LOW_MULTIPLE, OVERSTOCK_MULTIPLE, STALE_DAYS
from .naming import POLICY_DEFS

STATUS_ORDER = {"out": 0, "risk": 1, "low": 2, "healthy": 3, "over": 4}
ABC_WEIGHT = {"A": 3, "B": 2, "C": 1}
KIND_ORDER = {"stockout": 0, "reorder": 1, "watch": 2, "overstock": 3}

def classify(on_hand, par, rop, forecast, overstock_multiple=OVERSTOCK_MULTIPLE):
    if par <= 0 or forecast <= 0: return "over" if on_hand > 0 else "healthy"
    if on_hand <= 0: return "out"
    if on_hand < rop: return "risk"
    if on_hand < LOW_MULTIPLE * rop: return "low"
    if on_hand >= overstock_multiple * par: return "over"
    return "healthy"

def policy_params(policy: str, row, lead_time: int):
    """row: a tier4_series_model_inputs row (dict/Series). Same formulae as tier4 / policy.ts."""
    model_key, sl = POLICY_DEFS[policy]
    if model_key is None:
        rop = row["avg_actual_demand_per_day"] * lead_time; fixed = row["avg_actual_demand_per_day"] * 7
        return dict(forecast=row["avg_actual_demand_per_day"], rmse=0.0, ltd=rop, ss=0.0, par=rop + fixed, rop=rop, fixed=fixed)
    z = {"90%": 1.282, "95%": 1.645, "99%": 2.326}[sl]
    mean, rmse = row[f"pred_{model_key}_mean"], row[f"pred_{model_key}_rmse"]
    ltd = mean * lead_time; ss = z * rmse * math.sqrt(lead_time); par = ltd + ss
    return dict(forecast=mean, rmse=rmse, ltd=ltd, ss=ss, par=par, rop=par, fixed=None)

def latest_ledger(daily: pd.DataFrame) -> pd.DataFrame:
    """Last observed closing balance per series (same rule as sources.ts: latest observed day wins)."""
    obs = daily[daily["is_observed_day"] & daily["closing_balance_ml"].notna()]
    obs = obs.sort_values("Date").groupby(["Bar Name", "Brand Name"]).tail(1)
    return obs[["Bar Name", "Brand Name", "Date", "closing_balance_ml"]].rename(
        columns={"Date": "reading_date", "closing_balance_ml": "on_hand"})

def build_rows(inputs: pd.DataFrame, ledger: pd.DataFrame, as_of, policy: str, lead_time: int,
               overstock_multiple=OVERSTOCK_MULTIPLE) -> pd.DataFrame:
    led = ledger.set_index(["Bar Name", "Brand Name"])
    as_of = pd.Timestamp(as_of); out = []
    for _, r in inputs.iterrows():
        key = (r["Bar Name"], r["Brand Name"])
        on_hand, rd = (0.0, None)
        if key in led.index:
            on_hand = float(led.loc[key, "on_hand"]); rd = pd.Timestamp(led.loc[key, "reading_date"])
        age = (as_of - rd).days if rd is not None else None
        p = policy_params(policy, r, lead_time)
        status = classify(on_hand, p["par"], p["rop"], p["forecast"], overstock_multiple)
        order = 0.0
        if status in ("out", "risk"):
            order = p["fixed"] if p["fixed"] is not None else max(p["par"] - on_hand, 0.0)
        f = p["forecast"]
        out.append(dict(
            bar=key[0], brand=key[1], abc_class=r["abc_class"], series_class=r["series_class"],
            on_hand=on_hand, reading_date=rd, reading_age_days=age, stale=(age is None or age > STALE_DAYS),
            forecast_per_day=f, rmse=p["rmse"], lead_time_demand=p["ltd"], safety_stock=p["ss"], par=p["par"],
            reorder_point=p["rop"], days_cover=(on_hand / f if f > 0 else None),
            days_to_reorder=(max((on_hand - p["rop"]) / f, 0.0) if f > 0 else None),
            status=status, order_qty=order, excess_qty=max(on_hand - p["par"], 0.0)))
    return pd.DataFrame(out)

def _vol(ml): return f"{ml/1000:.1f} L" if ml >= 1000 else f"{ml:.0f} ml"

def build_recommendations(rows: pd.DataFrame, lead_time: int) -> pd.DataFrame:
    recs = []
    for _, r in rows.iterrows():
        stale = f" The last count is {r['reading_age_days']} days old, so confirm it before ordering." \
            if r["stale"] and r["reading_age_days"] is not None else ""
        where = f"{r['brand']} at {r['bar']}"
        if r["status"] == "out":
            kind, sev, vol = "stockout", "critical", r["order_qty"]
            why = f"{r['bar']} has none left; policy expects {_vol(r['forecast_per_day'])}/day. Order {_vol(vol)} of {where} now.{stale}"
        elif r["status"] == "risk":
            kind, sev, vol = "reorder", "high", r["order_qty"]
            why = (f"On hand {_vol(r['on_hand'])} is under the {_vol(r['reorder_point'])} reorder point "
                   f"against a {lead_time}-day delivery. Order {_vol(vol)} of {where} up to par.{stale}")
        elif r["status"] == "low":
            kind, sev, vol = "watch", "medium", 0.0
            why = f"{where} is within twice its {_vol(r['reorder_point'])} reorder point. Schedule the order with the next delivery.{stale}"
        elif r["status"] == "over":
            kind, sev, vol = "overstock", "opportunity", r["excess_qty"]
            why = (f"{where} has stock but no forecast demand; check the menu." if r["forecast_per_day"] <= 0 else
                   f"{_vol(r['on_hand'])} on hand is {r['on_hand']/r['par']:.1f}x the {_vol(r['par'])} par level. Pause reordering {where}.")
        else:
            continue
        recs.append({**r.to_dict(), "kind": kind, "severity": sev, "volume": vol, "rationale": why})
    df = pd.DataFrame(recs)
    if df.empty: return df
    df["_k"] = df["kind"].map(KIND_ORDER); df["_w"] = df["abc_class"].map(ABC_WEIGHT)
    df["_d"] = df["days_to_reorder"].fillna(float("inf"))
    df = df.sort_values(["_k", "_w", "forecast_per_day", "_d", "volume"], ascending=[True, False, False, True, False])
    return df.drop(columns=["_k", "_w", "_d"]).reset_index(drop=True)
