# Simulator Architecture

## Data Flow Overview

```
╔═══════════════════════════════════════════════════════════════════════╗
║                         INFLUENCING FACTORS                           ║
║                                                                       ║
║  ┌─────────────────────┐  ┌──────────────────┐  ┌─────────────────┐  ║
║  │  AcademicCalendar   │  │  EventCalendar   │  │  Clock /        │  ║
║  │                     │  │                  │  │  Holidays       │  ║
║  │  congestion_frac    │  │  padura          │  │                 │  ║
║  │  activity types:    │  │  symposium       │  │  hour  (0–24)   │  ║
║  │   AW   – lectures   │  │  food_festival   │  │  day_of_week    │  ║
║  │   EXAM – exams      │  │  orientation     │  │  is_holiday     │  ║
║  │   VAC  – vacation   │  │  career_fair     │  │  (SL public     │  ║
║  │   TUA  – strike     │  │  concert         │  │   holidays      │  ║
║  │   RB   – reading    │  │  workshop        │  │   2023–2026)    │  ║
║  │   MSB  – mid-break  │  │  sports_meet     │  └──────┬──────────┘  ║
║  │   IS   – ind. study │  │                  │         │             ║
║  │   IT   – industry   │  │  → venue_fill    │         │             ║
║  │                     │  │    dict[bldg→%]  │         │             ║
║  │  tua_active         │  └────────┬─────────┘         │             ║
║  │  lecture_scale      │           │                    │             ║
║  │  is_exam_period     │           │                    │             ║
║  │  is_low_attendance  │           │                    │             ║
║  │  is_essentially_    │           │                    │             ║
║  │    empty            │           │                    │             ║
║  └──────────┬──────────┘           │                    │             ║
║             └──────────────────────┼────────────────────┘             ║
╚════════════════════════════════════╪══════════════════════════════════╝
                                     │  context dict (per tick)
                                     ▼
              ┌──────────────────────────────────────────────┐
              │           main.py — Context Builder           │
              │  { hour, day_of_week, is_holiday,             │
              │    academic_day, congestion_fraction,         │
              │    active_venue_fill, lecture_scale }         │
              └─────────────────────┬────────────────────────┘
                                    │
                                    ▼
              ┌──────────────────────────────────────────────┐
              │  campus/schedule.py — Pattern Library         │
              │  (single source of truth for all ratios)      │
              │                                               │
              │  lecture_ratio(h)    canteen_ratio(h)         │
              │  exam_ratio(h)       library_ratio(h, exam)   │
              │  office_ratio(h)     hostel_ratio(h,wknd,vac) │
              │  LECTURE_SLOTS       CANTEEN_PERIODS           │
              │  Slots: 08:15–10:10 · 10:15–12:15             │
              │         13:15–15:10 · 15:15–17:15             │
              └─────────────────────┬────────────────────────┘
                                    │ imported by all zones
                                    ▼
              ┌──────────────────────────────────────────────┐
              │         CampusTopology  (26 buildings)        │
              │                                               │
              │  Outdoor · Auditorium · Hostel · Canteen      │
              │  Classroom/Lab · Library · Office             │
              │  Server Room                                  │
              │                                               │
              │  Each room carries: room_type · capacity      │
              │  sensor bundle [temperature / occupancy /     │
              │  energy]  (server_room: no occupancy)         │
              └─────────────────────┬────────────────────────┘
                                    │
                   ┌────────────────┼─────────────────┐
                   ▼                │                   │
          ┌────────────────┐        │                   │
          │  Zone Classes  │        │                   │
          │────────────────│        │                   │
          │ ClassroomZone  │◄───────┤  context dict     │
          │ CanteenZone    │        │  injected every   │
          │ LibraryZone    │        │  tick             │
          │ HostelZone     │        │                   │
          │ OutdoorZone    │        │                   │
          │ AuditoriumZone │        │                   │
          │ OfficeZone     │        │                   │
          │ ServerRoomZone │        │                   │
          │                │        │                   │
          │ _target_ratio()│        │                   │
          │  ↳ event fill  │        │                   │
          │  ↳ holiday/wknd│        │                   │
          │  ↳ acad state  │        │                   │
          │  ↳ time-of-day │        │                   │
          │  ↳ congestion  │        │                   │
          └──────┬─────────┘        │                   │
                 │                  │                   │
    ┌────────────▼──────────────────▼───────────────────▼──┐
    │                     SENSOR PASS 1                      │
    │  OccupancySensor — _apply_flow() limits Δcount to ±1  │
    │  per tick (probabilistic), value / capacity = ratio    │
    └─────────────────────────┬──────────────────────────────┘
                              │  occupancy_ratio fed back
    ┌─────────────────────────▼──────────────────────────────┐
    │                     SENSOR PASS 2                       │
    │                                                         │
    │  TemperatureSensor (OU process)   EnergySensor          │
    │  ─────────────────────────────    ─────────────────     │
    │  setpoint (room_type / HVAC)      base_load (type)      │
    │  + occ_heat_gain (×ratio)         + occ_load (×ratio)   │
    │  + equip_gain (building_id)       + equip (actvhours)   │
    │  + sinusoidal HVAC cycle          + standby (night)     │
    │  + night drift → outdoor ambient  + Gaussian noise      │
    │  + Gaussian noise (σ√dt-scaled)   SERVER: ~350 W const  │
    │  θ scaled by publish_interval_s                         │
    └─────────────────────────┬──────────────────────────────┘
                              │  SensorReading (JSON)
                              ▼
              ┌──────────────────────────────────────────────┐
              │         MQTTPublisher  (paho-mqtt)            │
              │  topic: campus/<building>/floor<n>/<room>/<t> │
              │  QoS 1 · auto-reconnect                       │
              └─────────────────────┬────────────────────────┘
                                    │
                                    ▼
                          Mosquitto MQTT Broker
```

---

## Module Responsibilities

| Module | Owns |
|--------|------|
| `campus/schedule.py` | **All** occupancy ratio functions + slot constants (single source of truth) |
| `campus/academic_calendar.py` | `AcademicDay`: congestion_fraction, activity type, lecture_scale, TUA, exam flags |
| `campus/events.py` | Deterministic event calendar (padura, food_festival, symposium, orientation, career_fair, workshop) → `active_venue_fill[building_id]` override dict |
| `campus/holidays.py` | SL public holidays 2023–2026, `is_holiday()` |
| `campus/topology.py` | 26-building physical layout — rooms, floors, capacities, sensor bundles |
| `zones/*.py` | Zone-specific `_target_ratio()` — consult schedule.py, apply academic + event context |
| `sensors/occupancy.py` | Stateful `_apply_flow()` — probabilistic ±1/tick convergence, capacity clamp |
| `sensors/temperature.py` | OU process, HVAC profiles, building heat offsets, dt-scaled θ and σ |
| `sensors/energy.py` | Base + occupancy + equipment load model; server room constant draw |
| `main.py` | Context assembly (2-pass: occupancy first → feed ratio to temp/energy) |
| `publisher.py` | MQTT client, QoS 1, auto-reconnect |

---

## Campus Building Floor Plan

> **Sensor bundle key:** `[T O E]` = temperature + occupancy + energy · `[T E]` = temp + energy (server rooms) · `[O]` = occupancy only (outdoor)

### Event Venues

| # | Building | ID | Floor | Room | Type | Cap | Sensors |
|---|----------|----|-------|------|------|----:|---------|
| 1 | Lagaan Outdoor Theater | `lagaan` | 1 | stage | outdoor | 700 | [O] |
| 2 | Multipurpose Hall | `multipurpose-hall` | 1 | main-hall | auditorium | 1 000 | [T O E] |
| 17 | NA1 & NA2 Lecture Halls | `na-hall` | 1 | na1 | auditorium | 300 | [T O E] |
|   |                          |          | 1 | na2 | auditorium | 300 | [T O E] |

### Hostels

| # | Building | ID | Floor | Room | Type | Cap | Sensors |
|---|----------|----|-------|------|------|----:|---------|
| 3 | Hostel A (Women's) | `hostel-a` | 1 | block | hostel | 200 | [T O E] |
| 12 | Hostel C | `hostel-c` | 1 | block | hostel | 500 | [T O E] |

### Canteens

| # | Building | ID | Floor | Room | Type | Cap | Sensors |
|---|----------|----|-------|------|------|----:|---------|
| 8 | Goda Canteen | `goda-canteen` | 1 | hall | canteen | 100 | [T O E] |
| 9 | Sentra Court | `sentra-court` | 1 | court | canteen | 100 | [T O E] |
| 10 | L Canteen | `l-canteen` | 1 | hall | canteen | 40 | [T O E] |
| 18 | Wala Canteen | `wala-canteen` | 1 | hall | canteen | 200 | [T O E] |

### Library

| # | Building | ID | Floor | Room | Type | Cap | Sensors |
|---|----------|----|-------|------|------|----:|---------|
| 26 | University Library | `library` | 1 | reading-hall | library | 400 | [T O E] |
|    |                    |           | 2 | study-area | library | 350 | [T O E] |
|    |                    |           | 3 | research-lounge | library | 250 | [T O E] |

### Engineering Departments

All standard academic buildings use the pattern per floor: **cls-a · cls-b · lab · office** (some have multiple labs).

| # | Building | ID | Floors | Classrooms / floor | Labs / floor | Cls cap | Lab cap | Office cap | Total cap |
|---|----------|----|--------|--------------------|--------------|--------:|--------:|-----------:|----------:|
| 4 | Textile & Clothing | `dept-textile` | 3 | 2 | 1 | 65 | 40 | 12 | 471 |
| 5 | Transport & Logistics | `dept-transport` | 3 | 2 | 1 | 65 | 30 | 12 | 441 |
| 6 | Civil Engineering | `dept-civil` | 3 | 2 | 1 | 80 | 40 | 12 | 576 |
| 16 | Electronics & Telecom Eng | `dept-ete` | 4 | 2 | 1 | 80 | 45 | 12 | 868 |
| 19 | Material Science & Eng | `dept-material` | 3 | 2 | 1 | 70 | 45 | 12 | 591 |
| 20 | Chemical & Process Eng | `dept-chemical` | 3 | 2 | 1 | 70 | 45 | 12 | 591 |
| 21 | Mechanical Engineering | `dept-mechanical` | 3 | 2 | 1 | 70 | 45 | 12 | 591 |

#### Dept of CS & Engineering — Sumanadasa Building (`sumanadasa`)

Floors 1, 3, 4 follow the standard pattern. Floor 2 reflects the actual CSE floor plan.

| Floor | Room ID | Type | Cap | Sensors |
|-------|---------|------|----:|---------|
| 1 | cls-a, cls-b | classroom | 100 each | [T O E] |
| 1 | lab | lab | 50 | [T O E] |
| 1 | office | office | 15 | [T O E] |
| **2** | seminar | classroom | 45 | [T O E] |
| **2** | sysco-lounge | classroom | 30 | [T O E] |
| **2** | open-area-n | classroom | 60 | [T O E] |
| **2** | open-area-s | classroom | 100 | [T O E] |
| **2** | studio | classroom | 20 | [T O E] |
| **2** | insight-hub | lab | 50 | [T O E] |
| **2** | l3-lab | lab | 50 | [T O E] |
| **2** | codegen-lab | lab | 40 | [T O E] |
| **2** | network-lab | lab | 35 | [T O E] |
| **2** | intellisense-lab | lab | 35 | [T O E] |
| **2** | ra-lab | lab | 35 | [T O E] |
| **2** | gtn-lab | lab | 40 | [T O E] |
| **2** | research-lab | lab | 45 | [T O E] |
| **2** | embedded-lab | lab | 30 | [T O E] |
| **2** | oldcodegen-lab | lab | 30 | [T O E] |
| **2** | hpc-lab | lab | 20 | [T O E] |
| **2** | instructor-room | office | 12 | [T O E] |
| **2** | ice-room | office | 20 | [T O E] |
| **2** | staff-room | office | 30 | [T O E] |
| **2** | server | server_room | — | [T E] |
| 3 | cls-a, cls-b | classroom | 100 each | [T O E] |
| 3 | lab | lab | 50 | [T O E] |
| 3 | office | office | 15 | [T O E] |
| 4 | cls-a, cls-b | classroom | 100 each | [T O E] |
| 4 | lab | lab | 50 | [T O E] |
| 4 | office | office | 15 | [T O E] |

### Faculties

| # | Building | ID | Floors | Cls/floor | Labs/floor | Cls cap | Lab cap | Office cap | Total cap |
|---|----------|----|--------|-----------|------------|--------:|--------:|-----------:|----------:|
| 11 | Faculty of IT | `faculty-it` | 4+server | 2 | 2 | 120 | 60 | 15 | 1 500 |
| 13 | Faculty of Business Science | `faculty-business` | 4 | 2 | — | 100 | — | 15 | 860 |
| 15 | Faculty of Medicine | `faculty-medicine` | 4 | 2 | 1 | 75 | 35 | 12 | 788 |
| 24 | Dept of Integrated Design | `dept-design` | 5 | 2 | 2 (studios) | 100 | 50 | 15 | 1 575 |
| 25 | Faculty of Graduate Studies | `faculty-grad` | 3 | 2 | 1 | 50 | 30 | 15 | 435 |

> Faculty IT has a server room on floor 5 (`[T E]` only, no occupancy sensor).  
> Weekend classes run in `faculty-it` and `dept-design` only.

### Admin & Support

| # | Building | ID | Floor | Room | Type | Cap | Sensors |
|---|----------|----|-------|------|------|----:|---------|
| 14 | Dept of Mathematics | `dept-maths` | 1 | cls-a, cls-b | classroom | 35 each | [T O E] |
|    |                     |              | 1 | office | office | 15 | [T O E] |
|    |                     |              | 2 | cls-c | classroom | 35 | [T O E] |
|    |                     |              | 2 | office-b | office | 10 | [T O E] |
| 22 | Registrar & Examination | `registrar` | 1 | exam-hall | classroom | 150 | [T O E] |
|    |                          |             | 1 | office-a, office-b | office | 25 each | [T O E] |
| 23 | Admin Building | `admin` | 1 | office-a, office-b | office | 30 each | [T O E] |
|    |                |         | 2 | office-c, office-d, office-e | office | 30 each | [T O E] |

---

## Zone Occupancy Rates

### Time-of-Day Reference (normal weekday academic day)

> All values are `_target_ratio` outputs before `_apply_flow` smoothing.  
> Actual sensor readings converge toward target at ±1 person/tick — no instantaneous jumps.

| Time window | Classroom / Lab | Canteen | Library | Hostel | Outdoor | Auditorium | Office |
|-------------|:---------:|:-------:|:-------:|:------:|:-------:|:----------:|:------:|
| 00:00–06:00 | 0 % | 0 % | 0 % | **90 %** | 0 % | 0 % | 0 % |
| 06:00–07:00 | 0 % | 0 % | 0 % | **85 %** | 0 % | 0 % | 0 % |
| 07:00–07:30 | 0 % | 3 % | 0 % | 85 % | 0 % | 0 % | 0 % |
| 07:30–08:15 | ramp 0→88 % | **95 %** (breakfast) | 0 % | 85→20 % | 0 % | 0 % | 0 % |
| 08:00–08:15 | pre-ramp | 95→2 % | opens 12 % | 20 % | 0 % | 0 % | ramp up |
| **08:15–10:10** | **88 %** (slot 1) | 2 % | 12 % | **20 %** | ~0 % | 0 % * | **80 %** |
| **10:10–10:15** | ~70 % dip † | **65 %** (tea) | **25 %** | 20 % | ~0 % | 0 % | 80 % |
| **10:15–12:15** | **88 %** (slot 2) | 65→2 % | 12 % | **20 %** | ~0 % | 0 % * | **80 %** |
| 12:15–13:15 | drain→0 % | **98 %** (lunch) | **55 %** | 20 % | small | 0 % | **25 %** |
| **13:15–15:10** | **88 %** (slot 3) | 2 % | 12 % | **20 %** | ~0 % | 0 % * | **80 %** |
| **15:10–15:15** | ~70 % dip † | **55 %** (tea) | **25 %** | 20 % | ~0 % | 0 % | 80 % |
| **15:15–17:15** | **88 %** (slot 4) | 55→2 % | 12 % | **20 %** | ~0 % | 0 % * | **80 %** |
| 17:15–17:30 | drain→0 % | **30 %** (dinner) | **70 %** | 20 % | ~0 % | 0 % | drain→0 % |
| 17:30–19:30 | 0 % | 30 % tapering | **70 %** | 20→90 % | ~0 % | 0 % | 0 % |
| 19:30–21:00 | 0 % | 0 % | **70 %** | 70→90 % | 0 % | 0 % | 0 % |
| 21:00–22:00 | 0 % | 0 % | drain→0 % | **90 %** | 0 % | 0 % | 0 % |
| 22:00–24:00 | 0 % | 0 % | 0 % | **90 %** | 0 % | 0 % | 0 % |

> **†** 10:10–10:15 and 15:10–15:15 are slot-transition dips. `lecture_ratio()` uses `max()` over all slots so the
> crossover is smooth (~70 % valley, not 0 %). Students move between rooms; canteen simultaneously spikes.  
> **\*** Auditorium activates for ~15 % of lecture slots (large batch lectures) → 55–90 % when used.

### Academic State Modifiers

All base ratios above are further multiplied or replaced by the academic calendar state:

| State | `congestion_fraction` | Classroom | Canteen | Library | Hostel (day) | Office |
|-------|-----------------------:|-----------|---------|---------|:------------:|--------|
| **AW** (active week) | 0.85–1.0 | base × `lecture_scale` | base × cf | base × cf | 20 % | base |
| **EXAM** | 0.75–0.90 | `exam_ratio` (0→95 %) | base × cf | **85 %** fixed | 20 % | +10 % |
| **TUA** (strike) | 0.05–0.15 | **0 %** | base × cf | base × cf | stay-in | **0 %** |
| **VAC / MARK** | 0.05–0.10 | **0 %** | max(5 %, base×0.30) | base × 0.05 × cf | **55 %** | **5 %** |
| **RB / MSB / IS** (low-attend) | 0.20–0.55 | base × `lecture_scale` | base × cf | base × 0.80 × cf | 20 % | base |
| **IT** (industry training) | 0.40–0.60 | base × `lecture_scale` | base × cf | base × cf | 20 % | base |
| **Holiday** | — | **0 %** | 15 % | 20 % | 70 % | **5 %** |
| **Weekend** (non-IT/Design) | — | **0 %** | base×0.40 | base×0.55 | 45 % (day) | **5 %** |
| **Weekend** (IT, Design) | — | same as weekday | base×0.40 | base×0.55 | 45 % | 5 % |

> `cf` = `congestion_fraction` from `AcademicCalendar`  
> `lecture_scale` = per-period scalar applied on top of the time-of-day ratio

### Event Overrides

When `active_venue_fill[building_id]` is set by `EventCalendar`, it **fully overrides** `_target_ratio` for that building. Typical fill ratios by event type:

| Event type | Primary venue | Fill ratio |
|------------|---------------|:----------:|
| Padura (inter-uni games) | `lagaan` | 0.80–1.0 |
| Concert | `lagaan` / `multipurpose-hall` | 0.90 |
| Symposium | `multipurpose-hall` | 0.70 |
| Food festival | `lagaan` / canteen cluster | 0.85 |
| Orientation | `multipurpose-hall` / `na-hall` | 0.75 |
| Career fair | `multipurpose-hall` | 0.65 |
| Sports meet | `lagaan` | 0.85 |
| Workshop | dept buildings | 0.50 |

---

## Context Priority Chain (Occupancy)

```
active_venue_fill[building_id] present?
    YES → use event fill ratio                      ← highest priority
    NO  ↓
is_holiday?
    YES → zone-specific holiday fraction (5–20 %)
    NO  ↓
is_weekend?
    YES (non-IT/Design) → 0 % classrooms, reduced others
    YES (IT / Design)   → normal lecture pattern
    NO  ↓
is_essentially_empty? (VAC, MARK)
    YES → near-zero or skeleton crew                ← offices 5 %, hostels 55 %
    NO  ↓
is_exam_period?
    YES → exam_ratio (0→95 %), library 85 %
    NO  ↓
is_low_attendance? (RB, MSB, IS, AW_OL)
    YES → base × 0.80 × congestion_fraction         ← library/hostel pattern
    NO  ↓
tua_active?
    YES → 0 % classrooms / offices                  ← canteen / hostel unaffected
    NO  ↓
lecture_ratio(hour) × lecture_scale × congestion_fraction
    ↓
_apply_flow() — probabilistic ±1/tick convergence
    entry probability ∝ deficit / (capacity × 1.5)
    exit  probability ∝ surplus / (capacity × 1.0)
    → total campus headcount changes only gradually;
      large simultaneous shifts are physically damped
```

---

## Sensor Physics Notes

### Temperature (Ornstein-Uhlenbeck)
```
HVAC on  : T[t+1] = T[t] + θ_hvac × dt_scale × (T_setpoint + cycle + occ_heat − T[t])
                          + σ × √dt_scale × N(0,1)
HVAC off : same formula with θ_night (slower) and T_target = outdoor_ambient(hour)
```
- `θ_hvac = 0.12`, `θ_night = 0.04` (calibrated at `publish_interval_s = 5 s`)
- `dt_scale = publish_interval_s / 5.0` → physics correct at any tick rate
- Server rooms: precision cooling, fixed 20–22 °C sinusoidal ± 0.5 °C

### Energy Model
```
Active hours (08:15–17:15):  P = base + 250 W × occ_ratio + 150 W × occ_ratio + noise
Standby (empty, off-hours):  P ≈ 20 W
Server room:                  P ≈ 350 W constant (24/7 with load cycle)
```
Building-specific equipment offsets add to temperature setpoint (e.g. `dept-chemical` +2.5 °C, `dept-mechanical` +1.5 °C).
