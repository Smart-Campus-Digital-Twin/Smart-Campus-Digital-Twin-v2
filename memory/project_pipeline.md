---
name: Pipeline Stack Decisions
description: Chosen tech stack and rationale for the Smart Campus data pipeline
type: project
---

Key decisions for the IoT data pipeline:

- **InfluxDB 2.7 OSS** (not 3.x — 3.0 Core alpha is slower at <1M cardinality; 2.7 is production-stable)
- **PostgreSQL 16** for relational data: metadata, daily reports, anomaly audit, ML features
- Dual-store: InfluxDB for all time-series queries (hot + warm path), PostgreSQL for joins/reports (cold path)
- **Flink 1.20** + flink-connector-kafka for real-time (~1–2 s E2E latency, 1-s checkpoint interval)
- **PySpark 3.5 + Airflow 3.x** (released Apr 2025, Airflow 2.x EOL Apr 2026) for batch
- **Custom Python bridge** (aiokafka + Pydantic) — 200 msg/sec is trivial, no need for Strimzi
- Kafka **KRaft mode** (no Zookeeper), 3 partitions/topic, keyed by `building_id`
- Partition key = `building_id` (not sensor_id) — locality for Flink windowed aggregations
- InfluxDB buckets: `campus_raw` (7d), `campus_1m` (30d), `campus_1h` (1y), `campus_1d` (5y)

**Why:** InfluxDB is 5–20× faster than PostgreSQL for time-range sensor queries; PostgreSQL handles joins and structured reports. This is the standard pattern for IoT platforms.
