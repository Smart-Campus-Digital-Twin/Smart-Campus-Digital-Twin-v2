# ── Stage 0: Base ─────────────────────────────────────────────────────────────
# Apache Spark 4.1.1 official image (Ubuntu 22.04, Java 21, gosu pre-installed)
# spark user UID 185 and SPARK_HOME=/opt/spark already configured.
FROM apache/spark:4.1.1 AS base

USER root

# Install Python 3.12 via deadsnakes PPA (Ubuntu 22.04 ships 3.10 only)
RUN apt-get update && \
    apt-get install -y --no-install-recommends software-properties-common && \
    add-apt-repository ppa:deadsnakes/ppa && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        python3.12 \
        python3.12-venv && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    python3.12 -m ensurepip --upgrade && \
    python3.12 -m pip install --upgrade pip setuptools wheel

ENV PYSPARK_PYTHON=/usr/bin/python3.12 \
    PYSPARK_DRIVER_PYTHON=/usr/bin/python3.12 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ── Stage 1: Python dependencies ──────────────────────────────────────────────
FROM base AS deps

COPY processing/spark/requirements.txt /tmp/spark-requirements.txt
RUN python3.12 -m pip install --no-cache-dir -r /tmp/spark-requirements.txt \
    && rm -rf /root/.cache /tmp/spark-requirements.txt

# ── Stage 2: Cluster runtime (spark-master + spark-worker) ────────────────────
# target: cluster
# Bakes shared/ so executor-side imports resolve without --py-files.
FROM deps AS cluster

COPY --chown=185:185 shared/ /opt/spark/jobs/shared/

ENV PYTHONPATH=/opt/spark/jobs

USER 185

# ── Stage 3: Submit / standalone image (driver + job entry points) ─────────────
FROM cluster AS submit

USER root
COPY --chown=185:185 processing/spark/ /opt/spark/jobs/processing/spark/
USER 185
