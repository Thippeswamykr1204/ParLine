"""Minimal daily scheduler (no orchestrator yet): sleeps until SCHEDULE_UTC each day then runs the job.
Equivalent cron line lives in backend/cron/crontab."""
import datetime as dt, logging, time
from ..config import SCHEDULE_UTC
from . import daily_job

def next_run(now):
    h, m = map(int, SCHEDULE_UTC.split(":"))
    t = now.replace(hour=h, minute=m, second=0, microsecond=0)
    return t if t > now else t + dt.timedelta(days=1)

def main():
    logging.basicConfig(level=logging.INFO)
    while True:
        now = dt.datetime.now(dt.timezone.utc); t = next_run(now)
        logging.info("next pipeline run at %s", t.isoformat()); time.sleep((t - now).total_seconds())
        try: daily_job.run("daily")
        except Exception: logging.exception("scheduled run failed")

if __name__ == "__main__":
    main()
