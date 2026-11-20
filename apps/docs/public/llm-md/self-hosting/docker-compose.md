# Docker (one-command install)

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/docker-compose

---
title: Docker (one-command install)
description: Run all of Mushi Mushi on your own server with one command, no Supabase account. Closed sign-up, HTTPS, backups and updates included.
---

# Docker

Two ways to run every service in containers, with no Supabase account:

| | One-command install | Build from source |
| --- | --- | --- |
| Command | `sh install.sh --email you@…` | `docker compose -f deploy/docker-compose.yml up --build` |
| Supabase services | [Supabase's self-host kit](https://supabase.com/docs/guides/self-hosting/docker) (pinned `self-hosted/v0.8.4`): Postgres 17, Auth, REST, **Realtime**, Storage, Studio, pooler, gateway | Postgres, Auth, REST, Storage (no Realtime, no Studio) |
| Mushi images | Pulled from GHCR (amd64, arm64) | Built on your machine |
| Console | Configured at start, any domain | URL baked in at build |
| Secrets and first account | Generated; sign-up closed, admin created | Generated; first sign-up owns the instance |
| Backups, updates, HTTPS | `sh mushi.sh backup`, `update`, `https ` | By hand |
| Checked | From an empty server in CI before every image release | By hand on a clean machine (2026-11-19) |

Already have a Supabase project? The [quickstart](/self-hosting) (`selfhost up`) uses it instead of Docker.

## One-command install

  **You need:** a Linux or macOS server with Docker (Compose 2.24.4 or newer),
  `git`, `openssl` and `curl`, and about 4 GB of RAM (Supabase's minimum). On
  Windows, run it inside WSL. An AI key is optional: without one, reports are
  taken and sorted by rules; the plain-English diagnosis needs Anthropic,
  OpenAI, OpenRouter or your own OpenAI-compatible server.

### Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/deploy/selfhost/install.sh -o install.sh
sh install.sh --email you@example.com
```

It creates `./mushi` with Supabase's kit and Mushi's layer, generates every
secret (database password, JWT secret, API keys, the internal caller secret,
the Studio password), pulls `ghcr.io/kensaurus/mushi-mushi-{edge,admin,migrate}`,
starts the stack, applies the migrations and creates your admin account. It
prints the password once.

### Open the console

`http://127.0.0.1:3000`, on that machine only. On a remote server use an SSH
tunnel (`ssh -L 3000:127.0.0.1:3000 your-server`) or turn on HTTPS below.

### Add an AI key (optional)

Set one in `mushi/.env`, then run `sh mushi.sh up`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
```

### HTTPS on your own domain

Point the domain's DNS at the server, open ports 80 and 443, then:

```bash
cd mushi && sh mushi.sh https mushi.example.com
```

Caddy gets and renews the certificate, and every URL setting (console, Auth
redirects, email links, the CLI sign-in link, MCP) moves to
`https://mushi.example.com`. Behind your own proxy instead (Traefik, nginx,
Cloudflare Tunnel)? Proxy to `127.0.0.1:3000` and set `MUSHI_PUBLIC_URL` and
`SITE_URL` in `.env` to your URL: the console and the API share one origin,
so one route is enough.

### Your own model server (Ollama, vLLM, LM Studio)

```bash
OPENAI_API_KEY=local                      # any value; your server ignores it
OPENAI_BASE_URL=http://host.docker.internal:11434/v1
MUSHI_ALLOW_PRIVATE_LLM_BASE_URL=true
MUSHI_OPENAI_MODEL_MAP=gpt-6-luna=qwen3:8b,gpt-6.1-terra=qwen3:14b,gpt-6.1-sol=qwen3:32b
```

Then choose OpenAI as the organization's AI provider in the console. Only this
server-wide setting accepts a private `http://` address; base URLs stored with
a user's own key stay limited to https providers.

### Day to day

| Command | What it does |
| --- | --- |
| `sh mushi.sh status` | Each service's health, the migration result, API and console checks |
| `sh mushi.sh add-user EMAIL` | A confirmed account; sign-up is closed by default |
| `sh mushi.sh backup` | Stops the database about 10 s and archives it, file storage and `.env` into `backups/` |
| `sh mushi.sh restore FILE` | Puts a backup back (asks first) |
| `sh mushi.sh update [VERSION]` | Backs up, pulls `latest` or a pinned version, restarts; migrations apply on start |
| `sh mushi.sh https DOMAIN` | HTTPS with Caddy, as above |
| `sh mushi.sh secrets` | The URLs and keys the SDK, CLI and MCP need |

A backup contains `.env`, which holds your secrets: keep it off the server and
private. To update Supabase's own services, use the kit's `update.sh`
([guide](https://supabase.com/docs/guides/self-hosting/updating)).

### Point your app and tools at it

```bash
mushi config consoleUrl https://mushi.example.com
mushi login --endpoint https://mushi.example.com/functions/v1/api
```

In the SDK, pass `apiEndpoint: 'https://mushi.example.com/functions/v1/api'`;
the MCP server reads `MUSHI_API_ENDPOINT`. The CLI needs https except on
`localhost`.

### Security defaults

- Every secret is generated at install; none is a default. `.env` is mode 600.
- The console binds to `127.0.0.1` (`MUSHI_BIND` changes it). Postgres, the
  pooler, the gateway and Studio bind to loopback only.
- Sign-up is closed, so strangers cannot spend your AI key. For password-reset
  and invite emails, set `SMTP_*` in `.env`.
- Studio (Supabase's dashboard) is reached through an SSH tunnel to
  `127.0.0.1:8000`, behind `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.
- The database's scheduled jobs call your own functions through the internal
  gateway with a generated secret, never Mushi Mushi Cloud.

### What's running

```
mushi/
├── docker-compose.yml          Supabase's kit (self-hosted/v0.8.4), unchanged
├── docker-compose.mushi.yml    Mushi's layer (in COMPOSE_FILE)
├── caddy/                      the one origin, and the HTTPS layer
├── mushi.sh                    the commands above
├── run.sh, update.sh, utils/   Supabase's own helpers
└── .env                        every setting and secret
```

| Service | Notes |
| --- | --- |
| `db`, `auth`, `rest`, `realtime`, `storage`, `imgproxy`, `meta`, `supavisor`, `studio` | Supabase's kit |
| `api-gw` | The kit's gateway (`/rest/v1`, `/auth/v1`, `/functions/v1`, `/storage/v1`, `/realtime/v1`) |
| `functions` | `mushi-mushi-edge`: every Mushi function, one worker each |
| `mushi-migrate` | `deploy/db/migrate.sh`: new migrations, this install's internal URL, no plan limits; exits |
| `mushi-admin` | `mushi-mushi-admin`: the console, configured at start |
| `mushi-caddy` | The one origin on port 3000 (or 80/443 with `https`) |

The kit names its containers `supabase-*`, so it cannot share a Docker host
with another copy of the kit.

## Build from source

**Use this when** you want to build the Mushi images from your own checkout. One
Compose file in the repo runs Supabase's Postgres, Auth, PostgREST and Storage
images, every edge function in one `supabase/edge-runtime` container, the
console and Caddy. It was proved end to end on a clean machine on 2026-11-19:
578 migrations on an empty Postgres 17, sign-up, and the first-app bootstrap.

You need Docker with Compose v2, git, and either bash + openssl or Node 22+. Run
every command from the repo root.

### Generate the secrets

```bash
git clone https://github.com/kensaurus/mushi-mushi.git && cd mushi-mushi
npx mushi-mushi@latest selfhost secrets        # or: ./deploy/generate-secrets.sh
```

Both write `deploy/.env` (mode 600): a random Postgres password, JWT secret and
internal caller secret, plus the anon and service_role keys signed with that JWT
secret. Neither overwrites an existing file. For a public domain, pass it first:
`--public-url https://mushi.example.com` (or
`MUSHI_PUBLIC_URL=https://mushi.example.com ./deploy/generate-secrets.sh`).

Optional: add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to `deploy/.env`. Either
one turns on the plain-English diagnosis and fix drafts.

You should see: `✓ Wrote …/deploy/.env (mode 600).`

### Start the stack

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

The first run builds the functions and console images and applies every
migration, so it takes a few minutes. Compose refuses to start while a required
secret is missing.

You should see: `docker compose -f deploy/docker-compose.yml ps` lists `migrate`
as exited (0) and the other services as running.

### Sign up and sign the CLI in

Open `http://localhost` (or your domain) and create an account. The first
account owns the instance. Sign-up is confirmed at once, because the stack has
no SMTP.

```bash
npx mushi-mushi@latest config consoleUrl http://localhost
npx mushi-mushi@latest login --endpoint http://localhost/functions/v1/api
npx mushi-mushi@latest selfhost doctor
```

You should see: `OK` and `INFO` lines, exit code 0. Then create an app and press
**Send test bug** under Settings → SDK & connection.

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

- **Migrations** run in `migrate`, after Auth and Storage have created their
  schemas. Each file runs in one transaction. Applied files are recorded in
  `supabase_migrations.schema_migrations`, the ledger `supabase db push` uses,
  so running `up` again applies only new ones.
- **Cron jobs** call `http://caddy:8000`: `migrate` writes that URL and
  `MUSHI_INTERNAL_CALLER_SECRET` into `mushi_runtime_config`.
- **The functions** get `MUSHI_INSTANCE_MODE=self-hosted`, `ADMIN_BASE_URL` and
  `SUPABASE_PUBLIC_URL` = `MUSHI_PUBLIC_URL`, so `/health` says self-hosted,
  report links open your console and signed screenshot links use your public
  address.
- **Console settings** are baked in at build time. After changing
  `MUSHI_PUBLIC_URL` or the anon key, rebuild it:
  `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build admin`.

Every variable `deploy/.env` takes is on
[Environment variables](/self-hosting/environment#docker-compose-deployenv). To
pass another function secret (say `SENTRY_DSN_SERVER`), add it to the
`edge-functions` service's `environment:` block.

**Upgrade:** `git pull`, then the same `up -d --build`. `migrate` applies only
the new migrations; the images rebuild from your checkout.

**Not included:** **Realtime** (the console's live updates need a page reload),
**email** (accounts are confirmed on sign-up) and **Studio** (use
`docker compose -f deploy/docker-compose.yml exec db psql -U postgres`). The
one-command install above has all three.

## Notes for both

- **TLS / domain**: the one-command install has `sh mushi.sh https `.
  From source, set `MUSHI_PUBLIC_URL` and `MUSHI_SITE_ADDRESS` to
  `https://your-domain`, and Caddy provisions a certificate.
- **Internal functions** (`classify-report`, `fix-worker`, `judge-batch`, …)
  check `MUSHI_INTERNAL_CALLER_SECRET` or the service-role key
  (`requireServiceRoleAuth`) inside the handler.
- **Kubernetes**: the [Helm chart](https://github.com/kensaurus/mushi-mushi/tree/master/deploy/helm)
  runs the functions and console against an existing Supabase API. Unlike the
  two Docker paths, it has not been run end to end yet.

  It is the same code either way: Mushi Mushi Cloud runs this stack, and there
  is no closed-source plus-tier. The hosted service adds only its own tuning
  data (prompts and scoring weights kept as configuration). The repo's default
  prompts give you every feature. See [Open source & licensing](/concepts/open-source).
