#!/bin/sh
# Day-to-day commands for a self-hosted Mushi Mushi (run from the install folder).
#
#   sh mushi.sh status                 health of every service and the API
#   sh mushi.sh up | down | logs [svc] start, stop, follow logs
#   sh mushi.sh add-user EMAIL [PASS]  create a confirmed account (sign-up is closed)
#   sh mushi.sh backup                 stop the database ~10 s and archive it,
#                                      file storage and .env into backups/
#   sh mushi.sh restore FILE           put a backup back (replaces current data)
#   sh mushi.sh update [VERSION]       back up, pull images, restart; migrations
#                                      apply on start. VERSION: latest or sha-xxxxxxx
#   sh mushi.sh https DOMAIN           serve on https://DOMAIN with Caddy (auto TLS)
#   sh mushi.sh secrets                print the URLs and keys you need
set -eu

cd "$(dirname "$0")"
[ -f .env ] || { echo "mushi.sh: no .env here; run install.sh first" >&2; exit 1; }

env_get() { sed -n "s/^$1=//p" .env | tail -1; }
set_env() {
  if grep -q "^$1=" .env; then sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
gw() { printf 'http://127.0.0.1:%s' "$(env_get API_GW_HTTP_PORT | sed 's/^$/8000/')"; }
# A small image with tar that is always present: the migrator this install runs.
tools() { TOOLS_IMAGE="ghcr.io/kensaurus/mushi-mushi-migrate:$(env_get MUSHI_VERSION | sed 's/^$/latest/')"; }

cmd=${1:-help}
[ $# -gt 0 ] && shift

case "$cmd" in
  up) docker compose up -d --wait ;;
  down) docker compose down ;;
  logs) docker compose logs -f --tail 100 "$@" ;;

  status)
    docker compose ps --format 'table {{.Service}}\t{{.Status}}'
    migrate=$(docker compose ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' mushi-migrate 2>/dev/null || true)
    printf '\nmigrations: %s\n' "${migrate:-not run}"
    printf 'api health: '
    curl -fsS --max-time 60 "$(gw)/functions/v1/api/health/ready" || printf 'NOT READY'
    printf '\nconsole:    '
    curl -fsS --max-time 5 -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$(env_get MUSHI_PORT | sed 's/^$/3000/')/healthz" || echo 'NOT RESPONDING'
    ;;

  add-user)
    email=${1:?usage: sh mushi.sh add-user EMAIL [PASSWORD]}
    pass=${2:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)}
    key=$(env_get SERVICE_ROLE_KEY)
    body=$(printf '{"email":"%s","password":"%s","email_confirm":true}' "$email" "$pass")
    code=$(curl -sS -o /tmp/mushi-add-user.$$ -w '%{http_code}' -X POST "$(gw)/auth/v1/admin/users" \
      -H "apikey: $key" -H "Authorization: Bearer $key" -H 'Content-Type: application/json' -d "$body")
    if [ "$code" != 200 ]; then cat /tmp/mushi-add-user.$$ >&2; rm -f /tmp/mushi-add-user.$$; echo >&2; exit 1; fi
    rm -f /tmp/mushi-add-user.$$
    printf 'Created %s\nPassword: %s\n' "$email" "$pass"
    ;;

  backup)
    mkdir -p backups
    out="backups/mushi-$(date +%Y%m%d-%H%M%S).tar.gz"
    echo "Stopping the database for a consistent copy..."
    # Whatever happens below, start everything again.
    trap 'docker compose up -d --wait >/dev/null 2>&1 || echo "mushi.sh: restart failed; run: sh mushi.sh up" >&2' EXIT
    docker compose stop mushi-caddy functions mushi-admin storage realtime auth rest supavisor db >/dev/null
    # The data folder belongs to the database container's user, so archive it
    # as root from the migrator image (always on this machine; no extra pull).
    tools
    docker run --rm --user 0 --entrypoint tar -v "$(pwd):/mushi" -w /mushi "$TOOLS_IMAGE" \
      czf "$out" volumes/db/data volumes/storage .env .supabase-version
    chmod 600 "$out" 2>/dev/null || true
    echo "Backup: $out ($(du -h "$out" | cut -f1)). It contains your secrets (.env): copy it off this machine and keep it private."
    ;;

  restore)
    file=${1:?usage: sh mushi.sh restore backups/mushi-YYYYMMDD-HHMMSS.tar.gz}
    [ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
    printf 'This replaces the current database and files with %s. Type "restore" to go on: ' "$file"
    read -r answer
    [ "$answer" = restore ] || { echo "Stopped."; exit 1; }
    tools
    docker compose down >/dev/null
    docker run --rm --user 0 --entrypoint sh -v "$(pwd):/mushi" -w /mushi "$TOOLS_IMAGE" -c \
      "rm -rf volumes/db/data volumes/storage && tar xzf '$file'"
    docker compose up -d --wait
    echo "Restored from $file."
    ;;

  update)
    version=${1:-latest}
    sh "$0" backup
    set_env MUSHI_VERSION "$version"
    docker compose pull --quiet
    docker compose up -d --wait
    echo "Updated to $version. Supabase's own services: see https://supabase.com/docs/guides/self-hosting/updating (sh update.sh)."
    ;;

  https)
    domain=${1:?usage: sh mushi.sh https mushi.example.com}
    url="https://$domain"
    set_env MUSHI_DOMAIN "$domain"
    set_env MUSHI_SITE_ADDRESS "$domain"
    set_env MUSHI_PUBLIC_URL "$url"
    set_env SITE_URL "$url"
    set_env SUPABASE_PUBLIC_URL "$url"
    set_env API_EXTERNAL_URL "$url/auth/v1"
    set_env ADDITIONAL_REDIRECT_URLS "$url/**"
    case "$(env_get COMPOSE_FILE)" in
      *docker-compose.https.yml*) ;;
      *) set_env COMPOSE_FILE "$(env_get COMPOSE_FILE):caddy/docker-compose.https.yml" ;;
    esac
    docker compose up -d --wait
    echo "Serving $url (Caddy is getting the certificate; DNS for $domain must point here)."
    ;;

  secrets)
    printf 'Public URL:        %s\n' "$(env_get MUSHI_PUBLIC_URL)"
    printf 'API (SDK/CLI/MCP): %s/functions/v1/api\n' "$(env_get MUSHI_PUBLIC_URL)"
    printf 'Public anon key:   %s\n' "$(env_get ANON_KEY)"
    printf 'Studio:            %s (ssh -L 8000:127.0.0.1:8000 this-server), user %s\n' "$(gw)" "$(env_get DASHBOARD_USERNAME)"
    printf 'Studio password:   %s\n' "$(env_get DASHBOARD_PASSWORD)"
    ;;

  *) sed -n '2,15p' "$0" ;;
esac
