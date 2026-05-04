#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8083}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-campus}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-campus-dev}"
KEYCLOAK_USERNAME="${KEYCLOAK_USERNAME:-dev}"
KEYCLOAK_PASSWORD="${KEYCLOAK_PASSWORD:-dev}"

TOKEN_ENDPOINT="${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"

resp=$(curl -sf -X POST "$TOKEN_ENDPOINT" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=password" \
  --data-urlencode "client_id=${KEYCLOAK_CLIENT_ID}" \
  --data-urlencode "username=${KEYCLOAK_USERNAME}" \
  --data-urlencode "password=${KEYCLOAK_PASSWORD}")

token=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["access_token"])' <<<"$resp")

echo "$token"
