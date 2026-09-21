import os
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path(__file__).resolve().parents[2]))
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+psycopg2://parline:parline@localhost:5432/parline")
API_KEY = os.environ.get("API_KEY", "")  # empty = auth disabled (dev). Protects mutating/heavy endpoints only.
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
INCOMING_DIR = Path(os.environ.get("INCOMING_DIR", PROJECT_ROOT / "data" / "incoming"))
KEEP_RUNS = int(os.environ.get("KEEP_RUNS", "14"))          # forecast/par/sim rows retained per run; metrics kept forever
MAX_INVALID_PCT = float(os.environ.get("MAX_INVALID_PCT", "5"))  # abort the daily job above this % of bad rows
WAPE_DRIFT_ALERT = float(os.environ.get("WAPE_DRIFT_ALERT", "0.10"))  # relative WAPE increase vs previous run
SCHEDULE_UTC = os.environ.get("SCHEDULE_UTC", "02:00")

# Mirrors frontend/src/lib/config.ts so API recommendations match the UI engine.
DEFAULT_LEAD_TIME = 2
RECOMMENDED_POLICY = "Global ML (99% SL)"
BASELINE_POLICY = "Naive (fixed qty)"
OVERSTOCK_MULTIPLE = 4
LOW_MULTIPLE = 2
STALE_DAYS = 7

# Must stay visible in API/docs/monitoring copy.
NUANCE = (
    "The forecast-accuracy winner (Rolling Mean 7d, lowest WAPE) is NOT the business winner. "
    "Once simulated against stockouts and lost volume, Global ML at a 99% service level wins "
    "(263 stockout days vs 584 for the naive rule in the verified backtest). Judge policies by simulation, not WAPE alone."
)
