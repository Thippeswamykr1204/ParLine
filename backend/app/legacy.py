"""Loads the verified Tier 0-4 modules UNMODIFIED and calls into them.

Two safeguards:
* Those scripts use cwd-relative paths at import time, so imports happen with cwd = PROJECT_ROOT.
* Tier 1 helpers write CSVs/figures into data/processed and report/figures as a side effect. `redirected`
  points those module-level paths at a temp dir while we call them, so the verified outputs the frontend
  and parity test read are never overwritten.
"""
import contextlib, importlib, os, sys, tempfile
from pathlib import Path
from .config import PROJECT_ROOT

_SRC = str(PROJECT_ROOT / "src" / "data")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

@contextlib.contextmanager
def _cwd(p):
    old = os.getcwd(); os.chdir(p)
    try: yield
    finally: os.chdir(old)

def _load(name):
    with _cwd(PROJECT_ROOT):
        return importlib.import_module(name)

def t0(): return _load("tier0_pipeline")
def t1(): return _load("tier1_eda")
def t2(): return _load("tier2_forecasting")
def t3(): return _load("tier3_par_levels")
def t4(): return _load("tier4_simulation")

@contextlib.contextmanager
def redirected(module, **names):
    """Temporarily override module-level Path attributes (e.g. ABC_PATH, FIG_DIR) with temp locations."""
    tmp = Path(tempfile.mkdtemp(prefix="legacy_out_"))
    saved = {k: getattr(module, k) for k in names}
    try:
        for k in names:
            setattr(module, k, tmp / (k.lower() + (".csv" if k.endswith("PATH") else "")))
            if k.endswith("DIR"): getattr(module, k).mkdir(parents=True, exist_ok=True)
        yield tmp
    finally:
        for k, v in saved.items(): setattr(module, k, v)
