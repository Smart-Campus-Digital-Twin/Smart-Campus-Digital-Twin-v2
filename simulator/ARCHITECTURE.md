# Simulator Architecture

This simulator models a University of Moratuwa campus as buildings, rooms, zones, and sensors. Each tick builds a context object, computes occupancy first (once), then uses that occupancy to drive temperature and energy readings. Readings are published to MQTT as JSON sensor messages.

## Runtime Flow

1. `main.py` loads the campus topology, calendars, and MQTT publisher.
2. The current time is converted into a context containing:
    - `hour`
    - `day_of_week`
    - `is_holiday`
    - `academic_day`
    - `active_venue_fill` — building-id → occupancy factor for active event venues
    - `active_event_types` — set of event type strings active this tick
3. **Pass 1 — occupancy only.** Every occupancy sensor runs once, advances its internal `_count` state, and produces a `SensorReading`. Both the reading and the derived ratio are cached.
4. **Pass 2 — temperature and energy.** These sensors run with `occupancy_ratio` injected from the Pass 1 cache. Occupancy sensors skip re-execution and publish their cached Pass 1 reading directly. This ensures `_count` advances exactly once per tick and the published occupancy value is identical to the ratio used by temperature and energy.
5. Sensors that are currently offline (dropout simulation) return `None`; those readings are silently skipped and not published.
6. Each live reading is published to MQTT with QoS 1.

## Main Modules

### `simulator/main.py`
The entry point. It:
- creates the topology
- connects the MQTT publisher
- builds one zone per room
- runs the two-pass sensor loop until interrupted

### `simulator/campus/topology.py`
Defines the physical campus layout.
- 26 buildings are modeled
- each room has a `room_type`, `capacity`, and sensor bundle
- standard rooms use `[temperature, occupancy, energy]`
- server rooms use `[temperature, energy]` only
- outdoor spaces use `[occupancy]` only

### `simulator/campus/academic_calendar.py`
Provides the academic state for any date.
- returns an `AcademicDay` with `congestion_fraction`, `activity`, exam-period flags, and TUA flag
- `lecture_scale` is used by zones to reduce occupancy during lower-attendance periods

### `simulator/campus/events.py`
Generates deterministic campus events seeded on the date.
- padura, food festival, symposium, orientation, career fair, workshop, movie night
- `active_venue_fill(date, hour)` — building-id → fill factor for hosting buildings
- `active_event_types(date, hour)` — set of event type strings; used by non-hosting buildings to apply crowd redistribution

### `simulator/campus/schedule.py`
Single source of truth for time-of-day occupancy shapes.
- **Burst-fill lecture model:** 10-minute pre-window with a convex t² ramp (slow start, rapid arrival in the final minutes before the slot), 5-minute post-window with a (1−t)² drain (rapid emptying right after the slot ends)
- exam slot timing, canteen rush periods, library/office/hostel patterns

### `simulator/zones/`
Each room type maps to a zone class. Zones return a target occupancy ratio from:
- time of day
- weekend / holiday state (classrooms keep a 3 % residual on holidays for postgrad researchers)
- academic congestion and exam periods
- active event venue overrides
- **crowd redistribution** — when an event is active elsewhere on campus, non-hosting buildings receive a drain or boost modifier based on event type and room type (e.g. career fair reduces classroom occupancy to 80 %, boosts canteen to 110 %)

#### Zone classes
| Class | Room types |
|---|---|
| `ClassroomZone` | classrooms, labs |
| `CanteenZone` | canteens, food courts |
| `LibraryZone` | library |
| `HostelZone` | hostels |
| `OfficeZone` | admin and staff offices |
| `AuditoriumZone` | halls and event venues |
| `OutdoorZone` | open areas |
| `ServerRoomZone` | server rooms |

#### `OutdoorZone` seasonal model
Month is used as a weather proxy:
- Mar–Apr (hot season, ~33 °C): midday 11:00–15:00 factor 0.40, rest of day 0.85
- May, Oct–Nov (SW/NE monsoon): all-day factor 0.60
- Dec–Jan (cool season): factor 1.20

## Sensors

### Occupancy sensor — `simulator/sensors/occupancy.py`
Stateful headcount that converges toward the zone's target ratio.
- **Burst mode:** when the gap between current count and target exceeds 10 % of capacity (e.g. a lecture hall filling from empty), up to `capacity // 20` people move per tick. This fills a 500-seat hall in ~2–3 minutes. Small gaps remain fine-grained (one person per tick).
- Counts are clamped to room capacity with Gaussian noise (±4 % of capacity).

### Temperature sensor — `simulator/sensors/temperature.py`
Models indoor temperature for Moratuwa's tropical climate.

**HVAC hysteresis**
During HVAC operating hours the thermostat uses a ±0.5 °C deadband around the setpoint. The unit turns ON when the room exceeds `setpoint + 0.5 °C` and OFF when it drops below `setpoint − 0.5 °C`, producing realistic narrow oscillations rather than a monotonic drift. Outside operating hours the unit is fully off and the room drifts passively toward outdoor ambient.

**Nonlinear occupancy heat gain**
`occ_gain × occ^1.5` — sparse crowds contribute little heat gain; the effect grows disproportionately at high density.

**Thermal asymmetry**
Drift rates differ by direction:
- HVAC actively cooling: θ = 0.12
- HVAC actively heating: θ = 0.09
- Passive cooling (room > outdoor, night): θ = 0.04 (concrete holds heat)
- Passive solar heating (room < outdoor, day): θ = 0.06

### Energy sensor — `simulator/sensors/energy.py`
Models active power draw in Watts.

**Per-type standby loads**
Empty night-time rooms fall back to a room-type-specific standby rather than a single constant:
- Canteen: 80 W (refrigeration + emergency lighting)
- Library: 40 W (security lighting, a few PCs)
- Lab: 35 W (equipment standby)
- Hostel: 25 W (corridor lighting)
- Classroom: 20 W

**Equipment warmup ramp**
Projectors, PCs, and AV systems ramp up linearly over the 15 minutes before the first lecture slot (08:00–08:15) rather than switching on as a binary step. The ramp scales with current occupancy so an empty room draws no equipment load.

## Sensor reliability — `simulator/sensors/base.py`
Every sensor runs an independent failure state machine on each tick:
- **Fail probability:** 0.01 % per tick (~once per 14 hours at a 5-second interval)
- **Recovery probability:** 2 % per tick (~4-minute average outage)
- `read()` returns `None` while offline; no message is published, leaving a real gap in the time series for downstream ML/stream-processing to handle

## Configuration

`simulator/config.py` reads runtime settings from environment variables.
- `MQTT_HOST`, `MQTT_PORT`, `MQTT_KEEPALIVE`
- `PUBLISH_INTERVAL_S`
- `LOG_LEVEL`
- `CAMPUS_TIMEZONE`
- optional `MQTT_USERNAME` / `MQTT_PASSWORD`

## Output

`simulator/publisher.py` sends readings to MQTT.
- auto-reconnects with exponential backoff (max 30 s)
- publishes with QoS 1
- client ID is `campus-simulator-<8-hex-chars>` (randomised at startup so multiple instances can coexist without disconnecting each other)

## Mental Model

```
calendar + events + time
        │
        ▼
zone target ratio
  + crowd redistribution (active_event_types drain/boost)
        │
        ▼
burst-fill occupancy sensor (Pass 1, once per tick)
        │
        ├──▶ temperature sensor (nonlinear gain, HVAC hysteresis, asymmetric drift)
        │
        └──▶ energy sensor (per-type standby, equipment ramp)
                │
                ▼
      MQTT (skipped when sensor is offline)
```
