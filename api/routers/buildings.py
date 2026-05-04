from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.clients import PostgresClient
from api.dependencies import get_postgres
from api.schemas import BuildingResponse, RoomResponse

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("", response_model=list[BuildingResponse], summary="List all buildings")
async def list_buildings(
    postgres: PostgresClient = Depends(get_postgres),
) -> list[BuildingResponse]:
    rows = await postgres.get_buildings()
    return [BuildingResponse(**dict(r)) for r in rows]


@router.get("/{building_id}", response_model=BuildingResponse, summary="Get a building")
async def get_building(
    building_id: str,
    postgres: PostgresClient = Depends(get_postgres),
) -> BuildingResponse:
    row = await postgres.get_building(building_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Building '{building_id}' not found")
    return BuildingResponse(**dict(row))


@router.get("/{building_id}/rooms", response_model=list[RoomResponse], summary="List rooms in a building")
async def list_rooms(
    building_id: str,
    postgres: PostgresClient = Depends(get_postgres),
) -> list[RoomResponse]:
    rows = await postgres.get_rooms(building_id)
    return [RoomResponse(**dict(r)) for r in rows]
