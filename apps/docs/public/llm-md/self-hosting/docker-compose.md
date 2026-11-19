# Self-host in minutes (Docker Compose)

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/docker-compose

---
title: Self-host in minutes (Docker Compose)
description: Run the whole Mushi Mushi stack on your own server with one install command. Supabase's self-host kit plus Mushi's images, generated secrets, closed sign-up, HTTPS, backups and updates.
---

# Self-host in minutes

One command installs the whole stack on a Linux or macOS server with Docker:
Postgres, Auth, REST, Realtime, Storage and the edge runtime from
[Supabase's self-host kit](https://supabase.com/docs/guides/self-hosting/docker)
(pinned to `self-hosted/v0.8.4`), plus Mushi's three images:

| Image | What it does |
| --- | --- |
| `ghcr.io/kensaurus/mushi-functions` | Every Mushi edge function on Supabase's edge runtime |
| `ghcr.io/kensaurus/mushi-migrate` | Applies the migrations on each start, then exits |
| `ghcr.io/kensaurus/mushi-admin` | The console, and the API on the same origin |

Images are built for `linux/amd64` and `linux/arm64` and tagged `latest` and
`sha-`. No Supabase account is needed, and nothing phones home.

  **You need:** Docker with Compose 2.24.4 or newer, `git`, `openssl`, `curl`,
  and about 4 GB of RAM (Supabase's minimum). On Windows, run it inside WSL. An
  AI key is optional: without one, reports are taken and sorted by rules; the
  plain-English diagnosis needs Anthropic, OpenAI, OpenRouter or your own
  OpenAI-compatible server.

## Install

### Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/deploy/selfhost/install.sh -o install.sh
sh install.sh --email you@example.com
```

It creates `./mushi`, generates every secret (database password, JWT secret,
API keys, the internal caller secret, the Studio password), starts the stack,
applies the migrations and creates your admin account. It prints the password
once.

### Open the console

The console listens on `http://127.0.0.1:3000`, on this machine only. On a
remote server, use an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 your-server`) or
turn on HTTPS (next step).

### Add an AI key (optional)

Set one of these in `mushi/.env`, then run `sh mushi.sh up`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
```

## HTTPS on your own domain

Point the domain's DNS at the server, open ports 80 and 443, then:

```bash
cd mushi
sh mushi.sh https mushi.example.com
```

This adds a Caddy container that gets and renews the certificate, and moves
every URL setting (console, Auth redirects, email links, the CLI sign-in link,
MCP) to `https://mushi.example.com`. Behind your own proxy instead (Traefik,
nginx, Cloudflare Tunnel)? Proxy to `127.0.0.1:3000` and set `MUSHI_PUBLIC_URL`
and `SITE_URL` in `.env` to your URL. The console serves the API on the same
origin, so one route is enough.

## Your own model server (Ollama, vLLM, LM Studio)

Point the OpenAI-compatible client at your server and name the models it
serves:

```bash
OPENAI_API_KEY=local                      # any value; your server ignores it
OPENAI_BASE_URL=http://host.docker.internal:11434/v1
MUSHI_ALLOW_PRIVATE_LLM_BASE_URL=true
MUSHI_OPENAI_MODEL_MAP=gpt-6-luna=qwen3:8b,gpt-6.1-terra=qwen3:14b,gpt-6.1-sol=qwen3:32b
```

Then choose OpenAI as the organization's AI provider in the console. Only this
server-wide setting accepts a private `http://` address; base URLs that users
store with their own keys stay limited to https providers.

## Day to day

Run these from the install folder:

| Command | What it does |
| --- | --- |
| `sh mushi.sh status` | Each service's health, the migration result, API and console checks |
| `sh mushi.sh add-user EMAIL` | Creates a confirmed account. Sign-up is closed by default. |
| `sh mushi.sh backup` | Stops the database for about 10 seconds and archives it, file storage and `.env` into `backups/` |
| `sh mushi.sh restore FILE` | Puts a backup back (asks first) |
| `sh mushi.sh update [VERSION]` | Backs up, pulls `latest` or a pinned `sha-`, restarts. Migrations apply on start. |
| `sh mushi.sh secrets` | The URLs and keys the SDK, CLI and MCP need |
| `sh mushi.sh logs [service]` | Follows the logs |

A backup contains `.env`, which holds your secrets: keep it somewhere safe and
off the server. To update Supabase's own services, use the kit's `update.sh`
([guide](https://supabase.com/docs/guides/self-hosting/updating)).

## Point your app and tools at it

```bash
sh mushi.sh secrets    # public URL and anon key
npx mushi-mushi login --endpoint https://mushi.example.com/functions/v1/api
```

In the SDK, pass `apiEndpoint: 'https://mushi.example.com/functions/v1/api'`.
The MCP server reads `MUSHI_API_ENDPOINT`. The CLI needs https except on
`localhost`.

## Security defaults

- **Secrets:** every secret is generated at install; none is a default. `.env`
  is created with mode 600.
- **Ports:** the console binds to `127.0.0.1` (change `MUSHI_BIND`). Postgres,
  the pooler, the gateway and Studio are bound to loopback only.
- **Accounts:** sign-up is closed, so strangers cannot use your AI key. Add
  people with `sh mushi.sh add-user`. For password-reset and invite emails, set
  `SMTP_*` in `.env`.
- **Studio** (Supabase's dashboard) is reachable only through an SSH tunnel to
  `127.0.0.1:8000`, behind `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.
- **Containers:** the console runs as a non-root user on a read-only
  filesystem with `no-new-privileges`.
- **Internal calls:** the database's scheduled jobs call your own functions
  through the internal gateway with a generated secret, never the hosted
  service.

## What's running

```
mushi/
├── docker-compose.yml          Supabase's kit (self-hosted/v0.8.4), unchanged
├── docker-compose.mushi.yml    Mushi's layer (in COMPOSE_FILE)
├── caddy/                      optional HTTPS layer
├── mushi.sh                    the commands above
├── run.sh, update.sh, utils/   Supabase's own helpers
└── .env                        every setting and secret
```

| Service | Notes |
| --- | --- |
| `db` | Postgres 17 (`volumes/db/data`) |
| `auth`, `rest`, `realtime`, `storage`, `imgproxy`, `meta` | Supabase services |
| `api-gw` | Envoy gateway: `/rest/v1`, `/auth/v1`, `/functions/v1`, `/storage/v1`, `/realtime/v1` |
| `functions` | `mushi-functions`: every Mushi function, one worker each |
| `mushi-migrate` | Applies new migrations, sets this install's internal URL, exits |
| `mushi-admin` | Console on port 3000 plus the same-origin API proxy |
| `studio`, `supavisor` | Supabase dashboard and pooler, loopback only |

The kit names its containers `supabase-*`, so it cannot share a Docker host
with another copy of Supabase's kit.

## From source

Building the images yourself instead of pulling them:

```bash
git clone https://github.com/kensaurus/mushi-mushi.git && cd mushi-mushi
for img in migrate functions admin; do
  docker build -f deploy/selfhost/$img/Dockerfile -t ghcr.io/kensaurus/mushi-$img:local .
done
MUSHI_VERSION=local MUSHI_SKIP_PULL=1 sh deploy/selfhost/install.sh --email you@example.com
```

## Managed Supabase instead

Prefer a hosted Supabase project to running Postgres yourself? Skip Compose
and follow the [step-by-step guides](/self-hosting):
[Supabase setup](/self-hosting/supabase),
[Edge Functions deploy](/self-hosting/edge-functions) and
[Admin SPA deploy](/self-hosting/admin-spa).

  Same code, either way. Mushi Mushi Cloud runs this exact stack — there is no
  closed-source plus-tier. The hosted service adds only its own tuning data
  (prompts and scoring weights kept as configuration); the repo's default
  prompts give you every feature. See [Open source & licensing](/concepts/open-source).
