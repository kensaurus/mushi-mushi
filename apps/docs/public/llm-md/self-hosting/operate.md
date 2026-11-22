# Operate and upgrade

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/operate

---
title: Operate and upgrade
description: Keep a self-hosted Mushi Mushi healthy. The doctor, upgrades, headless bootstrap, extra cron jobs, integrations, security notes and multi-region.
---

# Operate and upgrade

**Use this page** once your server runs ([quickstart](/self-hosting) or [Docker Compose](/self-hosting/docker-compose)).

## Check health

| Where | What it checks |
| --- | --- |
| `npx mushi-mushi selfhost doctor` | The server deploy, the console address, cron URL, screenshots bucket, AI key, background jobs, stuck reports. Exit 0 healthy (`INFO` = optional, not set up), 2 warnings, 1 failure. `--json` for scripts |
| Console → Settings → SDK & connection | The **Self-host setup** checklist: the same checks, each with its fix |
| `GET /functions/v1/api/health` | Process up, deployed commit, `mode` |
| `GET /functions/v1/api/health/ready` | Database reachable (503 when not) |
| `GET /functions/v1/healthz` | Uptime probe that skips the API router |

## Upgrade

Supabase project:

```bash
git pull
npx mushi-mushi@latest selfhost up --yes
```

It applies only the new migrations, re-applies the runtime config and plan limits, and redeploys every function stamped with the new commit. Export `MUSHI_INTERNAL_CALLER_SECRET` first to keep the current secret; otherwise it is rotated in both places at once. Then rebuild and redeploy the console ([Host the console](/self-hosting/admin-spa)).

Docker Compose: `git pull`, then `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`.

## Headless bootstrap (`MUSHI_INIT_*`)

For IaC, CI seeds and one-click deploys: create the first team, app and reporter key without clicking through the console. It mirrors [Langfuse's `LANGFUSE_INIT_*`](https://langfuse.com/docs/self-hosting).

The owner signs up in the console first: a team and an app each need a real owner account. Then set the function secrets (Compose: in `deploy/.env`):

```bash
npx supabase secrets set MUSHI_INIT_OWNER_EMAIL="you@example.com"     # required once you set a team or app
npx supabase secrets set MUSHI_INIT_ORG_NAME="My Team"                # optional: the owner's personal team otherwise
npx supabase secrets set MUSHI_INIT_PROJECT_NAME="Production"
npx supabase secrets set MUSHI_INIT_REPORTER_KEY="mushi_mystaticreporterkey123"   # stored hashed
```

`MUSHI_INIT_ORG_ID` and `MUSHI_INIT_PROJECT_ID` make it reuse an existing team or app. Then call the endpoint once, with the service-role key:

```bash
curl -X POST https://<your-ref>.supabase.co/functions/v1/api/v1/admin/bootstrap \
  -H "Authorization: Bearer <service-role key>" \
  -H "Content-Type: application/json" --data '{}'
```

It is idempotent: it skips what already exists and lists what it created and skipped. Never expose the service-role key.

## Who counts as the operator

The server-wide `GITHUB_TOKEN`, `SLACK_BOT_TOKEN` and `LANGFUSE_*` keys belong to the operator's own accounts, so they serve as an app's own GitHub, Slack or Langfuse connection only for apps owned by a user in `MUSHI_OPERATOR_USER_IDS` (comma-separated user ids). On a single-team self-host, put your own user id there, or the server-wide token serves no app. Every other app connects its own GitHub (the GitHub App, or a token on its Integrations page) and its own Slack. The pipeline's own Langfuse tracing uses the keys for every app.

## Extra cron jobs

The migrations schedule the core jobs. These are extra. Use the `mushi.edge_function_post` helper (it reads the runtime config `selfhost up` writes); never `current_setting('app.settings.…')`, which is NULL on hosted Supabase, so the job fails silently every tick.

```sql
SELECT cron.schedule('mushi-judge-batch', '0 3 * * *',
  $$ SELECT mushi.edge_function_post('judge-batch', '{}'::jsonb); $$);
SELECT cron.schedule('mushi-mistake-clusterer', '0 */6 * * *',
  $$ SELECT mushi.edge_function_post('mistake-clusterer', '{}'::jsonb); $$);
SELECT cron.schedule('mushi-drift-walker', '0 3 * * *',
  $$ SELECT mushi.edge_function_post('drift-walker', '{"project_id":"YOUR_PROJECT_ID"}'::jsonb); $$);
SELECT cron.schedule('mushi-anomaly-detector', '0 * * * *',
  $$ SELECT mushi.edge_function_post('anomaly-detector', '{"project_id":"YOUR_PROJECT_ID"}'::jsonb); $$);
```

## Integrations

- **Voice**: `POST /v1/intake/voice` takes a project key with the `voice:write` scope; turn on voice intake per app first. Transcription uses the app's OpenAI key. Audio is deleted after transcription unless a retention is set.
- **Telegram**: create a bot with @BotFather, paste its token in the app's Voice intake settings, call `POST /v1/admin/telegram/setup` (it registers the webhook), mint a bind code with `POST /v1/admin/telegram/bind-code`, then send `/start ` to the bot.
- **Slack**: install the app from `packages/plugin-slack-app/manifest.json` after deploying `api`; Slack verifies the Events URL on save. The OAuth secrets are on [Environment variables](/self-hosting/environment#slack-oauth-optional-operator-workspace).
- **Cursor Cloud**: `autofix_agent = 'cursor_cloud'` or `mushi fix --agent cursor_cloud`, with the app's Cursor key. `agent-status-poll` polls completion; `CURSOR_USE_V0_WEBHOOK=1` uses the v0 callback into `cursor-webhook` instead.
- **GitHub cloud agent**: `autofix_agent = 'github_cloud_agent'` needs a user-to-server token (a fine-grained PAT with Agent tasks, Contents and Pull requests, or a GitHub App user token) and a Copilot plan with the coding agent on. Installation tokens are rejected by GitHub.
- **Web Push**: set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:`); the installed console subscribes devices.

## Security notes

- **Only `api` should face the internet.** Internal functions (`fast-filter`, `classify-report`, `judge-batch`, …) accept only `MUSHI_INTERNAL_CALLER_SECRET` or the service-role key ([JWT verification](/self-hosting/edge-functions#jwt-verification)).
- **Screenshots** go to the private `screenshots` bucket (service role only). Never make it public; the doctor fails if it is.
- **Fix agent sandbox**: `packages/agents/src/sandbox.ts` describes container limits but does not enforce them. The fix agent runs with the host process's permissions; isolate it yourself (Docker, gVisor, Firecracker) before running it in production.
- **PII scrubbing** (`_shared/pii-scrubber.ts`) redacts emails, SSNs, phone and card numbers by pattern. It is not a full DLP tool.
- **Database linter warnings** you can leave: `vector` and `pg_net` live in `public` on managed Supabase (moving them would drop every embedding column). Turn on leaked-password protection (Authentication → Sign In / Providers → Password security) and a second factor such as TOTP (Authentication → Providers) to clear the two auth warnings.
- **Screenshot capture** uses canvas/SVG serialization: cross-origin iframes, tainted canvases and strict CSPs are not captured.

## Multi-region (Helm, not yet proven end to end)

Deploy one [Helm chart](https://github.com/kensaurus/mushi-mushi/tree/master/deploy/helm) per region with `global.region` and `global.peerRegions`; the chart sets `MUSHI_CLUSTER_REGION` and `MUSHI_PEER_REGIONS` so reports carry the right data-residency region. Escape the comma for `--set-string` and single-quote the argument:

```bash
helm install mushi-us ./deploy/helm --namespace mushi --create-namespace \
  --set global.database.host=postgres-us.internal \
  --set global.region=us --set-string 'global.peerRegions=eu\,jp'
```

Route traffic with GeoDNS. Replication: [`docs/runbooks/region-routing-replication.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/runbooks/region-routing-replication.md).

  Active/active write replication is not automated: `region_routing` replicates read-only, and write routing relies on GeoDNS stickiness. Cross-region write conflicts are yours to handle.
