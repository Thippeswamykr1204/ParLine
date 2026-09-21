"""Container start-up: wait for Postgres -> migrate -> seed (first boot only) ."""
import logging, os, sys, time
from sqlalchemy import text
from .db import get_engine
from .migrate import migrate
from .seed import seed

def main():
    logging.basicConfig(level=logging.INFO)
    for i in range(60):
        try:
            with get_engine().connect() as c: c.execute(text("SELECT 1")); break
        except Exception as e:
            logging.info("waiting for database (%s)", type(e).__name__); time.sleep(2)
    else: sys.exit("database never became reachable")
    migrate()
    if os.environ.get("SEED_ON_START", "true").lower() == "true": seed(force=False)

if __name__ == "__main__":
    main()
