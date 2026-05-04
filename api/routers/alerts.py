"""
Alert endpoints — served from PostgreSQL anomalies table.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from api.clients import PostgresClient
from api.config import config
from api.dependencies import get_postgres
from api.schemas import AnomalyResponse, PagedResponse

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get(
    "",
    response_model=PagedResponse,
    summary="Query anomaly audit log",
)
async def get_alerts(
    since:       str          = Query(default="2020-01-01T00:00:00Z",
                                      description="ISO-8601 datetime lower bound"),
    building_id: str | None   = Query(default=None),
    severity:    str | None   = Query(default=None, pattern="^(info|warning|critical)$"),
    limit:       int          = Query(default=50, ge=1, le=500),
    offset:      int          = Query(default=0, ge=0),
    postgres:    PostgresClient = Depends(get_postgres),
) -> PagedResponse:
    rows = await postgres.get_anomalies(
        building_id = building_id,
        severity    = severity,
        since       = since,
        limit       = limit,
        offset      = offset,
    )
    items = [AnomalyResponse(**dict(r)) for r in rows]
    return PagedResponse(total=len(items), offset=offset, limit=limit, items=items)
