"""
Smart Campus Digital Twin — FastAPI application entry point.

Startup sequence:
  1. Create InfluxDB client (synchronous, thread-pooled)
  2. Create PostgreSQL async connection pool
  3. Register both with the dependency injection layer
  4. Mount all routers
  5. Expose OpenAPI docs at /docs and /redoc

Shutdown:
  - Connection pool and InfluxDB client are closed cleanly via lifespan context.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.logging_config import get_logger
from api.clients import InfluxAPIClient, PostgresClient
from api.config import config
from api.dependencies import set_clients
from api.routers import alerts, buildings, health, metrics, reports

logger = get_logger("api", config.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manages database client lifecycle for the entire application."""
    logger.info("Starting API — connecting to InfluxDB and PostgreSQL...")

    influx   = InfluxAPIClient()
    postgres = PostgresClient()
    await postgres.connect()
    set_clients(influx, postgres)

    logger.info("Connected to both data stores. API is ready.")
    yield

    # --- Shutdown ---
    await postgres.close()
    influx.close()
    logger.info("API shutdown complete.")


app = FastAPI(
    title       = config.api_title,
    version     = config.api_version,
    description = (
        "Real-time and historical data API for the Smart Campus Digital Twin. "
        "Real-time endpoints query InfluxDB; report/alert endpoints query PostgreSQL."
    ),
    lifespan    = lifespan,
    docs_url    = "/docs",
    redoc_url   = "/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins  = config.cors_origins,
    allow_methods  = ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers  = ["*"],
)

# Register routers
app.include_router(health.router)
app.include_router(metrics.router)
app.include_router(buildings.router)
app.include_router(reports.router)
app.include_router(alerts.router)
