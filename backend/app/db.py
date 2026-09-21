from contextlib import contextmanager
from sqlalchemy import create_engine, text
from .config import DATABASE_URL

_engine = None

def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
    return _engine

@contextmanager
def transaction():
    with get_engine().begin() as conn:
        yield conn

def get_conn():
    """FastAPI dependency: one connection per request."""
    with get_engine().connect() as conn:
        yield conn

def current_run_id(conn):
    return conn.execute(text(
        "SELECT id FROM forecast_runs WHERE status='success' ORDER BY finished_at DESC, id DESC LIMIT 1")).scalar()
