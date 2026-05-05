# ── Stage 1: shared system base ───────────────────────────────────────────────
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 && \
    rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 appgroup && \
    adduser  --system --uid 1001 --ingroup appgroup appuser

WORKDIR /opt/campus

# ── Stage 2: Python dependency builder ────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev && \
    rm -rf /var/lib/apt/lists/*

RUN python -m venv /venv && \
    /venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel

COPY ml/requirements.txt /tmp/ml-requirements.txt

# kedro_project/requirements.txt is for local notebook dev (jupyterlab, ipython).
# Production only needs the packages in ml/requirements.txt.
RUN /venv/bin/pip install --no-cache-dir -r /tmp/ml-requirements.txt
# Re-pin setuptools after all installs so transitive upgrades cannot override it.
RUN /venv/bin/pip install --no-cache-dir "setuptools>=65.0,<72"

# ── Stage 3: training runtime ─────────────────────────────────────────────────
# Used by campus-ml-training. Sleeps until Airflow exec-s a kedro run into it,
# or bootstrap_training.py is run manually once to seed MLflow.
FROM base AS training

COPY --from=builder --chown=appuser:appgroup /venv /venv

COPY --chown=appuser:appgroup ml/       ./ml/
COPY --chown=appuser:appgroup shared/   ./shared/

ENV PATH="/venv/bin:$PATH" \
    PYTHONPATH=/opt/campus \
    KEDRO_DISABLE_TELEMETRY=true \
    PYTHONWARNINGS=ignore

USER appuser
# Stays alive so Airflow can docker exec into it for scheduled retraining.
CMD ["sleep", "infinity"]

# ── Stage 4: inference runtime ────────────────────────────────────────────────
# Used by campus-ml-inference. Sleeps until Airflow exec-s the batch inference
# script into it on schedule.
FROM base AS inference

COPY --from=builder --chown=appuser:appgroup /venv /venv

COPY --chown=appuser:appgroup ml/       ./ml/
COPY --chown=appuser:appgroup shared/   ./shared/

ENV PATH="/venv/bin:$PATH" \
    PYTHONPATH=/opt/campus \
    MLFLOW_TRACKING_URI=http://mlflow:5000

USER appuser
CMD ["sleep", "infinity"]
