# Plan: Pipeline + Infra Fixes (memory, downsampling, frontend updates, simulator, MQTT ingress)

Step-by-step plan for a junior model. **Read every section before acting. Verify each step.**

For the separate runnable edge-device simulator app, see [EDGE_SIMULATOR_PLAN.md](EDGE_SIMULATOR_PLAN.md). That is out of scope for this document.

---

## Section 0 — Inventory of problems (verified)

| # | Symptom | Verified by |
|---|---|---|
| 1 | Cluster memory bloat | Two parallel stacks in `campus` + `smart-campus` namespaces. 20 PVCs across both. `kubectl get pods -n smart-campus` shows duplicate postgres, kafka-init, keycloak, api, frontend, redis. |
| 2 | Frontend shows no live updates | API responds 200, bridge forwarding 55M+ msgs, but UI panel says `NO DATA`. Likely WebSocket / poll path broken or frontend reads wrong bucket. |
| 3 | `campus_1h` / `campus_1d` buckets empty | Flux downsampling tasks `downsample_1m_to_1h.flux` and `downsample_1h_to_1d.flux` defined in `infra/influxdb/tasks/` but not confirmed registered or running. |
| 4 | Simulator only has global on/off | `simulator/main.py:534` `/toggle` flips a single `running` bool. No per-sensor enable/disable endpoint exists. Building-level overrides exist but not per-sensor toggles. |
| 5 | Mosquitto not reachable from external edge devices | `Service mosquitto` is ClusterIP only (`kubectl get svc mosquitto -n campus` → `ClusterIP None`). No NodePort/LoadBalancer/Ingress for 1883. |
| 6 | Kafka retention 7 days (604800000 ms) on 20 GB PVC | `KAFKA_LOG_RETENTION_MS=604800000` in `deployment/k8s/kafka.yaml:59`. With 55M+ messages, fills storage. |
| 7 | Bridge logs spam `Forwarded N messages` every 100 msgs | High disk I/O + log volume; node memory pressure. |

---

## Section 1 — Eliminate the duplicate `smart-campus` namespace stack

Two stacks running in parallel. The active production-ish stack is `campus`. The `smart-campus` namespace was a re-deploy attempt; it duplicates every PVC and pod, doubling memory and disk.

### Step 1.1 — Confirm `smart-campus` is unused

```powershell
kubectl get pods -n smart-campus
kubectl get pvc -n smart-campus
# Confirm with the user — DO NOT delete until they say yes
```

The active production traffic hits Kong LB `129.212.208.120` which routes to services in `campus`. The `smart-campus` namespace has no LoadBalancer Service in front of it and its keycloak is `CrashLoopBackOff`. Safe to assume orphaned.

### Step 1.2 — DESTRUCTIVE: delete the namespace

> **Warning:** This will permanently delete every pod, PVC, secret, and ConfigMap in `smart-campus`. The 11 PVCs in that namespace will be released and the underlying DigitalOcean block volumes deleted. This frees ~75 GB of block storage but is irreversible. Do NOT run this without explicit user confirmation.

```powershell
kubectl delete namespace smart-campus
```

After this completes, re-check memory:

```powershell
kubectl get pods -A
kubectl get pvc -A
```

Expect to see 11 fewer PVCs and ~9 fewer pods. End of destructive step. Resume caveman.

---

## Section 2 — Add retention policies to flush stale data

### Step 2.1 — Kafka log retention (currently 7 days)

Drop to **24 hours** for raw topics. Edit `deployment/k8s/kafka.yaml` line 59:

```yaml
- name: KAFKA_LOG_RETENTION_MS
  value: "86400000"            # 24h
- name: KAFKA_LOG_RETENTION_BYTES
  value: "5368709120"          # 5 GB cap per partition
- name: KAFKA_LOG_SEGMENT_BYTES
  value: "536870912"           # 512 MB segments — faster GC
- name: KAFKA_LOG_RETENTION_CHECK_INTERVAL_MS
  value: "300000"              # check every 5 min
```

Apply, then trigger compaction by deleting old segments:

```powershell
kubectl apply -f deployment/k8s/kafka.yaml
kubectl rollout restart statefulset/kafka -n campus
```

Wait for kafka to come back, then verify:

```powershell
kubectl exec -n campus kafka-0 -- /opt/kafka/bin/kafka-configs.sh --bootstrap-server localhost:9092 --entity-type brokers --entity-name 1 --describe | findstr retention
```

### Step 2.2 — InfluxDB bucket retention

Buckets and their target retention:

| Bucket | Current | Set to | Reason |
|---|---|---|---|
| `campus_1m` | varies | 24h | Raw 1-min readings — keep only 1 day before rolling to `campus_1h` |
| `campus_1h` | varies | 30d | Hourly roll-ups — month of detail |
| `campus_1d` | varies | 5y | Daily summaries — cheap to keep |

Apply via `influx bucket update`:

```powershell
$ORG="smart-campus"
$TOKEN = kubectl get secret -n campus campus-influxdb -o jsonpath='{.data.INFLUXDB_TOKEN}' | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }

kubectl exec -n campus influxdb-0 -- influx bucket update --name campus_1m --org $ORG --retention 24h --token $TOKEN
kubectl exec -n campus influxdb-0 -- influx bucket update --name campus_1h --org $ORG --retention 720h --token $TOKEN
kubectl exec -n campus influxdb-0 -- influx bucket update --name campus_1d --org $ORG --retention 43800h --token $TOKEN
```

(Adjust org name and bucket names if `infra/influxdb/setup.sh` uses different ones — check `INFLUXDB_ORG` env in `campus-common` ConfigMap.)

### Step 2.3 — Mosquitto persistence cap

Edit `infra/mosquitto/mosquitto.conf`:

```
# Cap the persistence file so it cannot grow unbounded
autosave_interval 1800
autosave_on_changes false
persistent_client_expiration 1h
max_queued_messages 500
queue_qos0_messages false
```

Apply to the ConfigMap and restart:

```powershell
kubectl apply -f deployment/k8s/mosquitto.yaml
kubectl rollout restart statefulset/mosquitto -n campus
```

### Step 2.4 — Postgres bloat — daily VACUUM

Add a CronJob that runs `VACUUM ANALYZE` nightly. Create `deployment/k8s/postgres-vacuum-cron.yaml`:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-vacuum
  namespace: campus
spec:
  schedule: "0 3 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: psql
              image: postgres:16-alpine
              envFrom:
                - secretRef:
                    name: campus-postgres
              command:
                - sh
                - -c
                - |
                  PGPASSWORD="$POSTGRES_PASSWORD" psql -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "VACUUM (ANALYZE, VERBOSE);"
```

```powershell
kubectl apply -f deployment/k8s/postgres-vacuum-cron.yaml
```

### Step 2.5 — Bridge log spam — reduce verbosity

Edit `bridge/main.py` (or whichever file logs `Forwarded N messages`). Change the log threshold from every 100 msgs to every 100,000 msgs. Find the line:

```python
if count % 100 == 0:
    logger.info(f"Forwarded {count} messages")
```

Change to:

```python
if count % 100000 == 0:
    logger.info(f"Forwarded {count} messages")
```

This cuts log line emissions by 1000x.

### Step 2.6 — Set resource limits on every pod

Audit: `kubectl get pods -n campus -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].resources}{"\n"}{end}'`. Any pod with empty `resources: {}` is unbounded. Add reasonable limits (256Mi memory, 100m CPU) so noisy neighbors cannot drown the node.

---

## Section 3 — Fix the broken InfluxDB downsampling tasks

The `campus_1h` and `campus_1d` buckets are empty because the Flux continuous tasks were either never registered or are failing.

### Step 3.1 — List existing tasks

```powershell
$ORG="smart-campus"
$TOKEN = kubectl get secret -n campus campus-influxdb -o jsonpath='{.data.INFLUXDB_TOKEN}' | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }

kubectl exec -n campus influxdb-0 -- influx task list --org $ORG --token $TOKEN
```

Expected output: rows for `downsample_1m_to_1h` and `downsample_1h_to_1d`. If empty, the tasks were never created — re-run the setup script:

```powershell
kubectl exec -n campus influxdb-0 -- sh /docker-entrypoint-initdb.d/setup.sh
```

If still empty, manually create them:

```powershell
kubectl cp infra/influxdb/tasks/downsample_1m_to_1h.flux campus/influxdb-0:/tmp/1h.flux
kubectl exec -n campus influxdb-0 -- influx task create --file /tmp/1h.flux --org $ORG --token $TOKEN
kubectl cp infra/influxdb/tasks/downsample_1h_to_1d.flux campus/influxdb-0:/tmp/1d.flux
kubectl exec -n campus influxdb-0 -- influx task create --file /tmp/1d.flux --org $ORG --token $TOKEN
```

### Step 3.2 — Check task run history

```powershell
kubectl exec -n campus influxdb-0 -- influx task log list --task-id <TASK_ID> --org $ORG --token $TOKEN
kubectl exec -n campus influxdb-0 -- influx task run list --task-id <TASK_ID> --org $ORG --token $TOKEN
```

If all runs are `failed`, read the Flux file. Common bugs:

- Wrong bucket name (the file references `campus_1m` but the actual bucket is `campus-1m` with a dash — Flux is case- and char-sensitive).
- The destination bucket does not exist.
- The token used by the task has no write permission to the destination bucket.

Fix the Flux file in `infra/influxdb/tasks/` and re-apply. Sample working `downsample_1m_to_1h.flux`:

```flux
option task = {name: "downsample_1m_to_1h", every: 1h, offset: 5m}

from(bucket: "campus_1m")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "reading")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
  |> to(bucket: "campus_1h", org: "smart-campus")
```

### Step 3.3 — Verify data flowing

After tasks run (wait 1h + 5m offset for first run, OR force a manual run):

```powershell
kubectl exec -n campus influxdb-0 -- influx query 'from(bucket:"campus_1h") |> range(start:-2h) |> count()' --org $ORG --token $TOKEN
```

Must return non-zero counts.

---

## Section 4 — Fix the frontend "no live updates" problem

The UI shows `NO DATA` and `0.0 kW / 0% / 26 zones / None`. API is serving `/campus/zones` 200. So either:

a. Frontend polls only on first render and never refreshes.
b. WebSocket `/ws` is not connected.
c. API returns data but with wrong field names; frontend ignores it.

### Step 4.1 — Check WebSocket connectivity

Open the frontend with DevTools → Network → WS filter. There should be an open connection to `wss://campus.129-212-208-120.nip.io/ws/...`. If `(failed)`:

- Check Kong's `api-ws` route: `paths: ["/ws"]`, `strip_path: false`. Already correct.
- Kong has `KONG_NGINX_HTTP_UPSTREAM_KEEPALIVE=60` but for WebSocket upgrade Kong needs no special config — it should pass `Upgrade` headers through. Confirm with `wscat`:

```powershell
wscat -c wss://campus.129-212-208-120.nip.io/ws/live --no-check
```

Should connect. If `404`: API's WS route is at a different path — read `api/main.py` for the actual mount and fix Kong's route.

### Step 4.2 — Check API zone-data endpoint returns recent data

```powershell
curl -sk https://campus.129-212-208-120.nip.io/api/campus/zones | python -m json.tool | findstr -i "occupancy temperature energy"
```

If all values are `null` or zero, the API is querying an empty bucket. Likely cause: the API reads `campus_1m` but the bridge writes to a different bucket. Verify the bridge's write target:

```powershell
kubectl get deploy bridge -n campus -o yaml | findstr -i bucket
kubectl logs -n campus deploy/bridge --tail=50 | findstr -i "bucket\|write"
```

If the bridge writes to `campus` but the API reads `campus_1m`, fix one side (recommend pointing both to `campus_1m`). Set `INFLUXDB_BUCKET=campus_1m` in `campus-common` ConfigMap.

### Step 4.3 — Frontend polling fallback

If WS is genuinely broken in production, add a 5-second polling fallback in `frontend/frontend/src/components/DigitalTwinDashboard.tsx`. Locate where zone data is fetched (Grep for `/campus/zones`). Add:

```ts
useEffect(() => {
  const tick = async () => {
    const r = await fetchWithAuth("/api/campus/zones");
    setZones(await r.json());
  };
  tick();
  const id = setInterval(tick, 5000);
  return () => clearInterval(id);
}, [fetchWithAuth]);
```

Keep the WebSocket too — polling is a safety net, not the primary path.

### Step 4.4 — Verify in browser

After fixes, the homepage's `CAMPUS ENERGY` / `AVG OCCUPANCY` numbers must update every 5 s without page reload. The `Faculty of Information Technology` zone panel must show non-zero `Avg. Energy`.

---

## Section 5 — Per-sensor on/off toggles in the simulator

Current `simulator/main.py:534` `/toggle` flips a single `running` bool. Need per-sensor enable/disable so the user can simulate "occupancy sensor in Library is offline" without killing the whole sim.

### Step 5.1 — Add per-sensor state

In `simulator/main.py` near `simulator_state`:

```python
simulator_state: dict[str, Any] = {
    "running": True,
    "reading_count": 0,
    "interval_s": config.publish_interval_s,
    "anomaly_prob": float(os.environ.get("ANOMALY_INJECTION_PROB", "0.01")),
    "overrides": {},
    "disabled_sensors": set(),  # NEW: set of sensor_id strings that should be skipped
}
```

### Step 5.2 — Skip disabled sensors in the publish loop

In `main_loop()` where sensors are read, around line 158:

```python
for room, sensor in all_sensors:
    if sensor.sensor_id in simulator_state["disabled_sensors"]:
        continue
    # existing read+publish code...
```

Do the same in the occupancy pre-pass (line 150).

### Step 5.3 — Add endpoints

After `/override/{building_id}` block:

```python
class SensorToggleRequest(BaseModel):
    enabled: bool

@app.post("/sensor/{sensor_id}/enable")
async def enable_sensor(sensor_id: str):
    simulator_state["disabled_sensors"].discard(sensor_id)
    return {"sensor_id": sensor_id, "enabled": True}

@app.post("/sensor/{sensor_id}/disable")
async def disable_sensor(sensor_id: str):
    simulator_state["disabled_sensors"].add(sensor_id)
    return {"sensor_id": sensor_id, "enabled": False}

@app.get("/sensors")
async def list_sensors():
    # Return list of all sensor_ids and their state.
    # Reading from simulator state requires access to all_sensors — store at startup:
    return {
        "sensors": [
            {"sensor_id": s_id, "enabled": s_id not in simulator_state["disabled_sensors"]}
            for s_id in simulator_state.get("all_sensor_ids", [])
        ]
    }
```

Populate `all_sensor_ids` once at the top of `main_loop()`:

```python
simulator_state["all_sensor_ids"] = [s.sensor_id for _, s in all_sensors]
```

### Step 5.4 — UI: add a sensor list with toggles

In the HTML in `get_ui()`, add a new card:

```html
<div class="card" style="grid-column: 1 / -1">
  <h2>Sensors</h2>
  <input id="sensorFilter" placeholder="filter by id..." oninput="filterSensors(this.value)">
  <div id="sensorList" style="max-height: 320px; overflow-y: auto; margin-top: 8px"></div>
</div>
```

JS at the bottom:

```js
async function loadSensors() {
  const r = await fetch('/sensors');
  const d = await r.json();
  const list = document.getElementById('sensorList');
  list.innerHTML = d.sensors.map(s =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0">
      <span>${s.sensor_id}</span>
      <button class="btn-sm ${s.enabled ? 'btn-danger' : 'btn-accent'}"
              onclick="toggleSensor('${s.sensor_id}', ${!s.enabled})">
        ${s.enabled ? 'Disable' : 'Enable'}
      </button>
    </div>`).join('');
}
async function toggleSensor(id, enable) {
  await post(`/sensor/${id}/${enable ? 'enable' : 'disable'}`);
  loadSensors();
}
function filterSensors(q) {
  q = q.toLowerCase();
  for (const row of document.querySelectorAll('#sensorList > div')) {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  }
}
loadSensors();
setInterval(loadSensors, 10000);
```

### Step 5.5 — Rebuild + redeploy simulator

Simulator image is `ghcr.io/smart-campus-digital-twin/campus-simulator:v3`, `imagePullPolicy: Always`. Push to the v3 tag (or bump to v4):

```powershell
git add simulator/main.py
git commit -m "feat(simulator): per-sensor enable/disable toggles + sensor list UI"
git push
# Wait for GHCR build (.github/workflows/docker-build.yml)
kubectl rollout restart deploy/simulator -n campus
```

### Step 5.6 — Verify

```powershell
curl -sk https://campus.129-212-208-120.nip.io/simulator/sensors | python -m json.tool | findstr enabled | findstr true | measure-object -line
```

Visit `https://campus.129-212-208-120.nip.io/simulator/` — sensors card lists all sensor IDs with per-row Disable buttons.

---

## Section 6 — Expose Mosquitto to the public internet for external edge devices

Currently `mosquitto` is `ClusterIP None` (headless StatefulSet service). External edge devices cannot publish to it.

**Two safe paths exist.** Pick one with the user — they have different security and cost implications.

### Path A — Dedicated MQTT TCP LoadBalancer (RECOMMENDED for production)

Open TCP port 1883 (or better, 8883 for MQTT-over-TLS) on a new LoadBalancer service. Nginx/Kong Ingress is HTTP-only; for raw MQTT you need a Layer-4 LB.

#### A.1 — Create the LoadBalancer service

Create `deployment/k8s/mosquitto-lb.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mosquitto-lb
  namespace: campus
  annotations:
    service.beta.kubernetes.io/do-loadbalancer-protocol: "tcp"
    # Optional TLS termination at DO LB — requires uploading cert as a DO certificate first
    # service.beta.kubernetes.io/do-loadbalancer-tls-passthrough: "true"
spec:
  type: LoadBalancer
  selector:
    app: mosquitto
  ports:
    - name: mqtt
      port: 1883
      targetPort: 1883
      protocol: TCP
    - name: mqtts
      port: 8883
      targetPort: 8883
      protocol: TCP
```

```powershell
kubectl apply -f deployment/k8s/mosquitto-lb.yaml
kubectl get svc mosquitto-lb -n campus
```

Wait for `EXTERNAL-IP` to populate (1-2 min on DigitalOcean).

#### A.2 — Enable TLS listener in Mosquitto (REQUIRED for public exposure)

> **Security warning:** Exposing Mosquitto on port 1883 without TLS sends usernames and passwords in cleartext over the public internet. This is unacceptable for any non-test use. Configure TLS first.

Get a cert for an MQTT hostname (e.g. `mqtt.129-212-208-120.nip.io` via cert-manager — same Issuer as Kong). Mount the secret into Mosquitto. Edit `infra/mosquitto/mosquitto.conf`:

```
listener 8883
protocol mqtt
cafile /mosquitto/tls/ca.crt
certfile /mosquitto/tls/tls.crt
keyfile /mosquitto/tls/tls.key
require_certificate false
```

And mount the `mqtt-tls` Secret in `deployment/k8s/mosquitto.yaml`. After this is verified, **remove the plaintext `listener 1883` from the LB** by deleting the `mqtt` port from `mosquitto-lb.yaml` and reapplying.

#### A.3 — Per-device credentials

Do NOT reuse `MQTT_USERNAME` for external devices. Generate per-device credentials:

```powershell
kubectl exec -n campus mosquitto-0 -- mosquitto_passwd -b /mosquitto/data/passwd edge-device-001 'random-strong-password-1'
kubectl exec -n campus mosquitto-0 -- mosquitto_passwd -b /mosquitto/data/passwd edge-device-002 'random-strong-password-2'
```

Restrict ACL: only the simulator user can publish to internal topics; edge devices can only publish to `campus/edge/<device-id>/#`.

Create `/mosquitto/data/acl` content:

```
user simulator
topic readwrite campus/#

user edge-device-001
topic write campus/edge/edge-device-001/#

user edge-device-002
topic write campus/edge/edge-device-002/#

pattern read campus/cmd/%u/#
```

Add to `mosquitto.conf`:

```
acl_file /mosquitto/data/acl
```

Restart mosquitto.

### Path B — WebSocket-only via Kong (NO new LB)

Mosquitto already has a WebSocket listener on `9001` and Kong already proxies `/mqtt → mosquitto:9001`. External edge devices that support MQTT-over-WSS can connect to `wss://campus.129-212-208-120.nip.io/mqtt` with HTTP auth.

Constraints:
- Edge devices must use an MQTT client that supports WebSocket transport (Paho-MQTT Python and Eclipse Mosquitto C clients both do, with `transport='websockets'`).
- Higher latency than raw TCP, and per-message overhead is larger.

If Path B is acceptable, **no Kubernetes changes are needed**; only docs telling edge devices the URL. The TLS is already done by Kong's existing cert.

### Step 6.3 — Verify

From a non-cluster machine:

```powershell
# Path A
mosquitto_pub -h <MOSQUITTO_LB_IP> -p 8883 --cafile letsencrypt.crt -u edge-device-001 -P 'random-strong-password-1' -t 'campus/edge/edge-device-001/test' -m '{"hello":1}'

# Path B
mosquitto_pub -h campus.129-212-208-120.nip.io -p 443 --tls-version tlsv1.2 --capath /etc/ssl/certs -u edge-device-001 -P 'random-strong-password-1' -t 'campus/edge/edge-device-001/test' -m '{"hello":1}' -V mqttv311 -L wss://campus.129-212-208-120.nip.io/mqtt
```

Subscribe from another shell to confirm:

```powershell
kubectl exec -n campus mosquitto-0 -- mosquitto_sub -u simulator -P "$MQTT_PASSWORD" -t 'campus/edge/#'
```

---

## Section 7 — Verification checklist

After Sections 1-6 are applied, every line below must pass:

```powershell
# 1. Duplicate namespace gone
kubectl get ns smart-campus 2>&1 | findstr "not found"

# 2. Kafka retention reduced
kubectl exec -n campus kafka-0 -- /opt/kafka/bin/kafka-configs.sh --bootstrap-server localhost:9092 --entity-type brokers --entity-name 1 --describe | findstr "log.retention.ms=86400000"

# 3. Influx downsample tasks active
kubectl exec -n campus influxdb-0 -- influx task list --org smart-campus --token $TOKEN | findstr downsample

# 4. campus_1h bucket has rows
kubectl exec -n campus influxdb-0 -- influx query 'from(bucket:"campus_1h") |> range(start:-2h) |> count()' --org smart-campus --token $TOKEN

# 5. Frontend live updates — open in browser, watch CAMPUS ENERGY tick every 5s

# 6. Simulator per-sensor endpoint
curl -sk https://campus.129-212-208-120.nip.io/simulator/sensors | python -m json.tool | findstr sensor_id | measure-object -line

# 7. Mosquitto LB exposes public IP (Path A) OR WSS reachable (Path B)
kubectl get svc mosquitto-lb -n campus
```

---

## Commit strategy

One commit per logical change:

1. `chore(k8s): delete orphaned smart-campus namespace stack`
2. `fix(kafka): drop log retention to 24h, add size cap and segment limit`
3. `fix(mosquitto): cap persistence size and queue depth`
4. `fix(influxdb): re-register downsample_1m_to_1h and downsample_1h_to_1d tasks`
5. `feat(infra): postgres VACUUM ANALYZE nightly CronJob`
6. `chore(bridge): reduce forwarded-message log spam by 1000x`
7. `fix(frontend): polling fallback when WS is unavailable`
8. `feat(simulator): per-sensor enable/disable endpoints + UI`
9. `feat(mosquitto): TLS listener + dedicated LB for external edge devices` (DO NOT commit per-device passwords — load from Secret)

Do not push 9 until TLS works; otherwise edge credentials traverse plaintext on first use.

---

## Things NOT to touch in this task

- The Kong HTTP→HTTPS redirect (already in place).
- The Let's Encrypt cert / cert-manager Issuer.
- The Keycloak hostname env vars (separate plan v3 handles those).
- The `digital-twin-ui` KC client.
- `KC_PROXY_HEADERS=xforwarded`.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Kafka pod OOMKills after retention change | Segment rebalance allocates extra heap | Bump `KAFKA_HEAP_OPTS` to `-Xmx1024m -Xms512m` |
| Influx task `failed` immediately | Wrong bucket name in `.flux` | Check `_destination_bucket` and case-sensitivity |
| Frontend still empty after polling | Bucket/measurement mismatch | Compare bridge writer config vs API reader config |
| Mosquitto LB stuck `<pending>` IP | DO quota for LBs hit | Reuse the Kong LB and route over Kong instead (Path B) |
| Simulator `disabled_sensors` not honored | Set was reset on rollout | Persist set in Redis or accept ephemeral behavior (document as known limitation) |
