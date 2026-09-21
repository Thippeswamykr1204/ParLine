"""Offline checks (no Postgres, no HTTP): run from the project root:  python -m pytest backend/tests -q
They prove the parts that carry the parity guarantee:
  1. CSV -> normalized tables -> CSV round trips losslessly (so API-mode CSV exports == static CSVs)
  2. the Tier 2-4 code called through app/ml/service.py reproduces the verified outputs
  3. the Python recommendation engine matches the TS engine's rules
  4. calling Tier 1 helpers through legacy.redirected never touches data/processed
Holt-Winters needs statsmodels; if it is not installed the HW-dependent checks are skipped."""
import hashlib, os, sys, types
from pathlib import Path
import numpy as np, pandas as pd, pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("PROJECT_ROOT", str(ROOT))
P = ROOT / "data" / "processed"

try:
    import statsmodels  # noqa
    HAVE_SM = True
except ImportError:
    HAVE_SM = False
    for name in ("statsmodels", "statsmodels.tsa", "statsmodels.tsa.holtwinters"):
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["statsmodels.tsa.holtwinters"].ExponentialSmoothing = object  # import stub only

from app import transforms as T, recommendation_engine as eng, legacy  # noqa: E402
from app.ml import service as svc  # noqa: E402
from app.naming import PERSERIES_FILE, POLICY_DEFS, PRED_COL  # noqa: E402

def csv(name, **kw): return pd.read_csv(P / name, **kw)

def test_daily_roundtrip():
    d = csv("daily_bar_consumption.csv", parse_dates=["Date"])
    alc = d.drop_duplicates("Brand Name").set_index("Brand Name")["Alcohol Type"]
    back = T.daily_from_db(T.daily_to_db(d), alc)
    assert back.to_csv(index=False) == d.to_csv(index=False)

def test_forecast_roundtrip_and_inputs():
    pred = csv("tier2_validation_predictions.csv", parse_dates=["Date"])
    alc = pred.drop_duplicates("Brand Name").set_index("Brand Name")["Alcohol Type"]
    prof = T.profiles_to_frame(csv("series_classification.csv"), csv("abc_classification.csv"))
    back = T.long_to_wide_forecasts(T.wide_to_long_forecasts(pred), alc, prof)
    a = pred.sort_values(["Bar Name", "Brand Name", "Date"]).reset_index(drop=True)
    assert list(back.columns) == list(a.columns)
    assert back.astype(str).equals(a.astype(str)) or np.allclose(back.filter(like="pred_").values, a.filter(like="pred_").values)
    ref = csv("tier4_series_model_inputs.csv")
    got = svc.series_inputs(back)
    pd.testing.assert_frame_equal(got.reset_index(drop=True), ref, check_exact=False, rtol=1e-9)

def test_par_grid_matches_tier3_csv():
    pred = csv("tier2_validation_predictions.csv", parse_dates=["Date"])
    got = svc.par_grid(pred, "rolling_mean_7").sort_values(["Bar Name", "Brand Name", "lead_time_days", "z_score"]).reset_index(drop=True)
    ref = csv("tier3_par_level_full_grid.csv").sort_values(["Bar Name", "Brand Name", "lead_time_days", "z_score"]).reset_index(drop=True)
    pd.testing.assert_frame_equal(got, ref, check_exact=False, rtol=1e-9)

@pytest.mark.parametrize("policy", list(POLICY_DEFS))
def test_simulation_matches_tier4(policy):
    pred = csv("tier2_validation_predictions.csv", parse_dates=["Date"])
    got = svc.simulate_policies(pred, [policy], 2)[policy].sort_values(["Bar Name", "Brand Name"]).reset_index(drop=True)
    ref = csv(PERSERIES_FILE[policy]).sort_values(["Bar Name", "Brand Name"]).reset_index(drop=True)
    pd.testing.assert_frame_equal(got[ref.columns], ref, check_exact=False, rtol=1e-9)

def test_headline_numbers():
    pred = csv("tier2_validation_predictions.csv", parse_dates=["Date"])
    sims = svc.simulate_policies(pred, ["Global ML (99% SL)", "Naive (fixed qty)"], 2)
    g, n = svc.aggregate(sims["Global ML (99% SL)"], "g"), svc.aggregate(sims["Naive (fixed qty)"], "n")
    assert g["total_stockout_days"] == 263 and n["total_stockout_days"] == 584
    assert round(g["total_lost_volume_ml"]) == 49380

def test_forecast_winner_is_not_simulation_winner():
    m = csv("tier2_model_comparison.csv")
    assert m.sort_values("WAPE").iloc[0]["model"] == "Rolling Mean (7d)"
    assert round(m.sort_values("WAPE").iloc[0]["WAPE"], 3) == 1.663
    pol = csv("tier4_policy_comparison.csv").sort_values("stockout_rate_pct")
    assert pol.iloc[0]["policy"] == "Global ML (99% SL)"

def test_scores_match_tier2_csv():
    pred = csv("tier2_validation_predictions.csv", parse_dates=["Date"])
    s = svc.score_models(pred).set_index("model_key")
    ref = csv("tier2_model_comparison.csv").set_index("model")
    from app.naming import MODEL_DISPLAY
    for k in s.index:
        assert s.loc[k, "WAPE"] == pytest.approx(ref.loc[MODEL_DISPLAY[k], "WAPE"], rel=1e-9)

def test_global_ml_and_baselines_reproduce_tier2():
    daily = csv("daily_bar_consumption.csv", parse_dates=["Date"])
    merged, _ = svc.run_forecast(daily, ("seasonal_naive", "rolling_mean_7", "rolling_mean_14", "global_ml"))
    ref = csv("tier2_validation_predictions.csv", parse_dates=["Date"])
    m = merged.merge(ref, on=["Date", "Bar Name", "Brand Name"], suffixes=("", "_ref"))
    assert len(m) == len(ref)
    for c in ("pred_seasonal_naive", "pred_rolling_mean_7", "pred_rolling_mean_14"):
        assert np.allclose(m[c], m[c + "_ref"])
    # HistGBM is deterministic for a fixed sklearn version; allow tiny cross-version drift
    assert np.allclose(m["pred_global_ml"], m["pred_global_ml_ref"], rtol=1e-3, atol=1e-2)

def test_tier1_helpers_do_not_overwrite_processed_files():
    daily = csv("daily_bar_consumption.csv", parse_dates=["Date"])
    def digest(): return {p.name: hashlib.md5(p.read_bytes()).hexdigest() for p in P.glob("*.csv")}
    before = digest(); t1 = legacy.t1()
    with legacy.redirected(t1, ABC_PATH=None, SERIES_STATS_PATH=None, FIG_DIR=None):
        abc = t1.abc_classification(daily); sc = t1.per_series_classification(daily)
    assert digest() == before
    ref = csv("abc_classification.csv")
    assert abc["abc_class"].tolist() == ref["abc_class"].tolist()
    assert sc["series_class"].tolist() == csv("series_classification.csv")["series_class"].tolist()

def test_tier0_grid_from_raw_matches_csv():
    raw = legacy.t0().load_raw(ROOT / "data" / "raw" / "bar_inventory_data.xlsx")
    grid = legacy.t0().build_daily_grid(raw)
    ref = csv("daily_bar_consumption.csv", parse_dates=["Date"])
    assert len(grid) == len(ref) and np.allclose(grid["consumed_ml"], ref["consumed_ml"])

def test_recommendation_rules():
    assert eng.classify(0, 100, 100, 5) == "out"
    assert eng.classify(50, 100, 100, 5) == "risk"
    assert eng.classify(150, 100, 100, 5) == "low"       # < 2 x ROP
    assert eng.classify(250, 100, 100, 5) == "healthy"
    assert eng.classify(400, 100, 100, 5) == "over"      # >= 4 x par
    assert eng.classify(10, 0, 0, 0) == "over" and eng.classify(0, 0, 0, 0) == "healthy"

def test_engine_gml99_params_and_order_qty():
    inp = csv("tier4_series_model_inputs.csv"); r = inp.iloc[0]
    p = eng.policy_params("Global ML (99% SL)", r, 2)
    assert p["par"] == pytest.approx(r["pred_global_ml_mean"] * 2 + 2.326 * r["pred_global_ml_rmse"] * 2 ** 0.5)
    daily = csv("daily_bar_consumption.csv", parse_dates=["Date"])
    rows = eng.build_rows(inp, eng.latest_ledger(daily), daily["Date"].max(), "Global ML (99% SL)", 2)
    assert len(rows) == 96
    risky = rows[rows["status"].isin(["out", "risk"])]
    assert (risky["order_qty"] == (risky["par"] - risky["on_hand"]).clip(lower=0)).all()
    recs = eng.build_recommendations(rows, 2)
    assert set(recs["kind"]) <= {"stockout", "reorder", "watch", "overstock"} and len(recs) == (rows["status"] != "healthy").sum()

@pytest.mark.skipif(not HAVE_SM, reason="statsmodels not installed here; verified inside the Docker image")
def test_holt_winters_reproduces_tier2():
    daily = csv("daily_bar_consumption.csv", parse_dates=["Date"])
    merged, _ = svc.run_forecast(daily, ("holt_winters",))
    ref = csv("tier2_validation_predictions.csv", parse_dates=["Date"])
    m = merged.merge(ref, on=["Date", "Bar Name", "Brand Name"], suffixes=("", "_ref"))
    assert np.allclose(m["pred_holt_winters"], m["pred_holt_winters_ref"], rtol=1e-4, atol=1e-3)

def test_policy_comparison_and_lead_time_sensitivity_match_tier4():
    t4 = legacy.t4()
    sims = {p: csv(PERSERIES_FILE[p]) for p in POLICY_DEFS}
    got = T.policy_comparison(sims, t4.aggregate_policy)
    ref = csv("tier4_policy_comparison.csv")
    pd.testing.assert_frame_equal(got, ref, check_exact=False, rtol=1e-9)
    pred = csv("tier2_validation_predictions.csv", parse_dates=["Date"])
    rows = [t4.aggregate_policy(svc.simulate_policies(pred, ["Global ML (99% SL)"], L)["Global ML (99% SL)"], f"Global ML (99% SL) @ L={L}d")
            for L in (2, 3, 5)]
    pd.testing.assert_frame_equal(pd.DataFrame(rows), csv("tier4_leadtime_sensitivity.csv"), check_exact=False, rtol=1e-9)
