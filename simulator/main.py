"""
Simulator entry point.

Context injected into every sensor tick
──────────────────────────────────────
  hour              float  fractional 24-h (Asia/Colombo)
  day_of_week       int    0=Mon … 6=Sun
  is_holiday        bool   Sri Lanka public holiday (from holidays.py)
  academic_day      AcademicDay  from AcademicCalendar (congestion, TUA, exam periods)
  active_venue_fill dict   {building_id: fill_factor} from EventCalendar
  occupancy_ratio   float  room's current count / capacity (fed into energy/temp)

Architecture
────────────
  - Zones (zones/ package) encapsulate zone-specific occupancy logic
  - Each room_type maps to a Zone class via get_zone_for_room_type()
  - Zones create their own sensors (temperature, occupancy, energy)
  - Zones apply academic calendar congestion to their occupancy patterns
"""
import os
import signal
import sys
import time
from datetime import date as dt_date, datetime
from typing import Dict, List, Tuple
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.logging_config import get_logger
from simulator.campus.academic_calendar import AcademicCalendar, calendar as academic_calendar
from simulator.campus.events import EventCalendar
from simulator.campus.holidays import is_holiday
from simulator.campus.topology import CampusTopology, Room
from simulator.config import config
from simulator.publisher import MQTTPublisher
from simulator.sensors.base import BaseSensor
from simulator.sensors.occupancy import OccupancySensor
from simulator.zones import BaseZone, get_zone_for_room_type

logger = get_logger("simulator.main", config.log_level)


def _build_zones(topology: CampusTopology) -> List[Tuple[Room, BaseZone]]:
    """Create Zone instances for each room based on room_type."""
    zones: List[Tuple[Room, BaseZone]] = []
    for room in topology.all_rooms():
        zone_class = get_zone_for_room_type(room.room_type)
        zone = zone_class(room)
        zones.append((room, zone))
    return zones


def _make_context(
    now: datetime,
    event_calendar: EventCalendar,
    academic_calendar: AcademicCalendar,
) -> Dict:
    """Build context dict with time, events, and academic calendar state."""
    hour = now.hour + now.minute / 60.0
    today = now.date()
    academic_day = academic_calendar.get_day(today)

    return {
        "hour":              hour,
        "day_of_week":       now.weekday(),
        "is_holiday":        is_holiday(today),
        "academic_day":      academic_day,  # Contains congestion_fraction, activity type, TUA flag
        "active_venue_fill": event_calendar.active_venue_fill(today, hour),
    }


def main() -> None:
    logger.info("Starting Smart Campus Simulator (Zone-based with Academic Calendar)")
    topology  = CampusTopology()
    publisher = MQTTPublisher()
    publisher.connect()

    # Initialize calendars
    event_calendar = EventCalendar()
    academic_cal = academic_calendar  # Module-level singleton

    # Build zones (each zone creates its own sensors)
    zones = _build_zones(topology)

    # Collect all sensors from all zones
    all_sensors: List[Tuple[Room, BaseSensor]] = []
    for room, zone in zones:
        for sensor in zone.sensors:
            all_sensors.append((room, sensor))

    # Map room_id to zone for quick lookup
    room_zones: Dict[str, BaseZone] = {
        room.room_id: zone for room, zone in zones
    }

    reading_count = 0
    stop = False

    def _handle_signal(sig, frame):
        nonlocal stop
        logger.info("Shutdown signal received")
        stop = True

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT,  _handle_signal)

    logger.info(
        "Simulator ready",
        extra={
            "zone_count":     len(zones),
            "sensor_count":   len(all_sensors),
            "building_count": len(topology.buildings),
            "room_count":     len(topology.all_rooms()),
            "interval_s":     config.publish_interval_s,
        },
    )

    while not stop:
        now = datetime.now(ZoneInfo(config.campus_timezone))
        ctx = _make_context(now, event_calendar, academic_cal)

        # Get academic calendar info for logging
        today = now.date()
        academic_day = academic_cal.get_day(today)

        # Pass 1: occupancy sensors → get per-room headcount ratios
        occ_readings: Dict[str, float] = {}
        for room, sensor in all_sensors:
            if sensor.sensor_type == "occupancy" and isinstance(sensor, OccupancySensor):
                r = sensor.read(ctx)
                occ_readings[room.room_id] = r.value / max(1, sensor.capacity)

        # Pass 2: all sensors with occupancy_ratio injected
        for room, sensor in all_sensors:
            room_ctx = {**ctx, "occupancy_ratio": occ_readings.get(room.room_id, 0.0)}
            reading  = sensor.read(room_ctx)
            publisher.publish(reading)
            reading_count += 1

        if reading_count % (len(all_sensors) * 10) == 0:
            events_today = event_calendar.events_for_date(today)
            logger.info(
                "Heartbeat",
                extra={
                    "total_readings":   reading_count,
                    "is_holiday":       is_holiday(today),
                    "activity":         academic_day.activity.value,
                    "congestion":       round(academic_day.congestion_fraction, 2),
                    "tua_active":       academic_day.tua_active,
                    "events_today":     len(events_today),
                    "active_venues":    list(ctx["active_venue_fill"].keys()),
                },
            )

        time.sleep(config.publish_interval_s)

    publisher.disconnect()
    logger.info("Simulator stopped", extra={"total_readings": reading_count})


if __name__ == "__main__":
    main()
