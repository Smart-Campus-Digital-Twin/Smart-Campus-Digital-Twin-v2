---
name: Smart Campus Digital Twin v2 — Project Overview
description: University of Moratuwa campus IoT simulator with a full data pipeline being built out
type: project
---

A smart campus digital twin for the University of Moratuwa. The existing codebase is a Python MQTT simulator (~200 msg/sec, 5-sec tick) that models 26 buildings with temperature, occupancy, and energy sensors.

The full pipeline plan is documented in PIPELINE_ARCHITECTURE.md at the repo root.

**What exists:**
- `simulator/` — Python MQTT publisher with realistic sensor physics (HVAC hysteresis, burst-fill occupancy, per-type standby energy)
- `shared/models.py` — Pydantic `SensorReading` dataclass, MQTT topic format `campus/<building>/f<n>/<room>/<type>`
- Single Dockerfile for the simulator

**What is planned (PIPELINE_ARCHITECTURE.md):**
- Bridge (MQTT → Kafka), Flink real-time jobs, Spark + Airflow batch, FastAPI, Grafana

**Why:** Build out the downstream pipeline from the MQTT broker through to dashboards, batch reports, and an ML feature store.
