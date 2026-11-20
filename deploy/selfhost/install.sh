#!/bin/sh
# Install Mushi Mushi on your own server with Docker.
#
#   curl -fsSL https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/deploy/selfhost/install.sh | sh
#   sh install.sh --url https://mushi.example.com --email you@example.com
#
# What it does, in a new folder (./mushi unless --dir):
#   1. fetches Supabase's self-host kit at a pinned tag (Postgres, Auth, REST,
#      Realtime, Storage, the edge runtime and its gateway)
#   2. adds Mushi's compose layer and mushi.sh
#   3. generates every secret (no defaults are ever used)
#   4. pulls the images, starts the stack, applies the migrations
#   5. creates your admin account and prints how to sign in
# Sign-up stays closed; add people with `sh mushi.sh add-user <email>`.
# Needs Docker with Compose 2.24.4+, git, openssl and curl. Linux or macOS
# (on Windows, run it inside WSL).
set -eu

SUPABASE_KIT_REF=${SUPABASE_KIT_REF:-self-hosted/v0.8.4}
MUSHI_REPO=${MUSHI_REPO:-https://github.com/kensaurus/mushi-mushi}
MUSHI_REF=${MUSHI_REF:-master}
MUSHI_VERSION=${MUSHI_VERSION:-latest}
DIR=mushi
PUBLIC_URL=http://localhost:3000
EMAIL=
YES=0

say() { printf '%s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR=$2; shift 2 ;;
    --url) PUBLIC_URL=$2; shift 2 ;;
    --email) EMAIL=$2; shift 2 ;;
    --version) MUSHI_VERSION=$2; shift 2 ;;
    -y|--yes) YES=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" 2>/dev/null || true; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done
PUBLIC_URL=${PUBLIC_URL%/}

# --- prerequisites ----------------------------------------------------------
for c in docker git openssl curl; do
  command -v "$c" >/dev/null 2>&1 || die "$c is required"
done
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose ...)"
compose_v=$(docker compose version --short 2>/dev/null | sed 's/^v//')
need=2.24.4
if [ "$(printf '%s\n%s\n' "$need" "$compose_v" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" != "$need" ]; then
  die "Docker Compose $need or newer is required (found $compose_v)"
fi
case "$PUBLIC_URL" in http://*|https://*) ;; *) die "--url must start with http:// or https://" ;; esac
[ -e "$DIR/.env" ] && die "$DIR already has an install. To upgrade: cd $DIR && sh mushi.sh update"

if [ -z "$EMAIL" ] && [ "$YES" = 0 ] && [ -r /dev/tty ]; then
  printf 'Email for your admin account: ' >/dev/tty
  read -r EMAIL </dev/tty || true
fi
[ -n "$EMAIL" ] || die "an admin email is needed: --email you@example.com"

# --- 1. Supabase's kit at a pinned tag --------------------------------------
say "Fetching Supabase's self-host kit ($SUPABASE_KIT_REF)..."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone --quiet --filter=blob:none --no-checkout --depth=1 --branch "$SUPABASE_KIT_REF" \
  https://github.com/supabase/supabase "$tmp/supabase" 2>/dev/null
git -C "$tmp/supabase" sparse-checkout set docker >/dev/null
git -C "$tmp/supabase" checkout --quiet
mkdir -p "$DIR"
cp -R "$tmp/supabase/docker/." "$DIR/"
printf 'ref=%s\n' "$SUPABASE_KIT_REF" > "$DIR/.supabase-version"

# --- 2. Mushi's layer -------------------------------------------------------
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)
if [ -n "$here" ] && [ -f "$here/docker-compose.mushi.yml" ]; then
  cp "$here/docker-compose.mushi.yml" "$here/mushi.sh" "$here/mushi.env.example" "$DIR/"
  cp -R "$here/caddy" "$DIR/" 2>/dev/null || true
else
  raw=$(printf '%s' "$MUSHI_REPO" | sed 's#https://github.com/#https://raw.githubusercontent.com/#')/$MUSHI_REF/deploy/selfhost
  for f in docker-compose.mushi.yml mushi.sh mushi.env.example caddy/Caddyfile caddy/docker-compose.https.yml; do
    mkdir -p "$DIR/$(dirname "$f")"
    curl -fsSL "$raw/$f" -o "$DIR/$f" || die "could not download $f"
  done
fi
cd "$DIR"

# --- 3. secrets and settings ------------------------------------------------
cp .env.example .env
sh utils/generate-keys.sh --update-env >/dev/null
grep -q 'your-super-secret' .env && die "secret generation failed; .env still has placeholders"

set_env() {
  # set_env KEY VALUE: replace the line or append it (values never contain |).
  if grep -q "^$1=" .env; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}
# Compose splits COMPOSE_FILE on ';' on Windows hosts unless told otherwise.
set_env COMPOSE_PATH_SEPARATOR :
set_env COMPOSE_FILE docker-compose.yml:docker-compose.mushi.yml
set_env SITE_URL "$PUBLIC_URL"
set_env SUPABASE_PUBLIC_URL "$PUBLIC_URL"
set_env API_EXTERNAL_URL "$PUBLIC_URL/auth/v1"
set_env ADDITIONAL_REDIRECT_URLS "$PUBLIC_URL/**"
# Closed sign-up: accounts are created by the operator (mushi.sh add-user).
set_env DISABLE_SIGNUP true
# No mail server yet, so accounts the operator creates are confirmed directly.
# Set SMTP_* in .env for password-reset and invite emails.
set_env ENABLE_EMAIL_AUTOCONFIRM true
set_env FUNCTIONS_VERIFY_JWT false
sed -e "s|@MUSHI_VERSION@|$MUSHI_VERSION|"     -e "s|@MUSHI_PUBLIC_URL@|$PUBLIC_URL|"     -e "s|@MUSHI_INTERNAL_CALLER_SECRET@|$(openssl rand -hex 32)|"     mushi.env.example >> .env
chmod 600 .env

# --- 4. start ---------------------------------------------------------------
if [ "${MUSHI_SKIP_PULL:-0}" = 1 ]; then
  say "Using images already on this machine (MUSHI_SKIP_PULL=1)."
else
  say "Pulling images (first time: a few minutes)..."
  docker compose pull --quiet
fi
say "Starting Mushi Mushi and applying migrations..."
# On a first boot several services migrate the same new database at once, and
# one can crash and restart (restart: unless-stopped). Look again before
# giving up: `up --wait` is safe to repeat.
tries=0
until docker compose up -d --wait; do
  tries=$((tries + 1))
  if [ $tries -ge 3 ]; then
    for s in $(docker compose ps -a --format '{{.Service}} {{.Status}}' | awk '/unhealthy|Restarting|Exited \([1-9]/ {print $1}'); do
      docker compose logs --tail 40 "$s" >&2 || true
    done
    die "the stack did not become healthy; see the logs above, then: sh mushi.sh status"
  fi
  say "Not healthy yet ($(docker compose ps -a --format '{{.Service}} {{.Status}}' | awk '/unhealthy|Restarting|Exited \([1-9]/ {print $1}' | tr '\n' ' ')); checking again..."
  sleep 10
done
# The first request to each function downloads its dependencies; wait for the API.
say "Waiting for the API (first start downloads function dependencies)..."
gw_port=$(sed -n 's/^API_GW_HTTP_PORT=//p' .env | tail -1)
i=0
until curl -fsS --max-time 60 "http://127.0.0.1:${gw_port:-8000}/functions/v1/api/health/ready" >/dev/null 2>&1; do
  i=$((i + 1))
  [ $i -ge 10 ] && die "the API did not answer; see: sh mushi.sh logs functions"
  sleep 5
done

# --- 5. admin account -------------------------------------------------------
password=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
sh mushi.sh add-user "$EMAIL" "$password" >/dev/null || die "could not create the admin account"

say ""
say "Mushi Mushi is running."
say "  Console:  $PUBLIC_URL"
say "  Sign in:  $EMAIL"
say "  Password: $password   (shown once; change it in the console)"
say ""
say "Next:"
say "  - Add an AI key in $(pwd)/.env (ANTHROPIC_API_KEY or OPENAI_API_KEY), then: sh mushi.sh up"
say "  - Point the SDK and CLI at $PUBLIC_URL (npx mushi-mushi login --endpoint $PUBLIC_URL/functions/v1/api)"
say "  - Public domain with HTTPS: sh mushi.sh https mushi.example.com (or put your own proxy in front of 127.0.0.1:3000)"
say "  - Backups: sh mushi.sh backup    Updates: sh mushi.sh update    Health: sh mushi.sh status"
