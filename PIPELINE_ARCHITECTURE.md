# Pipeline Architecture — Smart Campus Digital Twin

## Overview

The Smart Campus Digital Twin is a complete IoT data pipeline for the University of Moratuwa campus. It simulates 26 buildings with temperature, occupancy, and energy sensors, processing data through a multi-stage pipeline from ingestion to visualization.

**Data Flow:** Simulator → MQTT → Kafka → Flink (real-time) → InfluxDB/PostgreSQL → Spark + Airflow (batch) → FastAPI → Grafana

---

## Architecture Layers

### Layer 1: Data Generation (Simulator)
**Technology:** Python 3.x, Mosquitto MQTT 2.0

The simulator generates realistic sensor readings every 5 seconds based on academic schedules:
- **Sensor Types:** Temperature, Occupancy, Energy
- **MQTT Topics:** `campus/<building>/f<n>/<room>/<sensor_type>`
- **Output:** JSON messages with timestamp, building_id, room_id, sensor_type, value, quality

**Example Message:**
```json
{
  "timestamp": "2025-05-03T14:30:00Z",
  "building_id": "EF",
  "room_id": "EF101",
  "sensor_type": "temperature",
  "value": 26.4,
  "quality": 1.0
}
```

---

### Layer 2: Message Broker (MQTT)
**Technology:** Eclipse Mosquitto 2.0

- **Port:** 1883 (bound to 127.0.0.1)
- **Authentication:** Username/password via environment variables
- **QoS:** QoS-1 for at-least-once delivery
- **Role:** Lightweight message router for IoT devices

---

### Layer 3: Protocol Bridge (MQTT → Kafka)
**Technology:** Python, aiokafka, Pydantic, paho-mqtt

**Process:**
1. Subscribes to `campus/#` MQTT topics
2. Validates JSON using Pydantic `SensorReading` model
3. Routes to Kafka topics based on sensor_type:
   - `temperature` → `sensors.temperature`
   - `occupancy` → `sensors.occupancy`
   - `energy` → `sensors.energy`
4. Invalid messages go to `sensors.dlq` (dead-letter queue)
5. Uses `building_id` as Kafka partition key for locality

---

### Layer 4: Message Backbone (Kafka)
**Technology:** Apache Kafka 3.7.1 (KRaft mode, no Zookeeper)

**Topics:**
- `sensors.temperature` — 3 partitions, 7-day retention
- `sensors.occupancy` — 3 partitions, 7-day retention
- `sensors.energy` — 3 partitions, 7-day retention
- `sensors.aggregated` — 3 partitions, 7-day retention
- `sensors.dlq` — 1 partition, 7-day retention
- `alerts.anomalies` — 1 partition, 7-day retention

**Port:** 9092 (bound to 127.0.0.1)

**Key Design:** Partition key = `building_id` ensures same-building data stays together for efficient aggregations.

---

### Layer 5: Real-Time Processing (Apache Flink)
**Technology:** Apache Flink 1.20, PyFlink

**Container:** `campus-flink-jm` (jobmanager), `campus-flink-tm` (taskmanager)

**Port:** 8081 (Flink Web UI), 9249 (Prometheus metrics)

**Jobs:**

#### Job 1: KafkaToInfluxJob (`kafka_to_influx.py`)
- **Input:** All sensor topics from Kafka
- **Process:** Minimal transformation, adds floor number from room_id
- **Batching:** 200 points or 500ms (whichever first)
- **Output:** InfluxDB `campus_raw` bucket (7-day retention)
- **Latency:** Sub-second

#### Job 2: WindowAggJob (`window_agg.py`)
- **Input:** All sensor topics from Kafka
- **Process:** 1-minute tumbling windows by (room_id, sensor_type)
- **Aggregations:** min, max, avg, stddev, sample_count
- **Allowed Lateness:** 30 seconds for late-arriving data
- **Output:** InfluxDB `campus_1m` bucket (30-day retention)
- **Data Reduction:** ~60x compression vs raw

#### Job 3: AnomalyJob (`anomaly.py`)
- **Input:** All sensor topics from Kafka
- **Rules:**
  - `temp_high`: temperature > 38°C
  - `temp_low`: temperature < 14°C
  - `occ_over_capacity`: occupancy > room capacity × 1.05 (PostgreSQL lookup)
  - `energy_spike`: energy > 3× 5-minute rolling average
  - `sensor_dropout`: gap > 2× publish interval
- **Output:**
  - Kafka topic `alerts.anomalies` (real-time)
  - PostgreSQL `anomalies` table (audit trail via JDBC)

---

### Layer 6: Time-Series Storage (InfluxDB)
**Technology:** InfluxDB 2.7 OSS

**Port:** 8086 (bound to 127.0.0.1)

**Buckets:**
- `campus_raw` — 7 days (raw readings from Flink Job 1)
- `campus_1m` — 30 days (1-minute aggregations from Flink Job 2)
- `campus_1h` — 1 year (hourly roll-ups from Spark)
- `campus_1d` — 5 years (daily roll-ups from Spark)

**Storage Engine:** TSM with time-series specific compression
**Query Language:** Flux / InfluxQL

---

### Layer 7: Relational Storage (PostgreSQL)
**Technology:** PostgreSQL 16

**Port:** 5432 (bound to 127.0.0.1)

**Databases:**
- `campus` — Application data
- `airflow` — Airflow metadata

**Tables:**
- `buildings` — Static campus building metadata
- `rooms` — Static room metadata with capacity, type
- `anomalies` — Anomaly audit log from Flink
- `energy_daily` — Daily energy reports from Spark
- `ml_features` — Weekly ML feature table from Spark

---

### Layer 8: Batch Processing (Spark + Airflow)
**Technology:** PySpark 3.5, Apache Airflow 3.x

**Airflow:**
- **Port:** 8082 (Web UI, mapped from 8080)
- **Executor:** LocalExecutor
- **Scheduler:** Triggers DAGs on schedule

**Spark:**
- **Master Port:** 7077 (Spark master)
- **Web UI Port:** 8080 (Spark master UI)
- **Role:** Batch aggregations and feature engineering

#### Hourly Rollup (InfluxDB Flux Task)
- **Schedule:** Every hour at :05 (native InfluxDB task)
- **Flux Task:** `downsample_1m_to_1h.flux`
- **Input:** InfluxDB `campus_1m` for previous hour
- **Output:** InfluxDB `campus_1h` bucket
- **Aggregation:** 60 one-minute points → 1 hourly point (min, max, avg, sum)
- **Note:** Replaced Spark job (kept as backup: `hourly_rollup.py.DISABLED`)

#### DAG 1: Daily Energy Report (`daily_reports_dag.py`)
- **Schedule:** `0 0 30 * * *` (00:30 daily)
- **Spark Job:** `daily_energy_report.py`
- **Input:** InfluxDB `campus_1h` for previous 24 hours
- **Output:** PostgreSQL `energy_daily` table
- **Metrics:** total_kwh, peak_w, avg_w per building

#### DAG 2: Weekly ML Features (`weekly_features_dag.py`)
- **Schedule:** `0 0 2 * * 1` (Monday 02:00)
- **Spark Job:** `weekly_ml_features.py`
- **Input:** InfluxDB `campus_1h` (7 days) + PostgreSQL `rooms`
- **Output:** PostgreSQL `ml_features` table
- **Features:** avg_occ_ratio, peak_occ_hour, avg_temp_c, total_energy_kwh

---

### Layer 9: Observability (Prometheus + Exporters)
**Technology:** Prometheus 2.55.1, Kafka Exporter, Postgres Exporter

**Prometheus:**
- **Port:** 9090
- **Retention:** 30 days
- **Config:** Scrape targets for Flink, Kafka, Postgres

**Exporters:**
- `kafka-exporter` — Kafka metrics (port 9187, internal)
- `postgres-exporter` — PostgreSQL metrics (port 9187, internal)

**Scraped Services:**
- Flink JobManager (port 9249)
- Kafka Exporter (port 9187)
- Postgres Exporter (port 9187)

---

### Layer 10: API Gateway (FastAPI)
**Technology:** FastAPI, uvicorn, asyncpg, influxdb-client

**Port:** 8000 (bound to 127.0.0.1)

**Routers:**

#### `/metrics` — InfluxDB queries (real-time)
- `GET /metrics/live/{building_id}?range_minutes=5` — Latest readings per sensor
- `GET /metrics/history/{room_id}?start=&stop=&resolution=1h` — Aggregated history
- `GET /metrics/aggregate/{building_id}?window=5m` — Building-level aggregations

#### `/reports` — PostgreSQL queries (batch)
- `GET /reports/energy?start=2025-01-01` — Daily energy reports

#### `/alerts` — PostgreSQL queries
- `GET /alerts?building_id=EF` — Anomaly history

#### `/buildings` — PostgreSQL metadata
- `GET /buildings` — Building list
- `GET /buildings/{building_id}/rooms` — Rooms in building

#### `/health` — Health check
- `GET /health` — Service health status

**Features:**
- Async I/O for high concurrency
- Pydantic validation on all responses
- OpenAPI docs at `/docs`

---

### Layer 11: API Gateway (Kong)
**Technology:** Kong Gateway

**Role:** API gateway for external routing and rate limiting (optional layer)
- **Config:** `infra/kong/kong.yml`

---

### Layer 12: Visualization (Grafana)
**Technology:** Grafana 11.4.0

**Port:** 3000 (exposed to all interfaces)

**Dashboard:** `campus_overview.json`
- Live sensor readings from InfluxDB `campus_raw`
- Aggregated metrics from InfluxDB `campus_1m`
- Anomaly counts from PostgreSQL
- Energy trends from PostgreSQL `energy_daily`

**Refresh:** 5-30 seconds depending on panel

**Data Sources:**
- InfluxDB (direct connection)
- PostgreSQL (direct connection)
- Prometheus (for infrastructure metrics)

---

## Container Services (docker-compose.yml)

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `mosquitto` | eclipse-mosquitto:2.0 | 1883 | MQTT broker |
| `kafka` | apache/kafka:3.7.1 | 9092 | Message backbone |
| `kafka-init` | apache/kafka:3.7.1 | - | Topic creation (one-shot) |
| `influxdb` | influxdb:2.7 | 8086 | Time-series DB |
| `influxdb-init` | influxdb:2.7 | - | Bucket setup (one-shot) |
| `postgres` | postgres:16 | 5432 | Relational DB |
| `bridge` | ./bridge | - | MQTT → Kafka translation |
| `flink-jobmanager` | custom | 8081, 9249 | Flink master |
| `flink-taskmanager` | custom | - | Flink worker |
| `flink-submit` | custom | - | Job submission (one-shot) |
| `spark-master` | custom | 8080, 7077 | Spark master |
| `spark-worker` | custom | - | Spark worker |
| `airflow` | custom | 8082 | Batch scheduler |
| `api` | custom | 8000 | REST API |
| `grafana` | grafana/grafana:11.4.0 | 3000 | Dashboards |
| `prometheus` | prom/prometheus:v2.55.1 | 9090 | Metrics store |
| `kafka-exporter` | danielqsj/kafka-exporter:v1.8.0 | 9187 | Kafka metrics |
| `postgres-exporter` | prometheuscommunity/postgres-exporter:v0.15.0 | 9187 | Postgres metrics |
| `simulator` | custom | - | Data generator |

---

## Network Architecture

**Network:** `campus` bridge network

All services communicate using container names (DNS resolution):
- `simulator` → `mosquitto:1883`
- `bridge` → `mosquitto:1883` and `kafka:9092`
- `flink-*` → `kafka:9092`, `influxdb:8086`, `postgres:5432`
- `spark-*` → `postgres:5432`, `influxdb:8086`, `kafka:9092`
- `airflow` → `postgres:5432`, `influxdb:8086`, `spark-master:7077`
- `api` → `influxdb:8086`, `postgres:5432`
- `grafana` → `influxdb:8086`, `postgres:5432`, `prometheus:9090`
- `prometheus` → `flink-jobmanager:9249`, `kafka-exporter:9187`, `postgres-exporter:9187`

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA GENERATION LAYER                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Simulator (Python)                                                          │
│    ↓ MQTT (campus/<building>/f<n>/<room>/<type>)                             │
│  Mosquitto (1883)                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MESSAGE TRANSPORT LAYER                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Bridge Service                                                              │
│    ↓ Pydantic validation → route by sensor_type                             │
│  Kafka (9092)                                                                │
│    Topics: sensors.temperature, sensors.occupancy, sensors.energy            │
│           sensors.dlq, alerts.anomalies                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
        ┌───────────────────────────┴───────────────────────────┐
        │                                                           │
┌───────▼──────────────────┐                    ┌────────────────▼──────────┐
│   REAL-TIME PROCESSING    │                    │   BATCH PROCESSING         │
├───────────────────────────┤                    ├───────────────────────────┤
│ Flink Cluster             │                    │ Airflow Scheduler          │
│ ├─ KafkaToInfluxJob       │                    │ ├─ Daily Energy DAG        │
│ │  → InfluxDB campus_raw  │                    │ │  → Spark daily_report    │
│ │                         │                    │ │  → PostgreSQL            │
│ ├─ WindowAggJob (1-min)   │                    │ ├─ Weekly Features DAG    │
│ │  → InfluxDB campus_1m   │                    │ │  → Spark weekly_features │
│ │                         │                    │ │  → PostgreSQL energy_daily│
│ └─ AnomalyJob (CEP)       │                    │ └─ Weekly Features DAG     │
│    → Kafka alerts.anomalies│                    │    → Spark weekly_features │
│    → PostgreSQL anomalies │                    │    → PostgreSQL ml_features│
└───────────────────────────┘                    └───────────────────────────┘
        │                                                           │
        └───────────────────┬───────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────▼────────────────┐          ┌───────────▼────────────────┐
│   TIME-SERIES STORAGE  │          │   RELATIONAL STORAGE       │
├────────────────────────┤          ├───────────────────────────┤
│ InfluxDB 2.7 (8086)    │          │ PostgreSQL 16 (5432)       │
│ ├─ campus_raw (7 d)     │          │ ├─ buildings               │
│ ├─ campus_1m (30 d)     │          │ ├─ rooms                   │
│ ├─ campus_1h (1 y)      │          │ ├─ anomalies               │
│ └─ campus_1d (5 y)      │          │ ├─ energy_daily             │
└────────────────────────┘          │ └─ ml_features             │
        │                         └───────────────────────────┘
        │                                       │
        └───────────────────┬───────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API LAYER                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  FastAPI (8000)                                                              │
│  ├─ /metrics/* → InfluxDB queries                                           │
│  ├─ /reports/* → PostgreSQL queries                                          │
│  ├─ /alerts/* → PostgreSQL queries                                           │
│  └─ /buildings/* → PostgreSQL metadata                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VISUALIZATION & OBSERVABILITY                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Grafana (3000)              Prometheus (9090)                               │
│  └─ Campus Overview         └─ Scrapes: Flink, Kafka, Postgres              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Environment Variables

Required environment files in `env/`:
- `mosquitto.env` — MQTT credentials
- `kafka.env` — Kafka bootstrap servers, partitions, retention
- `influxdb.env` — InfluxDB URL, token, org, buckets
- `postgres.env` — PostgreSQL credentials, database URLs
- `airflow.env` — Airflow admin credentials, Fernet key
- `api.env` — API-specific settings
- `grafana.env` — Grafana admin credentials

---

## Startup Order

```
1. mosquitto (MQTT broker)
2. kafka (message backbone)
3. influxdb (time-series DB)
4. postgres (relational DB)
5. bridge (MQTT→Kafka translation)
6. flink-jobmanager (real-time processing master)
7. flink-taskmanager (real-time processing worker)
8. flink-submit (submit Flink jobs, one-shot)
9. spark-master (batch processing master)
10. spark-worker (batch processing worker)
11. airflow (batch scheduler)
12. api (REST API)
13. grafana (dashboards)
14. prometheus (metrics)
15. kafka-exporter, postgres-exporter (metrics exporters)
```

Health checks ensure dependencies are healthy before dependent services start.

---

## Access URLs (localhost)

| Service | URL | Purpose |
|---------|-----|---------|
| Grafana | http://localhost:3000 | Dashboards |
| Flink Web UI | http://localhost:8081 | Flink job monitoring |
| Spark Web UI | http://localhost:8080 | Spark job monitoring |
| Airflow Web UI | http://localhost:8082 | DAG monitoring |
| Prometheus | http://localhost:9090 | Metrics browser |
| InfluxDB UI | http://localhost:8086 | Time-series queries |
| FastAPI | http://localhost:8000 | REST API (docs at /docs) |
| PostgreSQL | localhost:5432 | Database connection |
| Kafka | localhost:9092 | Message broker |
| MQTT | localhost:1883 | MQTT broker |

---

## Technology Stack Summary

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Simulator | Python | 3.x | Flexible, academic calendar integration |
| MQTT | Mosquitto | 2.0 | Lightweight IoT standard |
| Message Transport | Kafka | 3.7.1 (KRaft) | Durable, partitioned, replay capability |
| Real-time Processing | Flink | 1.20 | Exactly-once, sub-second latency |
| Batch Processing | Spark | 3.5 | Efficient large-scale aggregations |
| Orchestration | Airflow | 3.x | Mature DAG scheduler |
| Time-Series DB | InfluxDB | 2.7 OSS | Purpose-built TSDB, Grafana integration |
| Relational DB | PostgreSQL | 16 | ACID compliance, complex queries |
| API | FastAPI | 0.115 | Async, auto-docs, Pydantic validation |
| API Gateway | Kong | Latest | Routing, rate limiting (optional) |
| Visualization | Grafana | 11.4.0 | Industry standard dashboards |
| Metrics | Prometheus | 2.55.1 | Metrics aggregation |
| Exporters | Kafka/Postgres | Latest | Metrics exposure |

---

## Key Design Decisions

### Dual-Store Architecture
- **InfluxDB:** All time-series data (raw, 1m, 1h, 1d) — 5-20× faster for time-range queries
- **PostgreSQL:** Relational data (metadata, anomalies, reports, ML features) — joins, constraints, ACID

### Kafka Partitioning
- Partition key = `building_id` (not sensor_id)
- Ensures same-building data stays together for Flink windowed aggregations
- 3 partitions per topic (sufficient for 200 msg/sec, scale to 8-16 for production)

### Retention Strategy
- Kafka: 7 days (buffer for consumer lag)
- InfluxDB: Tiered (7d raw, 30d 1m, 1y 1h, 5y 1d)
- PostgreSQL: Indefinite (metadata, audit logs)

### Real-time vs Batch
- **Real-time (Flink):** Raw ingestion, 1-minute aggregations, anomaly detection
- **Batch (Spark + Airflow):** Hourly/daily/weekly roll-ups, feature engineering
- Cost-effective: Batch jobs run periodically, not always-on

---

## Latency Budget

| Segment | Target |
|---------|--------|
| Simulator → MQTT | < 10 ms |
| MQTT → Kafka (bridge) | < 50 ms |
| Kafka → Flink → InfluxDB (raw) | ≤ 1.5 s |
| InfluxDB → Grafana | ≤ 500 ms |
| **Total (sensor → dashboard)** | **≤ 2.5 s** |

---

## Production Considerations

### Scaling
- **Kafka:** Add partitions (8-16) and brokers (3 for replication factor 3)
- **Flink:** Add task managers for parallelism
- **Spark:** Scale workers dynamically
- **PostgreSQL:** Read replicas for query load
- **InfluxDB:** Clustering for HA (or InfluxDB Cloud)

### High Availability
- **Kafka:** Replication factor 3 with 3 brokers
- **Flink:** Standby jobmanagers
- **Airflow:** CeleryExecutor with multiple workers
- **PostgreSQL:** Streaming replication
- **InfluxDB:** Clustering or cloud-managed

### Security
- Replace hardcoded tokens with Vault or Kubernetes Secrets
- Enable TLS for all inter-service communication
- Network policies for service-to-service access
- Authentication/authorization for API endpoints

### Monitoring
- Prometheus metrics for all services
- Alerting on consumer lag, job failures, anomaly spikes
- Log aggregation (ELK/Loki) for debugging

---

## Directory Structure

```
Smart-Campus-Digital-Twin-v2/
├── simulator/                    # Data generator
│   ├── campus/                   # Campus models
│   ├── sensors/                  # Sensor implementations
│   ├── zones/                    # Room zone logic
│   └── Dockerfile
├── bridge/                       # MQTT → Kafka translation
│   ├── main.py
│   ├── config.py
│   └── Dockerfile
├── processing/
│   ├── flink/                    # Real-time processing
│   │   ├── jobs/
│   │   │   ├── kafka_to_influx.py
│   │   │   ├── window_agg.py
│   │   │   └── anomaly.py
│   │   ├── Dockerfile
│   │   └── config.py
│   └── spark/                    # Batch processing
│       ├── jobs/
│       │   ├── hourly_rollup.py.DISABLED  # Replaced by Flux task
│       │   ├── daily_energy_report.py
│       │   └── weekly_ml_features.py
│       ├── Dockerfile
│       └── config.py
├── airflow/                      # Batch orchestration
│   ├── dags/
│   │   ├── hourly_rollup_dag.py.DISABLED  # Replaced by Flux task
│   │   ├── daily_reports_dag.py
│   │   ├── weekly_features_dag.py
│   │   └── callbacks.py
│   └── requirements.txt
├── api/                          # REST API
│   ├── routers/
│   │   ├── metrics.py
│   │   ├── reports.py
│   │   ├── alerts.py
│   │   ├── buildings.py
│   │   └── health.py
│   ├── clients/
│   │   ├── influx.py
│   │   └── postgres.py
│   ├── schemas/
│   │   └── responses.py
│   ├── main.py
│   ├── config.py
│   └── Dockerfile
├── shared/                       # Shared code
│   ├── models.py                 # Pydantic models
│   ├── db.py                     # Database utilities
│   ├── schemas/
│   │   ├── aggregation.py
│   │   └── anomaly.py
│   └── logging_config.py
├── infra/                        # Infrastructure config
│   ├── mosquitto/
│   ├── influxdb/
│   │   ├── setup.sh
│   │   └── tasks/
│   ├── postgres/
│   │   └── init.sql
│   ├── flink/
│   │   └── flink-conf.yaml
│   ├── spark/
│   │   └── Dockerfile
│   ├── grafana/
│   │   ├── provisioning/
│   │   └── dashboards/
│   ├── prometheus/
│   │   └── prometheus.yml
│   └── kong/
│       └── kong.yml
├── env/                          # Environment files
│   ├── mosquitto.env.example
│   ├── kafka.env.example
│   ├── influxdb.env.example
│   ├── postgres.env.example
│   ├── airflow.env.example
│   ├── api.env.example
│   └── grafana.env.example
├── tests/                        # Test suite
├── ml/                           # ML utilities
├── docker-compose.yml             # Full stack
├── Makefile                      # Common commands
└── PIPELINE_ARCHITECTURE.md      # This file
```

---

## Quick Start

```bash
# 1. Configure environment
cp env/*.env.example env/*.env
# Edit env/*.env with real values

# 2. Start all services
make up

# 3. View logs
make logs

# 4. Access dashboards
# Grafana: http://localhost:3000
# Flink: http://localhost:8081
# Airflow: http://localhost:8082

# 5. Stop services
make down
```

---

## Maintenance

### Manual Hourly Rollup
**DEPRECATED:** Hourly rollup now runs as native InfluxDB Flux task (`downsample_1m_to_1h.flux`).
No manual intervention needed. Old Spark-based script kept for reference.

### Resetting Data
```bash
# Clear all data (volumes persist)
docker-compose down -v
docker-compose up
```

### Viewing Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f flink-jobmanager
docker-compose logs -f airflow
```

---

## Troubleshooting

### Flink jobs not starting
- Check `flink-submit` logs: `docker-compose logs flink-submit`
- Verify Kafka topics exist: `docker exec campus-kafka kafka-topics.sh --list --bootstrap-server localhost:9092`
- Check Flink Web UI at http://localhost:8081

### Airflow DAGs not running
- Check Airflow logs: `docker-compose logs airflow`
- Verify Spark master is healthy: `curl http://localhost:8080`
- Check DAG files are mounted: `docker exec campus-airflow ls /opt/airflow/dags`

### InfluxDB connection errors
- Verify token in `env/influxdb.env`
- Check bucket exists: `docker exec campus-influxdb influx bucket list`
- Verify InfluxDB is healthy: `docker-compose ps influxdb`

### Grafana no data
- Check data source configuration in Grafana UI
- Verify InfluxDB/PostgreSQL credentials
- Check Prometheus targets are up at http://localhost:9090/targets

---

## License

University of Moratuwa Smart Campus Digital Twin Project
