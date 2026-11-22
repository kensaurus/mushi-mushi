#!/bin/sh
# FILE: deploy/admin-runtime-config.sh
# PURPOSE: Runs from nginx's /docker-entrypoint.d before nginx starts. When
#          MUSHI_PUBLIC_URL and SUPABASE_ANON_KEY are set, writes
#          /runtime-config.js so one published image serves any domain
#          (deploy/selfhost). Unset (deploy/docker-compose.yml bakes VITE_* as
#          build args), the empty default from apps/admin/public stays.
set -eu
url=${MUSHI_PUBLIC_URL:-}
key=${SUPABASE_ANON_KEY:-}
if [ -z "$url" ] || [ -z "$key" ]; then
  exit 0
fi
url=${url%/}
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
cat > /usr/share/nginx/html/runtime-config.js <<JS
window.__MUSHI_RUNTIME_CONFIG__ = {
  "instanceType": "self-hosted",
  "supabaseUrl": "$(esc "$url")",
  "supabaseAnonKey": "$(esc "$key")",
  "apiUrl": "$(esc "$url")/functions/v1/api",
  "mcpHttpUrl": "$(esc "$url")/functions/v1/mcp"
};
JS
echo "mushi-admin: console configured for $url"
