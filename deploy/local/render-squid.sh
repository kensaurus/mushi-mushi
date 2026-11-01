#!/bin/sh
# FILE: deploy/local/render-squid.sh
# PURPOSE: Squid container entrypoint for the local-only stack. Writes the
#          allowlist from egress-allow.txt and MUSHI_EGRESS_ALLOW, prints it,
#          then runs Squid in the foreground with deploy/local/squid.conf.
#
# A host must look like a DNS name (letters, digits, dots, hyphens, an
# optional leading dot). Anything else stops the container rather than being
# passed to Squid. Internal service names (caddy, ollama, …) never belong
# here: they are on the internal network and never go through the proxy.

set -eu

src_file="${MUSHI_EGRESS_ALLOW_FILE:-/etc/mushi/egress-allow.txt}"
out="${MUSHI_SQUID_ALLOWLIST:-/etc/squid/mushi-allow.txt}"
tmp="$out.tmp"

{
  if [ -f "$src_file" ]; then
    sed -e 's/#.*$//' "$src_file"
  fi
  printf '%s\n' "${MUSHI_EGRESS_ALLOW:-}" | tr ',' '\n'
} | tr -d ' \t\r' | tr '[:upper:]' '[:lower:]' | grep -v '^$' | sort -u > "$tmp" || true

if grep -qvE '^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' "$tmp"; then
  echo "render-squid: not a host name, refusing to start:" >&2
  grep -vE '^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' "$tmp" >&2
  exit 1
fi

if [ -s "$tmp" ]; then
  echo "render-squid: allowlist: $(tr '\n' ' ' < "$tmp")"
else
  echo "render-squid: allowlist is empty; every request out is refused"
fi

# Squid needs at least one entry in a dstdomain file. `.invalid` is reserved
# (RFC 2606) and never resolves, so this entry allows nothing.
echo "mushi-egress-placeholder.invalid" >> "$tmp"
mv "$tmp" "$out"

exec squid -f "${MUSHI_SQUID_CONF:-/etc/squid/squid.conf}" -NYC
