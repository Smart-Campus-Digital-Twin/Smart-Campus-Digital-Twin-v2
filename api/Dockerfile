# ── Stage 1: dependency builder ─────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1

RUN python -m venv /venv \
    && /venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel
ENV PATH="/venv/bin:$PATH"

COPY api/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM python:3.12-slim

RUN addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser

COPY --from=builder --chown=appuser:appgroup /venv /venv

WORKDIR /app
COPY --chown=appuser:appgroup shared/ ./shared/
COPY --chown=appuser:appgroup api/ ./api/

ENV PATH="/venv/bin:$PATH" \
    PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER appuser
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
