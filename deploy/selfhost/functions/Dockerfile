# Mushi Mushi self-host: every edge function behind Supabase's edge runtime
# (ghcr.io/kensaurus/mushi-functions). Replaces the `functions` service of the
# Supabase self-host kit. Build from the repo root:
#   docker build -f deploy/selfhost/functions/Dockerfile .
#
# main/ and deno.jsonc are Supabase's router from docker/volumes/functions at
# tag self-hosted/v0.8.4 (Apache-2.0), unchanged: it starts one worker per
# function, /functions/v1/<name> -> /home/deno/functions/<name>/index.ts.
# Keep the base image tag equal to that kit's `functions` image.
FROM supabase/edge-runtime:v1.77.9

COPY deploy/selfhost/functions/main/ /home/deno/functions/main/
COPY deploy/selfhost/functions/deno.jsonc /home/deno/functions/deno.jsonc
COPY packages/server/supabase/functions/ /home/deno/functions/

CMD ["start", "--user-worker-request-idle-timeout", "150000", "--main-service", "/home/deno/functions/main"]

LABEL org.opencontainers.image.title="mushi-functions" \
      org.opencontainers.image.description="Mushi Mushi's edge functions on Supabase's edge runtime" \
      org.opencontainers.image.source="https://github.com/kensaurus/mushi-mushi" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
