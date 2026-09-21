import math, threading
import numpy as np, pandas as pd
from fastapi import Header, HTTPException
from ..config import API_KEY

def require_key(x_api_key: str = Header(default="")):
    if API_KEY and x_api_key != API_KEY: raise HTTPException(401, "invalid or missing X-API-Key")

heavy = threading.Semaphore(1)   # ML endpoints refit models; serialise them

def records(df: pd.DataFrame) -> list[dict]:
    df = df.copy()
    for c in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[c]): df[c] = df[c].dt.strftime("%Y-%m-%d")
    out = df.astype(object).where(pd.notna(df), None).to_dict("records")
    return [{k: (v.item() if isinstance(v, np.generic) else v) for k, v in r.items()} for r in out]
