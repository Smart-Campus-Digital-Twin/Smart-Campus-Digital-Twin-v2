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
from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from shared.logging_config import get_logger
from simulator.anomaly_injector import inject_if_enabled
from simulator.campus.academic_calendar import AcademicCalendar
from simulator.campus.academic_calendar import calendar as academic_calendar
from simulator.campus.events import EventCalendar
from simulator.campus.holidays import is_holiday
from simulator.campus.topology import CampusTopology, Room
from simulator.config import config
from simulator.publisher import MQTTPublisher
from simulator.sensors.base import BaseSensor
from simulator.sensors.occupancy import OccupancySensor
from simulator.zones import BaseZone, get_zone_for_room_type

logger = get_logger("simulator.main", config.log_level)


def _build_zones(topology: CampusTopology) -> list[tuple[Room, BaseZone]]:
    """Create Zone instances for each room based on room_type."""
    zones: list[tuple[Room, BaseZone]] = []
    for room in topology.all_rooms():
        zone_class = get_zone_for_room_type(room.room_type)
        zone = zone_class(room)
        zones.append((room, zone))
    return zones


def _make_context(
    now: datetime,
    event_calendar: EventCalendar,
    academic_calendar: AcademicCalendar,
) -> dict:
    """Build context dict with time, events, and academic calendar state."""
    hour = now.hour + now.minute / 60.0
    today = now.date()
    academic_day = academic_calendar.get_day(today)

    return {
        "hour":               hour,
        "day_of_week":        now.weekday(),
        "is_holiday":         is_holiday(today),
        "academic_day":       academic_day,
        "active_venue_fill":  event_calendar.active_venue_fill(today, hour),
        "active_event_types": event_calendar.active_event_types(today, hour),
    }


app = FastAPI(title="Simulator Control UI")
simulator_state = {
    "running": True,
    "reading_count": 0,
    "interval_s": config.publish_interval_s,
    "anomaly_prob": float(os.environ.get("ANOMALY_INJECTION_PROB", "0.01"))
}

def main_loop():
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
    all_sensors: list[tuple[Room, BaseSensor]] = []
    for room, zone in zones:
        for sensor in zone.sensors:
            all_sensors.append((room, sensor))

    reading_count = 0

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

    while True:
        if not simulator_state["running"]:
            time.sleep(1)
            continue

        now = datetime.now(ZoneInfo(config.campus_timezone))
        ctx = _make_context(now, event_calendar, academic_cal)

        # Get academic calendar info for logging
        today = now.date()
        academic_day = academic_cal.get_day(today)

        # Pass 1: occupancy sensors only — advance state once, cache both the
        # ratio (for temperature/energy) and the SensorReading (for publishing).
        occ_readings:  dict[str, float]  = {}
        occ_published: dict[str, object] = {}
        for room, sensor in all_sensors:
            if sensor.sensor_type == "occupancy" and isinstance(sensor, OccupancySensor):
                r = sensor.read(ctx)
                if r is not None:
                    occ_readings[room.room_id]      = r.value / max(1, sensor.capacity)
                    occ_published[sensor.sensor_id] = r

        # Pass 2: temperature + energy sensors with occupancy_ratio injected;
        # occupancy sensors reuse the cached Pass-1 reading (no second _count advance).
        for room, sensor in all_sensors:
            if sensor.sensor_id in occ_published:
                reading = occ_published[sensor.sensor_id]
            else:
                room_ctx = {**ctx, "occupancy_ratio": occ_readings.get(room.room_id, 0.0)}
                reading  = sensor.read(room_ctx)
            if reading is not None:
                # Inject anomalies if enabled
                reading = inject_if_enabled(reading)
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

        simulator_state["reading_count"] = reading_count
        time.sleep(simulator_state["interval_s"])

    publisher.disconnect()
    logger.info("Simulator stopped", extra={"total_readings": reading_count})

@app.get("/", response_class=HTMLResponse)
async def get_ui():
    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Campus Simulator Control Panel</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet">
        <style>
            :root {{
                --bg: #0B0C10;
                --panel: rgba(31, 40, 51, 0.7);
                --text: #C5C6C7;
                --accent: #66FCF1;
                --accent-dark: #45A29E;
            }}
            body {{
                margin: 0; padding: 0;
                font-family: 'Inter', sans-serif;
                background: radial-gradient(circle at center, #111a22 0%, var(--bg) 100%);
                color: var(--text);
                min-height: 100vh;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                overflow: hidden;
            }}
            .container {{
                background: var(--panel);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(102, 252, 241, 0.2);
                border-radius: 20px;
                padding: 40px;
                width: 90%; max-width: 500px;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
                text-align: center;
                animation: fadeIn 0.8s ease-out;
            }}
            h1 {{
                color: var(--accent);
                margin-top: 0;
                font-weight: 800;
                letter-spacing: 1.5px;
                text-transform: uppercase;
                margin-bottom: 30px;
            }}
            .stats {{
                display: flex; justify-content: space-around;
                margin-bottom: 40px;
            }}
            .stat-box {{
                background: rgba(0, 0, 0, 0.3);
                padding: 15px 20px;
                border-radius: 12px;
                border: 1px solid rgba(102, 252, 241, 0.1);
                transition: transform 0.3s;
            }}
            .stat-box:hover {{ transform: translateY(-5px); border-color: var(--accent); }}
            .stat-value {{
                font-size: 28px; font-weight: 800; color: #fff;
                display: block; margin-bottom: 5px;
            }}
            .stat-label {{ font-size: 12px; text-transform: uppercase; color: var(--accent-dark); font-weight: 600; }}
            .btn {{
                background: linear-gradient(135deg, var(--accent-dark), var(--accent));
                color: var(--bg);
                border: none;
                padding: 15px 40px;
                font-size: 16px; font-weight: 800;
                border-radius: 30px;
                cursor: pointer;
                transition: all 0.3s ease;
                text-transform: uppercase; letter-spacing: 1px;
                box-shadow: 0 4px 15px rgba(102, 252, 241, 0.4);
            }}
            .btn:hover {{
                transform: scale(1.05);
                box-shadow: 0 6px 20px rgba(102, 252, 241, 0.6);
            }}
            .btn:active {{ transform: scale(0.95); }}
            @keyframes fadeIn {{ from {{ opacity: 0; transform: translateY(20px); }} to {{ opacity: 1; transform: translateY(0); }} }}
            
            .status-indicator {{
                display: inline-block; width: 12px; height: 12px; border-radius: 50%;
                margin-right: 10px;
                box-shadow: 0 0 10px currentColor;
            }}
            .status-running {{ color: #00ff00; background: #00ff00; }}
            .status-stopped {{ color: #ff0000; background: #ff0000; }}
        </style>
        <script>
            async function toggleSim() {{
                const res = await fetch('/toggle', {{method: 'POST'}});
                if(res.ok) window.location.reload();
            }}
            setInterval(() => window.location.reload(), 5000);
        </script>
    </head>
    <body>
        <div class="container">
            <h1>Simulator Control</h1>
            
            <div style="margin-bottom: 30px; font-weight: 600; font-size: 18px; display: flex; align-items: center; justify-content: center;">
                <span class="status-indicator {'status-running' if simulator_state['running'] else 'status-stopped'}"></span>
                { "SYSTEM ONLINE" if simulator_state['running'] else "SYSTEM OFFLINE" }
            </div>

            <div class="stats">
                <div class="stat-box">
                    <span class="stat-value">{simulator_state['reading_count']}</span>
                    <span class="stat-label">Total Readings</span>
                </div>
                <div class="stat-box">
                    <span class="stat-value">{simulator_state['interval_s']}s</span>
                    <span class="stat-label">Tick Interval</span>
                </div>
            </div>

            <button class="btn" onclick="toggleSim()">
                { "SHUT DOWN SIMULATION" if simulator_state['running'] else "INITIALIZE SIMULATION" }
            </button>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@app.post("/toggle")
async def toggle_sim():
    simulator_state["running"] = not simulator_state["running"]
    return {"running": simulator_state["running"]}

def main() -> None:
    t = threading.Thread(target=main_loop, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=8002)


if __name__ == "__main__":
    main()
