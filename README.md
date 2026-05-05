# Smart Campus Digital Twin

Real-time IoT monitoring system with 3D visualization, ML predictions, and anomaly detection.

## Quick Start

```bash
# 1. Setup environment files
make env
# Edit env/*.env files with your values (or use defaults)

# 2. Start all services
make up

# 3. Wait ~2 minutes for initialization
# Check status: make ps
```

## Access UIs

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | http://localhost:3001 | 3D campus visualization |
| **Grafana** | http://localhost:3000 | Dashboards & metrics |
| **API Docs** | http://localhost:8000/docs | REST API documentation |
| **Flink** | http://localhost:8081 | Stream processing jobs |
| **Airflow** | http://localhost:8082 | Batch job scheduler |
| **Spark** | http://localhost:8080 | Batch processing |
| **MLflow** | http://localhost:5000 | ML model registry |
| **InfluxDB** | http://localhost:8086 | Time-series database |

**Default Credentials:**
- Grafana: `admin` / `admin`
- Airflow: `admin` / `admin`
- InfluxDB: Set in `env/influxdb.env`

## Environment Files

Copy and edit these files in `env/`:

```bash
env/
├── influxdb.env       # InfluxDB admin token, org, bucket
├── postgres.env       # PostgreSQL user, password, database
├── kafka.env          # Kafka broker config
├── mosquitto.env      # MQTT broker credentials
├── api.env            # API JWT secret, CORS origins
└── frontend.env       # API URL for frontend
```

**Required:**
- `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN` - InfluxDB admin token (generate with `openssl rand -hex 32`)
- `POSTGRES_PASSWORD` - PostgreSQL password
- `JWT_SECRET_KEY` - API JWT secret (generate with `openssl rand -hex 32`)

**Optional (use defaults):**
- MQTT credentials
- Kafka partitions
- CORS origins

## Common Commands

```bash
make up              # Start all services
make down            # Stop all services
make logs            # Tail all logs
make ps              # Show container status
make build           # Rebuild custom images

# ML Models
make ml-bootstrap    # Train initial models
make ml-status       # Check model versions

# Frontend
make frontend-build  # Rebuild frontend
make frontend-up     # Start frontend only
```

## Architecture

```
Simulator → MQTT → Bridge → Kafka
                              ↓
                    Flink (real-time processing)
                              ↓
                    InfluxDB (time-series) ← Flux tasks (rollups)
                              ↓
                    API (FastAPI) ← Redis (cache)
                              ↓
                    Frontend (Next.js 3D)
                    Grafana (dashboards)

Spark ← Airflow (batch jobs) → PostgreSQL
                                    ↓
                              ML Models (MLflow)
```

## Data Flow

1. **Simulator** generates sensor data (temperature, occupancy, energy)
2. **MQTT** → **Bridge** → **Kafka** topics
3. **Flink** processes streams in real-time:
   - Raw data → InfluxDB `campus_raw`
   - 1-min aggregations → `campus_1m`
   - Anomaly detection → PostgreSQL
4. **Flux tasks** create hourly/daily rollups
5. **Airflow + Spark** run batch jobs:
   - Daily energy reports
   - Weekly ML features
6. **API** serves data with Redis caching
7. **Frontend** displays 3D visualization
8. **Grafana** shows dashboards

## Troubleshooting

**Flink jobs restarting?**
```bash
# Increase TaskManager memory in docker-compose.yml
# Current: 4GB (line ~315)
```

**No data in Grafana?**
```bash
# Check Flink jobs
curl http://localhost:8081/jobs/overview

# Check InfluxDB data
docker exec campus-influxdb influx query \
  'from(bucket: "campus_raw") |> range(start: -5m) |> limit(n: 5)' \
  --org smart-campus
```

**API not starting?**
```bash
# Check Redis connection
docker logs campus-api | grep -i redis

# Verify environment files exist
ls -la env/*.env
```

## Development

See [PIPELINE_ARCHITECTURE.md](PIPELINE_ARCHITECTURE.md) for detailed architecture.

**Requirements:**
- Docker & Docker Compose
- Python 3.12+ (for local development)
- 8GB+ RAM recommended

## License

MIT
