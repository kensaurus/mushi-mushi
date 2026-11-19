# Mushi Mushi self-host: one-shot database migrator (ghcr.io/kensaurus/mushi-migrate).
# Build from the repo root: docker build -f deploy/selfhost/migrate/Dockerfile .
FROM postgres:17-alpine

COPY packages/server/supabase/migrations/ /mushi/migrations/
COPY deploy/selfhost/sql/ /mushi/sql/
COPY deploy/selfhost/migrate/migrate.sh /mushi/migrate.sh

USER postgres
ENTRYPOINT ["sh", "/mushi/migrate.sh"]

LABEL org.opencontainers.image.title="mushi-migrate" \
      org.opencontainers.image.description="Applies Mushi Mushi's database migrations to a self-hosted Supabase database" \
      org.opencontainers.image.source="https://github.com/kensaurus/mushi-mushi" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
