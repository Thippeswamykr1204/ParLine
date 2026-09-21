"""Daily pipeline: ingest -> validate -> regenerate daily_demand -> forecast -> par levels -> recommendations -> metrics.

Run:  python -m app.pipeline.daily_job [--force-refit]   (cron / scheduler container / POST /api/v1/pipeline/run)
Atomicity: one forecast_runs row; readers only see runs with status='success', so a failed run leaves the
previous run's forecasts/par/recommendations fully intact.
Ingest: drop CSV/XLSX files with the raw-log schema into data/incoming/; processed files move to data/incoming/done/.
"""
from __future__ import annotations
import argparse, logging, shutil, sys, traceback
from pathlib import Path
import pandas as pd
from sqlalchemy import text
from .. import legacy, repo, transforms as T
from ..naming import MODEL_KEYS
from ..config import INCOMING_DIR, KEEP_RUNS, MAX_INVALID_PCT
from ..db import get_engine, transaction
from ..ml import service as svc
from . import stages

log = logging.getLogger("parline.pipeline")
RAW_COLS = ["Date Time Served", "Bar Name", "Alcohol Type", "Brand Name", "Opening Balance (ml)", "Purchase (ml)",
            "Consumed (ml)", "Closing Balance (ml)"]
LOCK_ID = 727272

def read_incoming(directory: Path = INCOMING_DIR):
    files = sorted(p for p in Path(directory).glob("*") if p.suffix.lower() in (".csv", ".xlsx") and p.is_file())
    frames = []
    for f in files:
        df = pd.read_csv(f) if f.suffix.lower() == ".csv" else pd.read_excel(f)
        missing = set(RAW_COLS) - set(df.columns)
        if missing: raise ValueError(f"{f.name}: missing columns {sorted(missing)}")
        frames.append(df[RAW_COLS])
    return files, (pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=RAW_COLS))

def validate(df: pd.DataFrame):
    """Returns (clean_df, report). Uses Tier 0's conservation check; rejects structurally bad rows."""
    if df.empty: return df, {"rows_in": 0, "rows_rejected": 0}
    df = df.copy(); df["Date Time Served"] = pd.to_datetime(df["Date Time Served"], errors="coerce")
    num = ["Opening Balance (ml)", "Purchase (ml)", "Consumed (ml)", "Closing Balance (ml)"]
    for c in num: df[c] = pd.to_numeric(df[c], errors="coerce")
    bad = df[num + ["Date Time Served", "Bar Name", "Brand Name"]].isna().any(axis=1)
    bad |= (df[num] < 0).any(axis=1)
    bad |= df.duplicated()
    ok = df[~bad].copy(); ok["Date"] = ok["Date Time Served"].dt.floor("D")
    cons = legacy.t0().validate_conservation(ok) if len(ok) else {"rows_out_of_tolerance": 0}
    off = (ok["Opening Balance (ml)"] + ok["Purchase (ml)"] - ok["Consumed (ml)"] - ok["Closing Balance (ml)"]).abs() > legacy.t0().TOLERANCE_ML
    ok = ok[~off]
    rejected = len(df) - len(ok)
    return ok, {"rows_in": len(df), "rows_rejected": int(rejected), "structural_rejects": int(bad.sum()),
                "conservation_rejects": int(cons["rows_out_of_tolerance"]), "rejected_pct": round(rejected / len(df) * 100, 2)}

def run(run_type: str = "daily") -> int | None:
    engine = get_engine()
    with engine.connect() as lock_conn:
        if not lock_conn.execute(text("SELECT pg_try_advisory_lock(:i)"), {"i": LOCK_ID}).scalar():
            log.warning("another pipeline run holds the lock; exiting"); return None
        try:
            return _run(run_type)
        finally:
            lock_conn.execute(text("SELECT pg_advisory_unlock(:i)"), {"i": LOCK_ID}); lock_conn.commit()

def _run(run_type):
    with transaction() as c: run_id = repo.create_run(c, run_type)     # committed immediately => visible as 'running'
    try:
        files, raw_new = read_incoming()
        clean, report = validate(raw_new)
        if report["rows_in"] and report["rejected_pct"] > MAX_INVALID_PCT:
            raise RuntimeError(f"validation failed: {report['rejected_pct']}% rows rejected > {MAX_INVALID_PCT}% ({report})")
        with transaction() as conn:
            inserted = 0
            if len(clean):
                bars = clean["Bar Name"].unique()
                types = clean.drop_duplicates("Brand Name").set_index("Brand Name")["Alcohol Type"].to_dict()
                repo.ensure_dimensions(conn, bars, types)
                inserted = repo.insert_transactions(conn, clean, "daily_job")
            raw_all = repo.load_raw_transactions(conn)
            t0, t1, t2 = legacy.t0(), legacy.t1(), legacy.t2()
            daily = t0.build_daily_grid(raw_all)                      # Tier 0, unmodified
            repo.replace_daily(conn, daily)
            with legacy.redirected(t1, ABC_PATH=None, SERIES_STATS_PATH=None, FIG_DIR=None):  # keep Tier 1 files untouched
                abc = t1.abc_classification(daily); sc = t1.per_series_classification(daily)
            repo.replace_profiles(conn, T.profiles_to_frame(sc, abc))
            merged, split_date = svc.run_forecast(daily)
            pred = svc.attach_context(merged, abc, sc)
            scores = svc.score_models(pred)
            derived = stages.derive(pred)
            out = stages.persist(conn, run_id, pred, scores, derived, daily,
                                 {"new_transactions": inserted, "rejected_rows": report["rows_rejected"]})
            repo.finish_run(conn, run_id, "success", data_max_date=daily["Date"].max().date(),
                            split_date=pd.Timestamp(split_date).date(), n_series=len(sc),
                            models=MODEL_KEYS, validation_report=report,
                            notes=f"files={[f.name for f in files]} inserted={inserted} recs={out['recommendations']}")
            repo.prune_runs(conn, KEEP_RUNS)
        done = INCOMING_DIR / "done"; done.mkdir(exist_ok=True)
        for f in files: shutil.move(str(f), done / f.name)
        log.info("run %s success: %s", run_id, out); return run_id
    except Exception as e:
        log.error("run %s failed: %s\n%s", run_id, e, traceback.format_exc())
        with transaction() as c: repo.finish_run(c, run_id, "failed", notes=str(e)[:2000])
        raise

def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    argparse.ArgumentParser(description=__doc__).parse_args()
    try: sys.exit(0 if run() is not None else 0)
    except Exception: sys.exit(1)

if __name__ == "__main__":
    main()
