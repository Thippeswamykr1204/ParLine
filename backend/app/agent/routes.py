"""Tier 7: POST /api/v1/agent/ask -- grounded natural-language Q&A over Tier 2-6 outputs.
Read-only. Cannot trigger the pipeline, write recommendations, or place orders."""
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..db import get_conn
from . import llm

router = APIRouter(prefix="/agent", tags=["agent"])

class AskReq(BaseModel):
    question: str
    bar: Optional[str] = None   # optional UI context, e.g. the bar currently selected in the dashboard

class AskResp(BaseModel):
    answer: Optional[str]
    error: Optional[str] = None
    tool_calls: list[dict]

@router.post("/ask", response_model=AskResp)
def ask(req: AskReq, conn=Depends(get_conn)):
    return llm.ask(conn, req.question, req.bar)
