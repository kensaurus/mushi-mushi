# Mushi Mushi self-host: the console, plus a same-origin proxy to the API
# (ghcr.io/kensaurus/mushi-admin). Build from the repo root:
#   docker build -f deploy/selfhost/admin/Dockerfile .
# The backend URL and public key are read at container start (runtime-config.js),
# so this image is not tied to a domain.
# Static output, so build on the runner's own platform even for arm64 images.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.33.0
COPY . .
ENV CI=true \
    VITE_BASE_PATH=/ \
    VITE_INSTANCE_TYPE=self-hosted
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mushi-mushi/admin... --filter '!@mushi-mushi/admin' build \
 && pnpm --filter @mushi-mushi/admin build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY deploy/selfhost/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0755 deploy/selfhost/admin/40-mushi-runtime-config.sh /docker-entrypoint.d/40-mushi-runtime-config.sh
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

LABEL org.opencontainers.image.title="mushi-admin" \
      org.opencontainers.image.description="Mushi Mushi console, with a same-origin proxy to the self-hosted API" \
      org.opencontainers.image.source="https://github.com/kensaurus/mushi-mushi" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
