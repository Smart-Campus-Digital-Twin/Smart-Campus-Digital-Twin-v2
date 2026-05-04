"""
Flink Real-Time Congestion Prediction Job.

Reads sensor occupancy messages from Kafka (sensors.occupancy),
builds lag/rolling features from an in-process rolling history per room,
loads XGBoost models from MLflow, and writes next-slot occupancy
predictions to the campus_predictions InfluxDB bucket.

Design notes:
  - parallelism=1 so a single Python operator owns all room histories —
    avoids doubling model memory and RocksDB state overhead.
  - History is kept in a plain Python dict (self._history), NOT in Flink
    managed ListState, which would trigger expensive RocksDB I/O and a
    1 GB Beam state cache per worker on every event.
  - Models are loaded eagerly in open() so failures surface immediately
    and the hot path stays exception-free.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime

import mlflow
import mlflow.xgboost
import numpy as np
from xgboost import XGBRegressor
from pyflink.datastream import StreamExecutionEnvironment
from pyflink.datastream.functions import KeyedProcessFunction, RuntimeContext
from pyflink.common.watermark_strategy import WatermarkStrategy
from pyflink.datastream.connectors.kafka import (
    KafkaSource, KafkaOffsetsInitializer,
)
from pyflink.common.serialization import SimpleStringSchema
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
KAFKA_BROKERS       = os.environ.get("KAFKA_BROKERS",      "kafka:9092")
INFLUX_URL          = os.environ.get("INFLUXDB_URL",       "http://influxdb:8086")
INFLUX_TOKEN        = os.environ.get("INFLUXDB_TOKEN",     "")
INFLUX_ORG          = os.environ.get("INFLUXDB_ORG",       "smart-campus")
INFLUX_BUCKET       = os.environ.get("INFLUXDB_BUCKET",    "campus_predictions")
MLFLOW_TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI","http://mlflow:5000")

CANTEEN_MODEL_NAME  = "campus_canteen_congestion"
LIBRARY_MODEL_NAME  = "campus_library_congestion"
HISTORY_SLOTS       = 50    # ~25 hours of 30-min windows per room
LAGS_NEEDED         = [1, 2, 4, 8, 48]


# ── Feature vector builder ────────────────────────────────────────────────────

def _build_feature_vector(msg: dict, history: list[float]) -> np.ndarray | None:
    if len(history) < max(LAGS_NEEDED):
        return None

    ts    = datetime.fromisoformat(msg["timestamp"])
    hour  = ts.hour + ts.minute / 60.0
    dow   = ts.weekday()
    month = ts.month

    sin_h, cos_h = np.sin(2*np.pi*hour/24),  np.cos(2*np.pi*hour/24)
    sin_d, cos_d = np.sin(2*np.pi*dow/7),    np.cos(2*np.pi*dow/7)
    sin_m, cos_m = np.sin(2*np.pi*month/12), np.cos(2*np.pi*month/12)

    lags  = [history[-n] if n <= len(history) else 0.0 for n in LAGS_NEEDED]
    roll3 = float(np.mean(history[-3:])) if len(history) >= 3 else 0.0
    roll6 = float(np.mean(history[-6:])) if len(history) >= 6 else 0.0
    std3  = float(np.std(history[-3:]))  if len(history) >= 3 else 0.0
    std6  = float(np.std(history[-6:]))  if len(history) >= 6 else 0.0

    ctx  = msg.get("context", {})
    feat = [
        sin_h, cos_h, sin_d, cos_d, sin_m, cos_m,
        float(ctx.get("is_weekend",          0)),
        float(ctx.get("is_holiday",          0)),
        float(ctx.get("is_exam_period",      0)),
        float(ctx.get("is_low_attendance",   0)),
        float(ctx.get("is_essentially_empty",0)),
        float(ctx.get("tua_active",          0)),
        float(ctx.get("lecture_scale",       1.0)),
        float(ctx.get("congestion_fraction", 1.0)),
        float(1 if ctx.get("active_events") else 0),
        float(msg.get("capacity", 100)),
        # activity one-hots — zeros until live Postgres lookup is wired in
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        *lags,
        roll3, roll6, std3, std6,
    ]
    return np.array(feat, dtype=np.float32).reshape(1, -1)


# ── Flink Process Function ────────────────────────────────────────────────────

class CongestionPredictionFunction(KeyedProcessFunction):
    """
    Maintains per-room occupancy history in a plain Python dict (no Flink
    managed state / RocksDB).  History is lost on job restart but rebuilds
    within HISTORY_SLOTS events — acceptable for a warm-up period.
    """

    def __init__(self):
        # Plain Python dicts — no Flink ListState, no RocksDB overhead
        self._history: dict[str, list[float]] = {}
        self._models:  dict[str, object]      = {}   # room_type -> pyfunc model
        self._influx_client = None
        self._write_api     = None

    def open(self, runtime_context: RuntimeContext):
        self._influx_client = InfluxDBClient(
            url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG
        )
        self._write_api = self._influx_client.write_api(write_options=SYNCHRONOUS)

        # Load both XGBoost models directly — lighter than mlflow.pyfunc.load_model
        # which wraps the model in a heavy Python environment object.
        mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
        client = mlflow.tracking.MlflowClient()
        for model_name, room_type in [
            (CANTEEN_MODEL_NAME, "canteen"),
            (LIBRARY_MODEL_NAME, "library"),
        ]:
            try:
                versions = client.get_latest_versions(model_name, stages=["Production"])
                if not versions:
                    log.warning("No Production version for '%s' — skipping.", model_name)
                    continue
                run_id = versions[0].run_id
                model_uri = f"runs:/{run_id}/model"
                self._models[room_type] = mlflow.xgboost.load_model(model_uri)
                log.info("Loaded XGBoost model '%s' run=%s", model_name, run_id[:8])
            except Exception as exc:
                log.warning(
                    "Model '%s' not available — predictions skipped: %s",
                    model_name, exc,
                )

    def process_element(self, value: str, ctx):
        try:
            msg = json.loads(value)
        except (json.JSONDecodeError, ValueError):
            return

        room_type = msg.get("room_type")
        if room_type not in ("canteen", "library"):
            return

        room_id = msg.get("room_id", "unknown")
        avg_val = float(msg.get("avg", 0.0))

        # Update in-process rolling history
        history = self._history.get(room_id, [])
        history.append(avg_val)
        if len(history) > HISTORY_SLOTS:
            history = history[-HISTORY_SLOTS:]
        self._history[room_id] = history

        features = _build_feature_vector(msg, history)
        if features is None:
            return   # still warming up lag window

        model: XGBRegressor | None = self._models.get(room_type)
        if model is None:
            return   # model not yet in Production

        try:
            prediction = float(model.predict(features)[0])
        except Exception as exc:
            log.warning("Prediction failed for room %s: %s", room_id, exc)
            return

        point = (
            Point("predicted_occupancy")
            .tag("room_id",     room_id)
            .tag("building_id", msg.get("building_id", "unknown"))
            .tag("room_type",   room_type)
            .field("predicted_avg", prediction)
            .field("actual_avg",    avg_val)
            .time(msg["timestamp"], WritePrecision.SECONDS)
        )
        try:
            self._write_api.write(bucket=INFLUX_BUCKET, record=point)
        except Exception as exc:
            log.warning("InfluxDB write failed: %s", exc)

    def close(self):
        if self._influx_client:
            self._influx_client.close()


# ── Flink job entrypoint ──────────────────────────────────────────────────────

def main():
    env = StreamExecutionEnvironment.get_execution_environment()
    # parallelism=1: single operator owns all rooms — avoids splitting history
    # across slots and halves model-load memory vs parallelism=2.
    env.set_parallelism(1)

    source = (
        KafkaSource.builder()
        .set_bootstrap_servers(KAFKA_BROKERS)
        .set_topics("sensors.occupancy")
        .set_group_id("ml-prediction-congestion")
        .set_starting_offsets(KafkaOffsetsInitializer.latest())
        .set_value_only_deserializer(SimpleStringSchema())
        .build()
    )

    stream = env.from_source(
        source,
        WatermarkStrategy.no_watermarks(),
        "KafkaOccupancySource",
    )

    (
        stream
        # key_by is still useful to guarantee ordering per room even at p=1
        .key_by(lambda s: json.loads(s).get("room_id", "unknown"))
        .process(CongestionPredictionFunction())
    )

    env.execute("SmartCampus Congestion Prediction")


if __name__ == "__main__":
    main()
