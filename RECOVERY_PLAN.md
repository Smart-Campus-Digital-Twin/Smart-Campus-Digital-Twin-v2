# Recovery Plan — Cluster Won't Start

For a junior model. Follow in order. **Do not skip diagnosis steps.** Verify each fix before moving on.

Context: After Checkpoint 3 work + recent kustomization additions, nothing runs properly. This doc lists every defect I can spot from manifests alone, in priority order, with the fix.

Cluster URL: `https://campus.129-212-208-120.nip.io` (Kong LoadBalancer at `129.212.208.120`).
Active namespace: `campus`.

---

## Section 0 — Diagnose first

Before touching anything, capture state. Save the output of every command. Without this, fixes are guesses.

```powershell
kubectl get ns
kubectl get pods -A -o wide
kubectl get pods -n campus
kubectl get svc -n campus
kubectl get pvc -n campus
kubectl get events -n campus --sort-by='.lastTimestamp' | tail -50
argocd app get smart-campus
```

For every pod that is **not** `Running` `1/1` (Completed is OK for kafka-init):

```powershell
kubectl describe pod <name> -n campus | tail -60
kubectl logs <name> -n campus --tail=100
kubectl logs <name> -n campus --previous --tail=100   # if crashlooping
```

Tabulate them in `pod_status.txt` so we know what's actually broken vs assumed.

---

## Section 1 — Known manifest defects (fix all before re-syncing)

These are real bugs in the YAML right now. Each one breaks at least one pod or makes ArgoCD fail.

### 1.1 — `simulator.yaml` deploys into a namespace that's not in `kustomization.yaml`

`@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\simulator.yaml:5` has `namespace: campus-simulator`. The Namespace object is defined in `@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\simulator-namespace.yaml:1-5`. Neither file is listed in `@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\kustomization.yaml:6-34`.

Also: kustomization has `namespace: campus` globally (line 4). Kustomize **overrides** the per-resource `namespace` field unless you exclude the resource. Result: even if you add `simulator.yaml` to resources, it will land in `campus` namespace, not `campus-simulator`.

**Fix — pick one:**

- **Option A (simplest):** Edit `simulator.yaml` and `simulator-namespace.yaml` — delete the simulator namespace concept, set everything to `campus`. Then add `simulator.yaml` (only) to `kustomization.yaml` resources. Delete `simulator-namespace.yaml`.
- **Option B:** Move simulator out of this kustomization into its own ArgoCD app. Out of scope for now — use A.

```yaml
# simulator.yaml — change line 5 and line 42
namespace: campus
```

Then in kustomization.yaml resources list, add `- simulator.yaml` and delete `simulator-namespace.yaml` file.

### 1.2 — `kong.template.yml` is missing every new route documented in `context.md`

`@d:\SE Project\Smart-Campus-Digital-Twin-v2\infra\kong\kong.template.yml` defines only: `/api`, `/auth`, `/grafana`, `/`.

`context.md` says Kong serves: `/`, `/api`, `/ws`, `/auth`, `/resources`, `/grafana`, `/simulator`, `/mqtt`, `/.well-known/acme-challenge`.

Missing routes that **break running features**:
- `/ws` — WebSocket pass-through to API. Without it, frontend "no live updates" (Section 4 of `FIX_PIPELINE_AND_INFRA_PLAN.md`).
- `/.well-known/acme-challenge` — cert-manager HTTP-01 challenge. Without it, the LE cert renewal will fail in ~30 days; if cert hasn't been issued yet, it never will be.
- `/resources` — Keycloak admin SPA assets. Admin console looks broken.
- `/simulator` — simulator UI access (only relevant after 1.1 is done).
- `/mqtt` — Mosquitto WebSocket bridge.

Also `/auth` route has `strip_path: true` (line 22) which strips `/auth` before forwarding — but Keycloak runs with `KC_HTTP_RELATIVE_PATH=/auth` (`@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\keycloak.yaml:34-35`) so it expects `/auth` in the upstream URL. **`strip_path` must be `false` for `/auth`.**

Also `keycloak-svc.url` is `http://keycloak:8083` in the template but the Keycloak Service is on port `8080` (`@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\keycloak.yaml:90`). Fix to `http://keycloak:8080`.

**Fix:** Rewrite `infra/kong/kong.template.yml` to include all routes. Reference shape:

```yaml
_format_version: "3.0"
_transform: true

services:
  - name: campus-api
    url: http://api:8000
    routes:
      - name: api-rest
        paths: ["/api"]
        strip_path: true
      - name: api-ws
        paths: ["/ws"]
        strip_path: false
        protocols: ["http", "https"]

  - name: keycloak-svc
    url: http://keycloak:8080
    routes:
      - name: keycloak-auth
        paths: ["/auth"]
        strip_path: false        # KC expects /auth in URL
      - name: keycloak-resources
        paths: ["/resources"]
        strip_path: false

  - name: grafana-svc
    url: http://grafana:3000
    routes:
      - name: grafana-ui
        paths: ["/grafana"]
        strip_path: true

  - name: simulator-svc
    url: http://simulator.campus.svc.cluster.local:8002
    routes:
      - name: simulator-ui
        paths: ["/simulator"]
        strip_path: true

  - name: mosquitto-ws
    url: http://mosquitto:9001
    routes:
      - name: mqtt-ws
        paths: ["/mqtt"]
        strip_path: true
        protocols: ["http", "https"]

  - name: acme-solver
    url: http://cm-acme-http-solver:8089
    routes:
      - name: acme-challenge
        paths: ["/.well-known/acme-challenge"]
        strip_path: false
        preserve_host: true

  - name: campus-frontend
    url: http://frontend:80
    routes:
      - name: frontend-root
        paths: ["/"]
        strip_path: false

plugins:
  - name: rate-limiting
    config: { minute: 600, policy: local }
  - name: cors
    config:
      origins: ["https://campus.129-212-208-120.nip.io", "http://129.212.208.120"]
      methods: [GET, POST, PUT, PATCH, DELETE, OPTIONS]
      headers: [Authorization, Content-Type, Accept]
      max_age: 3600
  - name: jwt
    service: campus-api
    config:
      key_claim_name: iss
      claims_to_verify: [exp]
      run_on_preflight: false

consumers:
  - username: keycloak
    jwt_secrets:
      - key: "__JWT_ISSUER__"
        algorithm: RS256
        rsa_public_key: |
          __JWT_RSA_PUBLIC_KEY__
```

Note: `__JWT_ISSUER__` and `__JWT_RSA_PUBLIC_KEY__` are replaced by the render script.

### 1.3 — Kong has no HTTP→HTTPS redirect plugin

`context.md` claims a global `pre-function` Lua plugin redirects HTTP → HTTPS. Not in `kong.template.yml`. Either the redirect is gone, or it lives somewhere else (check git log). Without it, browsers hitting `http://campus...nip.io` get the bare Kong instead of a redirect.

**Fix:** Add to `plugins:` in `kong.template.yml`:

```yaml
  - name: pre-function
    config:
      access:
        - |
          if kong.request.get_scheme() == "http"
             and not string.find(kong.request.get_path(), "^/%.well%-known/acme%-challenge/") then
            return kong.response.exit(301, "",
              { ["Location"] = "https://campus.129-212-208-120.nip.io" .. kong.request.get_path_with_query() })
          end
```

### 1.4 — `kong-certificate.yaml` uses `Issuer` with `http01.ingress: {}` but cluster has no Ingress controller

`@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\kong-certificate.yaml:13-14`. cert-manager will create an Ingress resource for the challenge — with no controller, the Ingress is orphaned and the challenge times out. The cert in `Secret/kong-tls` will never refresh (and if it doesn't already exist, never gets issued).

The current architecture (per `context.md`) uses `cm-acme-http-solver` Service + a Kong route to proxy `/.well-known/acme-challenge` to the solver. This needs the **Gateway API** style solver or `selfHosted` mode. With the existing Issuer config (`solvers: [{ http01: { ingress: {} }}]`), it cannot work without an Ingress controller.

**Fix — quickest:** Switch the solver to use a `serviceType: ClusterIP` mode and rely on Kong route (already in 1.2 above):

```yaml
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: bitbrigadeteam@gmail.com
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
      - http01:
          ingress:
            serviceType: ClusterIP   # cert-manager creates only a Service, not Ingress
```

Then the `cm-acme-http-solver` selector label (`acme.cert-manager.io/http01-solver: "true"`) in `acme-solver-svc.yaml` will pick up the challenge pod, and Kong's `/.well-known/acme-challenge` route (1.2) forwards to it.

**Verify** by running `kubectl get certificate -n campus` and looking at `READY`. If `False`, `kubectl describe certificate kong-tls -n campus` shows the failure reason.

### 1.5 — `konnect.yaml` CronJob is broken (`ImagePullBackOff`)

`context.md` lists `konnect-sync-*` as broken. Konnect is a paid Kong SaaS feature; without the right token + control plane it's noise.

**Fix:** Until Konnect is genuinely needed, remove from kustomization:

Delete the line `- konnect.yaml` from `@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\kustomization.yaml:27`. Keep the file (you may re-enable later).

After ArgoCD syncs, the CronJob is pruned and the failing pods stop respawning.

### 1.6 — `ml-retrain-daemon` is in `CrashLoopBackOff` (75 restarts)

`@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\ml-retrain-daemon.yaml` clones the repo at runtime and `pip install`s. Likely failure: missing env (`MLFLOW_TRACKING_URI` is set, but `bootstrap_training.py` needs InfluxDB token + secrets).

**Diagnose first:**

```powershell
kubectl logs deploy/ml-retrain-daemon -n campus --tail=200
```

**Quick fix until root cause is known:** scale to 0 so it stops spamming events.

```powershell
kubectl scale deploy/ml-retrain-daemon -n campus --replicas=0
```

Then read the actual error and fix it. Don't re-enable until the underlying `bootstrap_training.py` exit is debugged.

### 1.7 — Kong's `kong-config-render` initContainer waits forever if KC or API is down

`@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\kong.yaml:39-46` — `until curl -sf $KEYCLOAK/realms/campus`. If Keycloak's password is wrong (Checkpoint 3 issue), Keycloak never returns 200 on realm endpoint, Kong's init never finishes, **Kong stays Pending**, all routes are 404.

**Confirm:**

```powershell
kubectl describe pod -l app=kong -n campus | findstr -i "init"
kubectl logs -n campus -l app=kong -c kong-config-render --tail=50
```

If it's looping on "Waiting for Keycloak", **fix Keycloak first** (Section 2).

### 1.8 — `mosquitto-lb` exposes port 8883 (TLS) but Mosquitto has no TLS listener

`@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\mosquitto-lb.yaml:13-15` opens 8883. `@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\k8s\configmap-extras.yaml:8-21` only configures `listener 1883` + `listener 9001 websockets`.

This isn't crash-causing but the LoadBalancer is useless and burns a DigitalOcean LB ($12/mo).

**Fix — pick one:**
- Short term: delete `mosquitto-lb.yaml` from kustomization until TLS is configured (cheap).
- Long term: follow Section 6 of `FIX_PIPELINE_AND_INFRA_PLAN.md` (TLS listener + cert).

### 1.9 — Missing `postgres-exporter.yaml`

`context.md` line 122 says `postgres-exporter` is running, but the file doesn't exist in `deployment/k8s/`. Either:

- It used to be there and got deleted (kustomization will prune it — good, if intentional)
- ArgoCD has stale state

Check `argocd app diff smart-campus`. If `postgres-exporter` appears under "live but not desired", that's prune-fodder. Either re-add the file or accept the prune.

---

## Section 2 — Keycloak / Postgres auth (Checkpoint 3 issue, still likely active)

Last session: Keycloak couldn't connect to Postgres (`FATAL: password authentication failed for user "campus"`). PostgreSQL only sets its superuser password on first init from an **empty PVC**. If the secret has been changed since then, the DB password is stale.

### 2.1 — Verify

```powershell
kubectl exec -n campus statefulset/postgres -- psql -U campus -d campus -c "\l"
```

If this prompts for password and fails, the secret and DB are out of sync.

### 2.2 — Reset DB password to match secret

```powershell
$pw = kubectl get secret campus-postgres -n campus -o jsonpath='{.data.POSTGRES_PASSWORD}' | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
echo $pw
kubectl exec -n campus statefulset/postgres -- env PGPASSWORD=$pw psql -U campus -d campus -c "ALTER USER campus WITH PASSWORD '$pw';"
```

(If the above `exec` is what's currently failing because of the password mismatch — first reset via `kubectl exec -- bash` and edit `pg_hba.conf` to `trust` temporarily, ALTER, then revert. This is delicate; read https://www.postgresql.org/docs/16/auth-pg-hba-conf.html before doing it.)

### 2.3 — Restart Keycloak

```powershell
kubectl rollout restart deploy/keycloak -n campus
kubectl rollout status deploy/keycloak -n campus --timeout=5m
```

Once Keycloak is `Ready 1/1`, Kong's init container will exit and Kong will start serving routes.

---

## Section 3 — Apply order

After 1.1 through 1.9 + Section 2 are done:

1. Commit each fix as its own commit (see "Commit list" at bottom).
2. Push to `v3`:

   ```powershell
   git push origin v3
   ```

3. Wait for the GitHub Actions build (for any image-affecting changes).
4. Force ArgoCD to sync:

   ```powershell
   argocd app sync smart-campus --prune
   ```

5. Watch:

   ```powershell
   kubectl get pods -n campus -w
   ```

   Every pod should reach `Running 1/1` within 5 minutes. If not, GOTO Section 0 for the offending pod.

---

## Section 4 — Verification matrix (all must pass)

| # | Check | Command |
|---|---|---|
| 1 | All campus pods Ready | `kubectl get pods -n campus -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'` — every line must say `Running` |
| 2 | Kong LB up | `kubectl get svc kong -n campus` → `EXTERNAL-IP` is `129.212.208.120` |
| 3 | LE cert issued | `kubectl get certificate kong-tls -n campus` → `READY=True` |
| 4 | Frontend loads | `curl -ksI https://campus.129-212-208-120.nip.io/` returns 200 |
| 5 | KC OIDC discovery | `curl -ks https://campus.129-212-208-120.nip.io/auth/realms/campus/.well-known/openid-configuration | jq .issuer` returns `https://campus.129-212-208-120.nip.io/auth/realms/campus` |
| 6 | API JWT-protected | `curl -ksI https://campus.129-212-208-120.nip.io/api/campus/zones` → 401 (no token) |
| 7 | WS reachable | `wscat -c wss://campus.129-212-208-120.nip.io/ws/live` → connects (no 404) |
| 8 | ArgoCD synced | `argocd app get smart-campus` → `Sync Status: Synced`, `Health: Healthy` |

---

## Section 5 — Commit list

Apply in order; one commit each:

1. `fix(simulator): collapse simulator into campus namespace; add to kustomization`
2. `fix(kong): restore /ws, /resources, /simulator, /mqtt, /.well-known/acme-challenge routes + HTTPS redirect`
3. `fix(kong): correct keycloak upstream port (8080) and /auth strip_path=false`
4. `fix(cert-manager): http01 solver uses serviceType=ClusterIP (no ingress controller in cluster)`
5. `chore(kustomize): disable broken konnect-sync CronJob`
6. `chore(ml-retrain-daemon): scale to 0 pending root-cause debug`
7. `chore(mosquitto-lb): remove until TLS listener configured`

---

## Section 6 — Out of scope (do not touch)

- ArgoCD application manifest (`@d:\SE Project\Smart-Campus-Digital-Twin-v2\deployment\argocd\application.yaml`) — fine as is.
- Postgres data PVC — never delete; reset password in place.
- The bridge ConfigMap script — last session's merge resolution is correct.
- Keycloak realm-config import strategy (`IGNORE_EXISTING`) — already correct.

---

## Section 7 — Escalation triggers (stop and report)

If any of the below happen, halt and report:

- `kubectl get pod postgres-0 -n campus` is `Pending` (no node has 10Gi free) — needs storage class fix, not in this plan.
- Kong's LoadBalancer EXTERNAL-IP becomes `<pending>` and stays that way for >10 min — DO LB quota exhausted; remove `mosquitto-lb` first.
- ArgoCD shows `OutOfSync` with diff in `campus-postgres` Secret data — never overwrite Secret data from manifests; manifests should match the on-cluster secret created by `local/apply-secrets.sh`.
