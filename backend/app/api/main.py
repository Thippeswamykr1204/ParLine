import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ..config import CORS_ORIGINS, NUANCE
from . import ml_routes, routes
from ..agent import routes as agent_routes

logging.basicConfig(level=logging.INFO)
app = FastAPI(
    title="Parline inventory API (Tier 6)",
    version="6.0.0",
    description="Database-backed API + ML service for the hotel bar inventory system.\n\n**Read this before comparing models:** " + NUANCE)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])
app.include_router(routes.router, prefix="/api/v1")
app.include_router(ml_routes.router, prefix="/api/v1")
app.include_router(agent_routes.router, prefix="/api/v1")  # Tier 7: read-only explain-only agent
