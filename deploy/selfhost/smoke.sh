#!/bin/sh
# Checks a fresh deploy/selfhost install end to end. Run from the install
# folder with the installer's log (it holds the admin password):
#   sh smoke.sh install.log
# Used by .github/workflows/publish-selfhost-images.yml before any image is pushed.
set -eu
log=${1:?usage: sh smoke.sh install.log}
port=$(sed -n 's/^MUSHI_PORT=//p' .env | tail -1)
base="http://127.0.0.1:${port:-3000}"
api="$base/functions/v1/api"
fail() { echo "smoke: $*" >&2; exit 1; }

sh mushi.sh status
curl -fsS "$base/healthz" >/dev/null || fail "console not answering"
public_url=$(sed -n 's/^MUSHI_PUBLIC_URL=//p' .env | tail -1)
cfg=$(curl -fsS "$base/runtime-config.js")
printf '%s' "$cfg" | grep -q '"instanceType": "self-hosted"' || fail "console runtime config missing"
printf '%s' "$cfg" | grep -qF "\"supabaseUrl\": \"${public_url%/}\"" || fail "console is not configured for $public_url"
printf '%s' "$cfg" | grep -q '"supabaseAnonKey": "ey' || fail "console has no public key"
curl -fsS "$api/health/ready" >/dev/null || fail "API not ready"

pass=$(sed -n 's/^  Password: \([^ ]*\).*/\1/p' "$log")
anon=$(sed -n 's/^ANON_KEY=//p' .env)
token=$(curl -fsS -X POST "$base/auth/v1/token?grant_type=password" \
  -H "apikey: $anon" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$(sed -n 's/^  Sign in:  //p' "$log")\",\"password\":\"$pass\"}" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$token" ] || fail "admin sign-in failed"

pid=$(curl -fsS -X POST "$api/v1/admin/projects" -H "Authorization: Bearer $token" -H "apikey: $anon" \
  -H 'Content-Type: application/json' -d '{"name":"Smoke"}' | sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' | head -1)
[ -n "$pid" ] || fail "project not created"
key=$(curl -fsS -X POST "$api/v1/admin/projects/$pid/keys" -H "Authorization: Bearer $token" -H "apikey: $anon" \
  -H 'Content-Type: application/json' -d '{"label":"smoke"}' | sed -n 's/.*"key":"\([^"]*\)".*/\1/p')
[ -n "$key" ] || fail "API key not minted"

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -fsS -X POST "$api/v1/reports" -H "X-Mushi-Api-Key: $key" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$pid\",\"description\":\"Smoke: pay button does nothing\",\"category\":\"bug\",\"environment\":{\"url\":\"https://example.com/\",\"userAgent\":\"smoke\",\"platform\":\"smoke\",\"language\":\"en\",\"timezone\":\"UTC\",\"viewport\":{\"width\":1,\"height\":1},\"referrer\":\"\",\"timestamp\":\"$now\"},\"reporterToken\":\"smoke-0001\",\"createdAt\":\"$now\"}" \
  >/dev/null || fail "report not accepted"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/auth/v1/signup" -H "apikey: $anon" \
  -H 'Content-Type: application/json' -d '{"email":"stranger@example.com","password":"long-enough-1"}')
[ "$code" != 200 ] || fail "open sign-up is not closed"

docker compose exec -T db psql -U postgres -At -c \
  "select value from public.mushi_runtime_config where key = 'supabase_url'" | grep -qx 'http://api-gw:8000' \
  || fail "scheduled jobs do not call this install"

if docker compose ps --format '{{.Ports}}' | grep -q '0.0.0.0'; then fail "a port is published beyond loopback"; fi

i=0
until [ "$(docker compose exec -T db psql -U postgres -At -c "select status from public.reports where project_id = '$pid' limit 1")" = classified ]; do
  i=$((i + 1)); [ $i -ge 24 ] && fail "report was not classified"; sleep 5
done
echo "smoke: ok (sign-in, project, key, report classified, sign-up closed, loopback only)"
