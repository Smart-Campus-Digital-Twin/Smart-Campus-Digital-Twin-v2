# Smart Campus Digital Twin — Current Status

Snapshot of cluster + deployment state after Plans v1/v2/v3 implemented.

---

## Entry points (public)

| URL | Purpose |
|---|---|
| `https://campus.129-212-208-120.nip.io/` | Frontend (Next.js) |
| `https://campus.129-212-208-120.nip.io/auth/admin/` | Keycloak master admin console |
| `https://campus.129-212-208-120.nip.io/api/...` | REST API (JWT required) |
| `https://campus.129-212-208-120.nip.io/grafana/` | Grafana |
| `http://129.212.208.120/` | 301 → HTTPS nip.io (except `/.well-known/acme-challenge/*`) |

All HTTPS via Let's Encrypt cert on `campus.129-212-208-120.nip.io`. Cert auto-renews via cert-manager HTTP-01 challenge.

---

## Architecture

```
Browser → Kong LoadBalancer (129.212.208.120 ports 80+443)
            ├─ /                       → frontend:80 (pod port 3000)
            ├─ /api                    → api:8000 (JWT validated)
            ├─ /ws                     → api:8000 (WebSocket pass-through)
            ├─ /auth                   → keycloak:8080 (no strip)
            ├─ /resources              → keycloak:8080/auth (KC admin SPA assets)
            ├─ /grafana                → grafana:3000 (strip)
            ├─ /simulator              → simulator.campus-simulator:8002 (strip)
            ├─ /mqtt                   → mosquitto:9001 (strip)
            └─ /.well-known/acme-challenge → cm-acme-http-solver:8089
                                            (preserve_host=true, skips HTTPS redirect)
```

---

## Keycloak config (deployment/k8s/keycloak.yaml)

| Env | Value |
|---|---|
| `KC_HTTP_RELATIVE_PATH` | `/auth` |
| `KC_HOSTNAME` | `https://campus.129-212-208-120.nip.io/auth` |
| `KC_HOSTNAME_ADMIN` | `https://campus.129-212-208-120.nip.io/auth` |
| `KC_HOSTNAME_STRICT` | `true` (ignore X-Forwarded-Host; always emit nip.io URLs) |
| `KC_HOSTNAME_STRICT_BACKCHANNEL` | `false` (internal `keycloak:8080` stays loose for Kong JWKS) |
| `KC_HTTP_ENABLED` | `true` (required with strict hostname) |
| `KC_PROXY_HEADERS` | `xforwarded` (X-Forwarded-Proto detection) |

Service: `ClusterIP keycloak:8080` (no direct external exposure).

postStart hook: `kcadm update realms/master -s sslRequired=NONE` on every pod boot.

**Stale DB attribute removed manually**: `DELETE FROM realm_attribute WHERE name='frontendUrl'` (was caching `http://129.212.208.120/`).

---

## Kong config (deployment/k8s/kong.yaml + infra/kong/kong.template.yml)

Listeners: `8000` plain HTTP, `8443 ssl` HTTPS. Service exposes both 80 + 443.

TLS: `Secret/kong-tls` (LE cert, issued by cert-manager, mounted optional).

JWT plugin on `/api` validates `iss=https://campus.129-212-208-120.nip.io/auth/realms/campus` against KC JWKS.

CORS origins include both `http://129.212.208.120` and `https://campus.129-212-208-120.nip.io`.

Global `pre-function` plugin (Lua): HTTP requests → 301 to `https://campus.129-212-208-120.nip.io/<path>`, except `/.well-known/acme-challenge/*` (cert renewal must keep working).

---

## cert-manager + Let's Encrypt

- `cert-manager` v1.15.3 installed in `cert-manager` namespace.
- Namespaced `Issuer/letsencrypt-prod` in `campus` (HTTP-01 solver, no ingress controller).
- `Certificate/kong-tls` → `Secret/kong-tls` (CN `campus.129-212-208-120.nip.io`, 90-day, auto-renew at 75-day).
- Issued by `C=US, O=Let's Encrypt, CN=R12`, valid until Aug 2026.

Stable solver service `cm-acme-http-solver` (in `campus`) selects all `acme.cert-manager.io/http01-solver=true` pods → Kong routes to this fixed name (deployment/k8s/acme-solver-svc.yaml).

---

## Realm config (deployment/k8s/infra/keycloak/realm-campus.json)

- `sslRequired: none`
- `registrationAllowed: true`
- `registrationEmailAsUsername: true`
- `resetPasswordAllowed: true`
- `rememberMe: true`
- `verifyEmail: false`

Clients:
- `campus-dev` — public, password grant only (dev/dev user)
- `campus-frontend` — public, standard flow + PKCE S256, redirect URIs include `https://campus.129-212-208-120.nip.io/*`

Realm uses `IGNORE_EXISTING` import strategy — existing realm not overwritten on pod restart, kcadm used for live changes.

---

## Frontend (frontend/frontend/)

`src/components/auth/KeycloakProvider.tsx`:
- `onLoad: "check-sso"` (was `login-required`) — homepage renders anonymous before redirect
- `silentCheckSsoRedirectUri` → `/silent-check-sso.html` (public asset added)
- New `register()` action calls `keycloak.register()` → KC registration page

`src/components/Navbar.tsx`: anonymous state now shows **Sign in** + **Sign up** buttons.

Image built via GitHub Actions on push to `v3` → `ghcr.io/smart-campus-digital-twin/campus-frontend:v3` with `imagePullPolicy: Always`. Restart pod after CI build:
```powershell
kubectl rollout restart deploy/frontend -n campus
```

---

## Cluster pods (campus namespace, snapshot)

**Running:**
- api, frontend, keycloak, kong, grafana, prometheus, mlflow, ml-prediction, ml-consumer
- bridge, simulator, kafka, kafka-init (Completed), mosquitto, redis, influxdb, postgres
- node-exporter, postgres-exporter, postgres-observer

**Known broken (out of scope for this work):**
- `konnect-sync-*` — `ImagePullBackOff` / `Evicted` (decK Konnect job, unused)
- `ml-retrain-daemon-*` — `CrashLoopBackOff` (75 restarts)
- `mlflow-*-lsp6m` — `Error` (old pod, new one `mlflow-*-59p9v` Running)

---

## Services (campus namespace)

| External | Type | IP |
|---|---|---|
| `kong` | LoadBalancer | `129.212.208.120` (80+443) |
| `grafana` | LoadBalancer | `167.99.29.166:3000` (direct, dev only) |
| `influxdb` | LoadBalancer | `139.59.219.159:8086` (direct, dev only) |

All other services ClusterIP (internal).

---

## Git history (recent)

```
6d286e8 fix(keycloak): strict hostname v2 + enable signup + frontend sign-up button
737e333 fix(kong): 301 redirect HTTP → HTTPS nip.io, skip ACME challenge path
8bde971 feat(infra): stable ACME solver service for cert-manager HTTP01
3362154 fix(kong): preserve_host on ACME challenge route
2766e38 feat: HTTPS via cert-manager + Let's Encrypt for nip.io hostname
7f17965 fix: Kong frontend upstream port 3000 → 80 (service port not pod port)
dbb0026 chore: remove orphaned nginx Ingress (no ingress controller deployed)
c741ac4 fix: Keycloak auth flow through Kong (full plan implementation)
```

Branch: `v3`. ArgoCD `smart-campus` app syncs from this branch.

---

## What works (verified end-to-end)

- ✅ `https://campus.129-212-208-120.nip.io/` → frontend SPA loads
- ✅ `https://campus.129-212-208-120.nip.io/auth/admin/master/console/config` → `auth-server-url: https://...nip.io/auth` (HTTPS + /auth, no mixed content)
- ✅ OIDC discovery → issuer `https://campus.129-212-208-120.nip.io/auth/realms/campus`
- ✅ JWT auth: password grant from `campus-dev` → API `/health` returns 200
- ✅ HTTP → 301 → HTTPS nip.io
- ✅ ACME challenge path bypasses redirect (cert renewal works)
- ✅ Kong TLS uses LE cert (browser shows valid padlock)
- ✅ `registrationAllowed: true` on `campus` realm
- ✅ KC admin assets served via `/resources` route through Kong

---

## What user still needs to do

1. Wait CI build of frontend image (commit `6d286e8`) — check GitHub Actions
2. After image ready: `kubectl rollout restart deploy/frontend -n campus`
3. Incognito browser → `https://campus.129-212-208-120.nip.io/` → verify Sign up button + KC registration form
4. Clear old `http://129.212.208.120` site data in DevTools if Mixed Content errors persist (cached service worker)

---

## What's NOT done (per user choice / out of scope)

- **Google IdP** — needs OAuth Client ID/Secret from Google Cloud Console (Plan v3 Sec 4). Run when ready:
  ```
  kcadm create identity-provider/instances -r campus -s alias=google -s providerId=google \
    -s enabled=true -s 'config.clientId=...' -s 'config.clientSecret=...' \
    -s 'config.defaultScope=openid email profile' -s trustEmail=true
  ```
  Google redirect URI: `https://campus.129-212-208-120.nip.io/auth/realms/campus/broker/google/endpoint`
- HSTS header (Plan v2 Plan C) — optional hardening, not critical
- Cleanup `konnect-sync`, `ml-retrain-daemon` failing pods — unrelated to auth flow

---

## Admin access

KC master admin login: `https://campus.129-212-208-120.nip.io/auth/admin/`

Credentials in `Secret/keycloak-env` (`campus` namespace):
```powershell
kubectl get secret keycloak-env -n campus -o jsonpath='{.data.KEYCLOAK_ADMIN}' | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
kubectl get secret keycloak-env -n campus -o jsonpath='{.data.KEYCLOAK_ADMIN_PASSWORD}' | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
```

Postgres admin (campus DB + keycloak DB):
```powershell
kubectl exec -n campus postgres-0 -it -- psql -U campus -d keycloak
```
Creds in `Secret/campus-postgres` (`POSTGRES_USER=campus`, `POSTGRES_PASSWORD=campus`).
