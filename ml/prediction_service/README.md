# ML Prediction Service

Lightweight FastAPI microservice for real-time ML predictions in the Smart Campus Digital Twin.

## Purpose

This service solves the **model loading overhead problem** in Flink jobs by:
- Loading XGBoost models **once at startup** (not per event)
- Exposing a REST API for predictions
- Writing predictions directly to InfluxDB
- Reducing Flink worker memory from ~2GB to ~200MB

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌──────────┐
│ Flink Job   │─────>│ ML Prediction    │─────>│ InfluxDB │
│ (prediction)│ HTTP │ Service (8001)   │      │          │
└─────────────┘      └──────────────────┘      └──────────┘
                              │
                              │ Load models at startup
                              ▼
                     ┌──────────────────┐
                     │ MLflow (5000)    │
                     │ Model Registry   │
                     └──────────────────┘
```

## Features

- **Congestion Prediction**: Next-slot occupancy for canteen/library rooms
- **Energy Forecasting**: Next-hour energy consumption per building (future)
- **Health Checks**: `/health` endpoint for monitoring
- **Model Listing**: `/models` endpoint to see loaded models

## API Endpoints

### `GET /health`
Check service health and loaded models.

**Response:**
```json
{
  "status": "healthy",
  "models_loaded": ["canteen", "library"],
  "influx_connected": true
}
```

### `POST /predict/congestion`
Predict next-slot occupancy for a room.

**Request:**
```json
{
  "room_id": "canteen_main",
  "room_type": "canteen",
  "building_id": "B001",
  "timestamp": "2025-01-15T14:30:00",
  "avg": 45.5,
  "capacity": 100,
  "history": [40.2, 42.1, 43.8, 45.5],
  "context": {
    "is_weekend": 0,
    "is_holiday": 0,
    "lecture_scale": 1.0
  }
}
```

**Response:**
```json
{
  "room_id": "canteen_main",
  "predicted_avg": 48.3,
  "actual_avg": 45.5,
  "timestamp": "2025-01-15T14:30:00",
  "written_to_influx": true
}
```

### `GET /models`
List all loaded models.

**Response:**
```json
{
  "models": {
    "canteen": {"loaded": true, "type": "XGBRegressor"},
    "library": {"loaded": true, "type": "XGBRegressor"}
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MLFLOW_TRACKING_URI` | `http://mlflow:5000` | MLflow server URL |
| `INFLUXDB_URL` | `http://influxdb:8086` | InfluxDB URL |
| `INFLUXDB_TOKEN` | - | InfluxDB auth token |
| `INFLUXDB_ORG` | `smart-campus` | InfluxDB organization |
| `INFLUXDB_BUCKET` | `campus_predictions` | InfluxDB bucket for predictions |

## Deployment

### Docker Compose (Recommended)
Service is defined in `docker-compose.yml`:

```yaml
ml-prediction:
  build:
    context: ml/prediction_service
    dockerfile: Dockerfile
  container_name: campus-ml-prediction
  ports:
    - "8001:8001"
  environment:
    - MLFLOW_TRACKING_URI=http://mlflow:5000
    - INFLUXDB_URL=http://influxdb:8086
  env_file:
    - env/influxdb.env
```

Start the service:
```bash
docker-compose up -d ml-prediction
```

### Standalone
```bash
cd ml/prediction_service
pip install -r requirements.txt
python main.py
```

## Model Requirements

Models must be:
1. Registered in MLflow with names:
   - `campus_canteen_congestion`
   - `campus_library_congestion`
   - `campus_energy_forecast`
2. Promoted to **Production** stage
3. XGBoost models (saved with `mlflow.xgboost.log_model`)

## Performance

- **Startup time**: ~5-10 seconds (model loading)
- **Prediction latency**: <50ms per request
- **Memory usage**: ~500MB-2GB (depending on model size)
- **Throughput**: ~200 requests/second (single instance)

## Integration with Flink

The Flink prediction job (`processing/flink/jobs/prediction.py`) calls this service:

```python
response = self._http_client.post("/predict/congestion", json=payload)
result = response.json()
```

This replaces the previous approach of loading models in each Flink worker.

## Monitoring

Check service health:
```bash
curl http://localhost:8001/health
```

View loaded models:
```bash
curl http://localhost:8001/models
```

## Troubleshooting

### Models not loading
- Ensure MLflow is running and accessible
- Check that models are in "Production" stage
- Verify `MLFLOW_TRACKING_URI` is correct

### InfluxDB write failures
- Check `INFLUXDB_TOKEN` is set correctly
- Verify bucket `campus_predictions` exists
- Check network connectivity to InfluxDB

### High memory usage
- Normal for XGBoost models (500MB-2GB)
- Consider horizontal scaling if needed
- Models are loaded once at startup, not per request
