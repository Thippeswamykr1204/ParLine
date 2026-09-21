import logging
from pathlib import Path
from sqlalchemy import text
from .db import get_engine

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"

def migrate():
    with get_engine().begin() as c:
        c.execute(text("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())"))
        done = {r[0] for r in c.execute(text("SELECT version FROM schema_migrations"))}
        for f in sorted(SQL_DIR.glob("*.sql")):
            if f.name in done: continue
            logging.info("applying %s", f.name)
            c.exec_driver_sql(f.read_text())
            c.execute(text("INSERT INTO schema_migrations(version) VALUES(:v)"), {"v": f.name})

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO); migrate()
