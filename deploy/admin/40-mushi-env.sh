#!/bin/sh
# FILE: deploy/admin/40-mushi-env.sh
# PURPOSE: Write the admin console's runtime backend settings before nginx
#          starts. The nginx image runs every executable script in
#          /docker-entrypoint.d/ first. The SPA loads env.js before its bundle
#          and apps/admin/src/lib/env.ts reads window.__MUSHI_ENV__ before the
#          values baked in at build time, so one image serves any backend.
#
# Env read: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL,
#           MUSHI_LOCAL_ONLY. Unset values are left out of env.js.
# Under MUSHI_LOCAL_ONLY=1 the console never falls back to Mushi Cloud, and
# this script refuses a *.supabase.co URL rather than start pointed at one.

set -eu

target="${MUSHI_ENV_JS_PATH:-/usr/share/nginx/html/env.js}"

# One line, JSON-string safe, and unable to close the <script> it runs in.
json_string() {
  printf '%s' "$1" | tr -d '\r\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/</\\u003c/g' -e 's/>/\\u003e/g'
}

case "$(printf '%s' "${MUSHI_LOCAL_ONLY:-}" | tr '[:upper:]' '[:lower:]')" in
  1 | true | yes | on) local_only=1 ;;
  *) local_only=0 ;;
esac

if [ "$local_only" = 1 ]; then
  case "${VITE_SUPABASE_URL:-}${VITE_API_URL:-}" in
    *.supabase.co*)
      echo "40-mushi-env: MUSHI_LOCAL_ONLY=1 but VITE_SUPABASE_URL or VITE_API_URL points at supabase.co; refusing to start" >&2
      exit 1
      ;;
  esac
  [ -n "${VITE_SUPABASE_URL:-}" ] ||
    echo "40-mushi-env: VITE_SUPABASE_URL is empty; the console will use the address it is opened on" >&2
  [ -n "${VITE_SUPABASE_ANON_KEY:-}" ] ||
    echo "40-mushi-env: VITE_SUPABASE_ANON_KEY is empty; the console will ask for it" >&2
fi

body=""
add() {
  [ -n "$2" ] || return 0
  [ -z "$body" ] || body="$body,"
  body="$body\"$1\":\"$(json_string "$2")\""
}
add VITE_SUPABASE_URL "${VITE_SUPABASE_URL:-}"
add VITE_SUPABASE_ANON_KEY "${VITE_SUPABASE_ANON_KEY:-}"
add VITE_API_URL "${VITE_API_URL:-}"
[ "$local_only" = 1 ] && add MUSHI_LOCAL_ONLY 1

printf '// Written by 40-mushi-env.sh at container start. Do not edit.\nwindow.__MUSHI_ENV__ = {%s};\n' "$body" > "$target"
echo "40-mushi-env: wrote $target (local-only: $local_only)"
