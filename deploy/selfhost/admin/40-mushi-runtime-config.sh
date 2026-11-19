#!/bin/sh
# Writes /runtime-config.js for the console from this container's environment,
# so one published image serves any domain (VITE_* values are fixed at build).
# Runs from nginx's /docker-entrypoint.d before nginx starts.
set -eu

url=${MUSHI_PUBLIC_URL:-}
key=${SUPABASE_ANON_KEY:-}
if [ -z "$url" ] || [ -z "$key" ]; then
  echo "mushi-admin: MUSHI_PUBLIC_URL and SUPABASE_ANON_KEY must be set" >&2
  exit 1
fi
url=${url%/}

# JSON string escaping for the two characters that matter here.
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

mkdir -p /tmp/mushi
cat > /tmp/mushi/runtime-config.js <<EOF
window.__MUSHI_RUNTIME_CONFIG__ = {
  "instanceType": "self-hosted",
  "supabaseUrl": "$(esc "$url")",
  "supabaseAnonKey": "$(esc "$key")",
  "apiUrl": "$(esc "$url")/functions/v1/api",
  "mcpHttpUrl": "$(esc "$url")/functions/v1/mcp"
};
EOF
echo "mushi-admin: console configured for $url"
