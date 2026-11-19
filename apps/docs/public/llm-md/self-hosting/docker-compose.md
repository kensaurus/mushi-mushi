# Docker Compose

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/docker-compose

---
title: Docker Compose
description: Run the whole Mushi Mushi stack in Docker Compose with no Supabase account. Postgres, auth, storage, every edge function, the console and Caddy, on one machine.
---

# Docker Compose

**Use this when** you want everything on one machine, in containers, with no Supabase account. One Compose file runs Supabase's Postgres, Auth, PostgREST and Storage images, every edge function in one `supabase/edge-runtime` container, the console, and Caddy as the gateway. It was proved end to end on a clean machine on 2026-11-19: 578 migrations on an empty Postgres 17, sign-up, and the first-app bootstrap.

Already have a Supabase project? The [quickstart](/self-hosting) (`selfhost up`) is shorter.

You need Docker with Compose v2, git, and either bash + openssl or Node 22+. Run every command from the repo root.

### Generate the secrets

```bash
git clone https://github.com/kensaurus/mushi-mushi.git && cd mushi-mushi
npx mushi-mushi@latest selfhost secrets        # or: ./deploy/generate-secrets.sh
```

Both write `deploy/.env` (mode 600): a random Postgres password, JWT secret and internal caller secret, plus the anon and service_role keys signed with that JWT secret. Neither overwrites an existing file. For a public domain, pass it first: `--public-url https://mushi.example.com` (or `MUSHI_PUBLIC_URL=https://mushi.example.com ./deploy/generate-secrets.sh`).

Optional: add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to `deploy/.env`. Either one turns on the plain-English diagnosis and fix drafts.

You should see: `✓ Wrote …/deploy/.env (mode 600).`

### Start the stack

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

The first run builds the functions and console images and applies every migration, so it takes a few minutes. Compose refuses to start while a required secret is missing.

You should see: `docker compose -f deploy/docker-compose.yml ps` lists `migrate` as exited (0) and the other services as running.

### Sign up and sign the CLI in

Open `http://localhost` (or your domain) and create an account. The first account owns the instance. Sign-up is confirmed at once, because the stack has no SMTP.

```bash
npx mushi-mushi@latest config consoleUrl http://localhost
npx mushi-mushi@latest login --endpoint http://localhost/functions/v1/api
npx mushi-mushi@latest selfhost doctor
```

You should see: `OK` and `INFO` lines, exit code 0. Then create an app and press **Send test bug** under Settings → SDK & connection.

## What's running

```
deploy/docker-compose.yml
├── db              supabase/postgres 17 (+ deploy/db/roles.sql, jwt.sql on first boot)
├── auth            GoTrue
├── rest            PostgREST
├── storage         Storage API (file backend)
├── migrate         one-shot: applies the migrations, sets mushi_runtime_config, lifts plan limits
├── edge-functions  every function behind deploy/edge/main (Dockerfile.edge)
├── admin           console SPA on nginx :3000 (Dockerfile.admin, VITE_* as build args)
└── caddy           the only published port: console at /, gateway at /auth/v1, /rest/v1,
                    /storage/v1, /functions/v1; plus an internal gateway on :8000
```

- **Migrations** run in `migrate`, after Auth and Storage have created their schemas. Each file runs in one transaction. Applied files are recorded in `supabase_migrations.schema_migrations`, the ledger `supabase db push` uses, so running `up` again applies only new ones.
- **Cron jobs** call `http://caddy:8000`: `migrate` writes that URL and `MUSHI_INTERNAL_CALLER_SECRET` into `mushi_runtime_config`.
- **The functions** get `MUSHI_INSTANCE_MODE=self-hosted` and `ADMIN_BASE_URL` = `MUSHI_PUBLIC_URL`, so `/health` says self-hosted and report links open your console.
- **Console settings** are baked in at build time. After changing `MUSHI_PUBLIC_URL` or the anon key, rebuild it: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build admin`.

Every variable `deploy/.env` takes is on [Environment variables](/self-hosting/environment#docker-compose-deployenv). To pass another function secret (say `SENTRY_DSN_SERVER`), add it to the `edge-functions` service's `environment:` block.

## Upgrade

```bash
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

`migrate` applies only the new migrations; the images rebuild from your checkout.

## Not included

- **Realtime**: the console's live updates need a page reload.
- **Email**: no SMTP, so accounts are confirmed on sign-up.
- **Studio**: use `psql` in the `db` container: `docker compose -f deploy/docker-compose.yml exec db psql -U postgres`.
- **Signed file links**: the functions build signed Storage URLs from the internal gateway (`http://caddy:8000`), so screenshot links the API hands to the browser may not load yet.

## Production notes

- **TLS / domain**: set `MUSHI_PUBLIC_URL` and `MUSHI_SITE_ADDRESS` to `https://your-domain`, and Caddy provisions a certificate.
- **Internal functions** (`classify-report`, `fix-worker`, `judge-batch`, …) check `MUSHI_INTERNAL_CALLER_SECRET` or the service-role key (`requireServiceRoleAuth`) inside the handler.
- **Kubernetes**: the [Helm chart](https://github.com/kensaurus/mushi-mushi/tree/master/deploy/helm) runs the functions and console against an existing Supabase API. Unlike Compose, it has not been run end to end yet.

  It is the same code either way: Mushi Mushi Cloud runs this stack, and there is no closed-source plus-tier. The hosted service adds only its own tuning data (prompts and scoring weights kept as configuration). The repo's default prompts give you every feature. See [Open source & licensing](/concepts/open-source).
