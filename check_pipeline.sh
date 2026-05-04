#!/usr/bin/env bash
# Pipeline health check — run from the project root.
# Exit code 0 = all checks passed, 1 = one or more failed.

set -uo pipefail

# Load local env files if present (created via `make env`).
for f in env/influxdb.env env/postgres.env env/kafka.env env/mosquitto.env; do
    if [ -f "$f" ]; then
        set -a
        # shellcheck disable=SC1090
        . "$f"
        set +a
    fi
done

INFLUX_TOKEN="${INFLUX_TOKEN:-${INFLUXDB_TOKEN:-${DOCKER_INFLUXDB_INIT_ADMIN_TOKEN:-}}}"
INFLUX_ORG="${INFLUX_ORG:-${INFLUXDB_ORG:-smart-campus}}"

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8083}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-campus}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-campus-dev}"
KEYCLOAK_USERNAME="${KEYCLOAK_USERNAME:-dev}"
KEYCLOAK_PASSWORD="${KEYCLOAK_PASSWORD:-dev}"

PASS=0; FAIL=0

ok()   { echo "  [OK]  $*"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
hdr()  { echo; echo "==> $*"; }


# ---------------------------------------------------------------------------
# 1. Docker service health
# ---------------------------------------------------------------------------
hdr "1. Container health"
while IFS= read -r line; do
    name=$(echo "$line" | awk '{print $1}')
    status=$(echo "$line" | cut -d' ' -f2-)
    if echo "$status" | grep -qiE "Up|healthy"; then
        ok "$name — $status"
    else
        fail "$name — $status"
    fi
done < <(docker compose ps --format "{{.Name}} {{.Status}}" 2>/dev/null)


# ---------------------------------------------------------------------------
# 2. Simulator → Kafka
# ---------------------------------------------------------------------------
hdr "2. Simulator → Kafka"
for group in flink-campus-kafka-to-influx flink-campus-window-agg-sql flink-campus-anomaly; do
    raw=$(docker exec campus-kafka /opt/kafka/bin/kafka-consumer-groups.sh \
        --bootstrap-server localhost:9092 \
        --describe --group "$group" 2>/dev/null)
    total_lag=$(echo "$raw"  | awk 'NR>2 && $6~/^[0-9]+$/ {sum+=$6} END{print sum+0}')
    total_off=$(echo "$raw"  | awk 'NR>2 && $5~/^[0-9]+$/ {sum+=$5} END{print sum+0}')
    if [ "${total_off:-0}" -gt 0 ]; then
        ok "$group — offset=$total_off lag=$total_lag"
        [ "${total_lag:-0}" -gt 50000 ] && fail "$group lag > 50 000 — may be stuck"
    else
        fail "$group — no messages consumed yet"
    fi
done


# ---------------------------------------------------------------------------
# 3. Flink jobs (expect 3 RUNNING: kafka_to_influx, window_agg, anomaly)
# ---------------------------------------------------------------------------
hdr "3. Flink streaming jobs"
RUNNING=$(curl -sf http://localhost:8081/jobs 2>/dev/null \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
jobs = d.get('jobs', [])
running = [j for j in jobs if j['status'] == 'RUNNING']
print(len(running))
" 2>/dev/null || echo 0)
if [ "${RUNNING:-0}" -ge 3 ]; then
    ok "$RUNNING Flink jobs RUNNING"
else
    fail "Expected ≥3 Flink jobs RUNNING, got ${RUNNING:-0}"
fi


# ---------------------------------------------------------------------------
# 4. InfluxDB — data in each bucket within the last hour
# ---------------------------------------------------------------------------
hdr "4. InfluxDB buckets"
if [ -z "${INFLUX_TOKEN}" ]; then
    fail "INFLUX_TOKEN is not set (export INFLUX_TOKEN/INFLUXDB_TOKEN or run 'make env')"
fi
influx_has_data() {
    local bucket="$1" measurement="$2"
    local lines
    lines=$(docker exec campus-influxdb influx query \
        --org "$INFLUX_ORG" --token "$INFLUX_TOKEN" \
        "from(bucket:\"$bucket\") |> range(start:-1h) |> filter(fn:(r)=>r._measurement==\"$measurement\") |> first() |> limit(n:1)" \
        2>/dev/null | wc -l)
    echo "${lines:-0}"
}

# campus_raw: simulator → bridge → Kafka → Flink writes sensor readings, check last 1h
# campus_1m: Flink window_agg writes per-minute rollups, check last 1h
# campus_1h: hourly_rollup runs at hh:05, data could be up to 2h old — use -4h window
for check in "campus_raw:sensors:-1h" "campus_1m:sensor_1m:-1h" "campus_1h:sensor_1h:-4h"; do
    bucket="${check%%:*}"; rest="${check#*:}"; meas="${rest%%:*}"; window="${rest##*:}"
    lines=$(docker exec campus-influxdb influx query \
        --org "$INFLUX_ORG" --token "$INFLUX_TOKEN" \
        "from(bucket:\"$bucket\") |> range(start:${window}) |> filter(fn:(r)=>r._measurement==\"$meas\") |> first() |> limit(n:1)" \
        2>/dev/null | wc -l)
    if [ "$lines" -gt 3 ]; then
        ok "$bucket.$meas — data present (window $window)"
    else
        fail "$bucket.$meas — no data in $window window"
    fi
done


# ---------------------------------------------------------------------------
# 5. PostgreSQL — reference data + operational tables
# ---------------------------------------------------------------------------
hdr "5. PostgreSQL tables"
pg() { docker exec campus-postgres psql -U campus -d campus -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

BLDS=$(pg "SELECT COUNT(*) FROM buildings")
ROOMS=$(pg "SELECT COUNT(*) FROM rooms")
[ "${BLDS:-0}" -ge 26 ]  && ok "buildings: $BLDS rows"  || fail "buildings: ${BLDS:-0} rows (expected ≥26 — run seeder)"
[ "${ROOMS:-0}" -ge 200 ] && ok "rooms: $ROOMS rows"    || fail "rooms: ${ROOMS:-0} rows (expected ≥200 — run seeder)"

ANOM=$(pg "SELECT COUNT(*) FROM anomalies WHERE detected_at > now() - interval '1 hour'")
[ "${ANOM:-0}" -gt 0 ] && ok "anomalies: $ANOM in last hour" \
    || fail "anomalies: 0 in last hour (Flink anomaly job may not be writing)"

EDAILY=$(pg "SELECT COUNT(*) FROM energy_daily")
[ "${EDAILY:-0}" -gt 0 ] && ok "energy_daily: $EDAILY rows" \
    || fail "energy_daily: 0 rows (daily_reports job hasn't written yet)"

MLB=$(pg "SELECT COUNT(*) FROM ml_features")
[ "${MLB:-0}" -gt 0 ] && ok "ml_features: $MLB rows" \
    || fail "ml_features: 0 rows (weekly_ml_features job hasn't written yet)"


# ---------------------------------------------------------------------------
# 6. Airflow DAGs — unpaused + last run succeeded
# ---------------------------------------------------------------------------
hdr "6. Airflow DAGs"
dag_state() {
    # Returns "paused=<bool> last=<state>" for a given dag_id
    local dag="$1"
    local paused last
    paused=$(docker exec campus-airflow airflow dags list 2>/dev/null \
        | awk -F'|' -v d="$dag" '$1~d {gsub(/[[:space:]]/,"",$4); print $4}')
    last=$(docker exec campus-airflow airflow dags list-runs -d "$dag" --no-backfill 2>/dev/null \
        | awk -F'|' 'NR==3 {gsub(/[[:space:]]/,"",$3); print $3}')
    echo "paused=${paused:-unknown} last=${last:-unknown}"
}

for dag in hourly_rollup daily_reports weekly_ml_features; do
    info=$(dag_state "$dag")
    paused=$(echo "$info" | grep -o 'paused=[^[:space:]]*' | cut -d= -f2)
    last=$(echo "$info"   | grep -o 'last=[^[:space:]]*'   | cut -d= -f2)
    if [ "$paused" = "False" ] && [ "$last" = "success" ]; then
        ok "$dag — unpaused, last run: success"
    else
        fail "$dag — paused=$paused, last run: $last"
    fi
done


# ---------------------------------------------------------------------------
# 7. API health endpoint
# ---------------------------------------------------------------------------
hdr "7. API"
TOKEN=$(curl -sf -X POST "${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "grant_type=password" \
    --data-urlencode "client_id=${KEYCLOAK_CLIENT_ID}" \
    --data-urlencode "username=${KEYCLOAK_USERNAME}" \
    --data-urlencode "password=${KEYCLOAK_PASSWORD}" \
    2>/dev/null \
    | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])' \
    2>/dev/null || true)

if [ -z "${TOKEN}" ]; then
    fail "Keycloak token fetch failed (is Keycloak up on ${KEYCLOAK_URL}?)"
    HEALTH="{}"
else
    HEALTH=$(curl -sf -H "Authorization: Bearer ${TOKEN}" http://localhost:8000/health 2>/dev/null || echo "{}")
fi
STATUS=$(echo "$HEALTH" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ok = d.get('status')=='ok' and d.get('influxdb')=='up' and d.get('postgres')=='up'
    print('ok' if ok else 'fail:' + str(d))
except Exception as e:
    print('fail:' + str(e))
" 2>/dev/null)
if [ "$STATUS" = "ok" ]; then
    ok "API /health → $HEALTH"
else
    fail "API /health → $STATUS"
fi


# ---------------------------------------------------------------------------
# 8. Grafana reachability
# ---------------------------------------------------------------------------
hdr "8. Grafana"
HTTP=$(curl -so /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo 000)
[ "$HTTP" = "200" ] && ok "Grafana /api/health → 200" || fail "Grafana /api/health → $HTTP"


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "======================================="
printf "  PASSED: %-4s  FAILED: %s\n" "$PASS" "$FAIL"
echo "======================================="
[ "$FAIL" -eq 0 ]
