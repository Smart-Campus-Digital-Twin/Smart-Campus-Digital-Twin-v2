"""
InfluxDB client for the API — all Flux queries in one place.

Uses the synchronous InfluxDB client wrapped in asyncio.run_in_executor
so the FastAPI event loop is never blocked by I/O.

Security: every caller-supplied tag value (building_id, room_id, sensor_type)
is validated by _validate_tag() before being interpolated into a Flux string.
This prevents Flux query injection.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from functools import partial

import pandas as pd
from fastapi import HTTPException, status
from influxdb_client import InfluxDBClient

from api.config import config

# \Z anchors at the true end of string; $ allows a trailing newline in Python.
_TAG_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}\Z")


def _validate_tag(value: str, name: str) -> str:
    """Raise HTTP 400 if value does not match the InfluxDB tag allowlist."""
    if not _TAG_RE.match(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {name} value: must match [A-Za-z0-9_-]{{1,64}}",
        )
    return value


def _utc(dt: datetime) -> str:
    """Format a datetime as a UTC RFC-3339 string for Flux range literals."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class InfluxAPIClient:
    """Singleton client — one per FastAPI process."""

    def __init__(self) -> None:
        """Initialise the InfluxDB client; real I/O happens in query methods."""
        self._client = InfluxDBClient(
            url   = config.influxdb_url,
            token = config.influxdb_token,
            org   = config.influxdb_org,
        )
        self._query_api = self._client.query_api()

    def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        self._client.close()

    async def ping(self) -> bool:
        """Non-blocking health check — wraps the synchronous ping in executor."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._client.ping)

    # ------------------------------------------------------------------
    # Internal helper — runs blocking query in a thread pool
    # ------------------------------------------------------------------

    async def _query(self, flux: str) -> pd.DataFrame:
        """Execute a Flux query off the event loop and return a DataFrame."""
        loop = asyncio.get_running_loop()
        fn   = partial(self._query_api.query_data_frame, flux)
        df   = await loop.run_in_executor(None, fn)
        if isinstance(df, list):
            df = pd.concat(df, ignore_index=True) if df else pd.DataFrame()
        return df

    # ------------------------------------------------------------------
    # Public query methods
    # ------------------------------------------------------------------

    async def latest_readings(self, building_id: str, range_minutes: int = 5) -> pd.DataFrame:
        """Latest value per sensor in a building within the last N minutes."""
        _validate_tag(building_id, "building_id")
        flux = f"""
from(bucket: "{config.influxdb_bucket_raw}")
  |> range(start: -{range_minutes}m)
  |> filter(fn: (r) => r._measurement == "sensors")
  |> filter(fn: (r) => r.building_id == "{building_id}")
  |> filter(fn: (r) => r._field == "value" or r._field == "quality" or r._field == "sensor_id")
  |> last()
  |> pivot(
       rowKey: ["_time", "building_id", "floor", "room_id", "sensor_type"],
       columnKey: ["_field"],
       valueColumn: "_value"
     )
"""
        return await self._query(flux)

    async def room_history(
        self,
        room_id: str,
        start: datetime,
        stop: datetime,
        sensor_type: str | None = None,
        resolution: str = "1h",
    ) -> pd.DataFrame:
        """Aggregated history for a room.

        resolution: "1m" → campus_1m bucket, "1h" → campus_1h bucket.
        """
        _validate_tag(room_id, "room_id")
        if sensor_type is not None:
            _validate_tag(sensor_type, "sensor_type")

        bucket      = config.influxdb_bucket_1m if resolution == "1m" else config.influxdb_bucket_1h
        measurement = "sensor_1m" if resolution == "1m" else "sensor_1h"
        type_filter = (
            f'|> filter(fn: (r) => r.sensor_type == "{sensor_type}")'
            if sensor_type else ""
        )

        flux = f"""
from(bucket: "{bucket}")
  |> range(start: {_utc(start)}, stop: {_utc(stop)})
  |> filter(fn: (r) => r._measurement == "{measurement}")
  |> filter(fn: (r) => r.room_id == "{room_id}")
  {type_filter}
  |> pivot(
       rowKey: ["_time", "room_id", "building_id", "sensor_type"],
       columnKey: ["_field"],
       valueColumn: "_value"
     )
  |> keep(columns: ["_time", "room_id", "building_id", "sensor_type",
                     "min", "max", "avg", "stddev", "count", "quality_avg"])
  |> sort(columns: ["_time"])
"""
        return await self._query(flux)

    async def building_energy_live(self, building_id: str, range_minutes: int = 30) -> pd.DataFrame:
        """Per-minute energy aggregation for a building, last N minutes."""
        _validate_tag(building_id, "building_id")
        flux = f"""
from(bucket: "{config.influxdb_bucket_1m}")
  |> range(start: -{range_minutes}m)
  |> filter(fn: (r) => r._measurement == "sensor_1m")
  |> filter(fn: (r) => r.building_id == "{building_id}")
  |> filter(fn: (r) => r.sensor_type == "energy")
  |> filter(fn: (r) => r._field == "avg" or r._field == "max")
  |> pivot(rowKey: ["_time", "room_id"], columnKey: ["_field"], valueColumn: "_value")
  |> group(columns: ["_time"])
  |> sum(column: "avg")
"""
        return await self._query(flux)
