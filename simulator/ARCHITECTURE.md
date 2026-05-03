# Simulator Architecture

This simulator models a University of Moratuwa campus as buildings, rooms, zones, and sensors. Each tick builds a small context object, computes occupancy first, then uses that occupancy to drive temperature and energy readings. Readings are published to MQTT as JSON sensor messages.

## Runtime Flow

1. `main.py` loads the campus topology, calendars, and MQTT publisher.
2. The current time is converted into a context containing:
    - `hour`
    - `day_of_week`
    - `is_holiday`
    - `academic_day`
    - `active_venue_fill`
3. Occupancy sensors run first and produce a per-room occupancy ratio.
4. Temperature and energy sensors run next with `occupancy_ratio` injected into the room context.
5. Each reading is published to MQTT with QoS 1.

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

The topology includes:
- lecture and admin buildings
- canteens
- hostels
- the library
- event venues such as Lagaan, Multipurpose Hall, and NA halls

### `simulator/campus/academic_calendar.py`
Provides the academic state for any date.
- returns an `AcademicDay`
- sets `congestion_fraction`
- marks exam periods, breaks, vacations, TUA, and weekend behavior
- `lecture_scale` is used by zones to reduce occupancy during lower-attendance periods

### `simulator/campus/events.py`
Generates deterministic campus events.
- padura
- food festival
- symposium
- orientation
- career fair
- workshop

Events can override occupancy for specific buildings through `active_venue_fill`.

### `simulator/campus/schedule.py`
Contains the shared occupancy pattern helpers.
- lecture and exam slot timing
- canteen rush periods
- library, office, and hostel occupancy functions
- weekend-active buildings

This module is the main source of truth for time-of-day occupancy shapes.

### `simulator/zones/`
Each room type maps to a zone class.
- `ClassroomZone` handles classrooms and labs
- `CanteenZone` handles canteens and food courts
- `LibraryZone` handles library behavior
- `HostelZone` handles hostel occupancy
- `OfficeZone` handles admin and staff areas
- `AuditoriumZone` handles halls and event venues
- `OutdoorZone` handles open areas
- `ServerRoomZone` handles server rooms

Zones decide the target occupancy ratio from:
- time of day
- weekend or holiday state
- academic congestion
- exam periods
- active events

## Sensors

### Occupancy sensor
`simulator/sensors/occupancy.py` keeps a stateful headcount and moves it gradually toward the target ratio.
- occupancy changes are smoothed
- counts move roughly one person at a time per tick
- values are clamped to room capacity

### Temperature sensor
`simulator/sensors/temperature.py` models indoor temperature.
- room type defines HVAC and occupancy gains
- building-specific heat offsets are applied
- rooms drift toward outdoor ambient when HVAC is off
- server rooms use a separate 24/7 cooling model

### Energy sensor
`simulator/sensors/energy.py` models power draw.
- each room type has a base load
- occupancy increases load
- active lecture hours add equipment load
- empty night-time rooms fall back to standby power
- server rooms have a constant high draw

## Configuration

`simulator/config.py` reads runtime settings from environment variables.
- `MQTT_HOST`
- `MQTT_PORT`
- `MQTT_KEEPALIVE`
- `PUBLISH_INTERVAL_S`
- `LOG_LEVEL`
- `CAMPUS_TIMEZONE`
- optional MQTT username and password

## Output

`simulator/publisher.py` sends readings to MQTT.
- auto-reconnects on failure
- publishes with QoS 1
- uses the `campus-simulator` client id

## Mental Model

Think of the simulator as a pipeline:

`calendar + events + time -> zone target occupancy -> smoothed occupancy sensor -> temperature/energy sensors -> MQTT`

