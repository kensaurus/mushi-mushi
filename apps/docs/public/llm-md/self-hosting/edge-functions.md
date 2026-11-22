# Edge functions

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/edge-functions

---
title: Edge functions
description: What the Mushi Mushi Supabase Edge Functions do, how they authenticate, and how to redeploy one. selfhost up deploys all of them.
---

# Edge functions

**Use this page when** you need to know what a function does, redeploy one, or check what is running. Install them with the [quickstart](/self-hosting): `selfhost up` deploys **every** function under `packages/server/supabase/functions/` in one `supabase functions deploy`, with each function's `verify_jwt` taken from `config.toml`, the same as the production deploy. Deploy all of them: the cron jobs the migrations schedule call many of these (run `pnpm docs-stats` for the live count). The secrets they read are on [Environment variables](/self-hosting/environment#function-secrets).

## Redeploy one function

```bash
cd packages/server
npx supabase functions deploy api
```

  Run deploy commands from `packages/server/`: the Supabase CLI looks for `supabase/functions/` under the current directory. From the repo root it fails with "entrypoint path does not exist".

A plain `supabase functions deploy` leaves the deploy unstamped, so `/health` reports `"version": "dev"`. To stamp the commit, re-run `selfhost up`, or deploy with `SUPABASE_PROJECT_REF=<your-ref> node scripts/deploy-edge-function.mjs `. Supabase keeps the uploaded bundle as the source of truth, so a deploy from a stale checkout silently drops newer routes.

## Check what is deployed

`api` answers `GET /health` and `GET /v1/health` without a key:

```bash
curl -s "https://<your-ref>.supabase.co/functions/v1/api/v1/health"
# {"status":"ok","version":"<commit sha>","deployed_at":"…","mode":"self-hosted","region":"us","hosting_region":"ap-northeast-1"}
```

`version` is the commit stamped at deploy time: compare it with `git rev-parse HEAD`. `mode` is `self-hosted` unless the server runs on Mushi Mushi Cloud's project (`MUSHI_INSTANCE_MODE` overrides it). `hosting_region` is where the function runs, which matters when the database lives elsewhere. `GET /health/ready` adds a database round trip, and the standalone `healthz` function reports the same sha for uptime monitors that should not depend on the API router.

## Function inventory (core pipeline)

| Function | Trigger | What it does |
| --- | --- | --- |
| `api` | HTTP (Hono gateway) | All admin console + SDK API calls — routes under `/v1/` |
| `fast-filter` | Invoked by `api` | Stage-1 cheap triage before full classification |
| `classify-report` | `reports` INSERT | LLM triage: severity, category, blast-radius |
| `mcp` | HTTP | Hosted MCP transport for Cursor / Claude |
| `fix-worker` | Fix dispatch (`POST /v1/admin/fixes/dispatch`, autofix) | Drafts a fix and opens a draft PR, or dispatches a Cursor / GitHub cloud agent |
| `judge-batch` | cron (nightly) | Grades recent classifications; writes `classification_evaluations` and `reports.judge_score` |
| `intelligence-report` | cron / manual | Weekly LLM narrative from KPI trends |
| `drift-walker` | HTTP | Rebuilds the contract snapshot and compares it with the stored `contract_snapshots` baseline |
| `contract-graph-builder` | HTTP | Builds a contract snapshot from the OpenAPI spec, inventory API dependencies and the latest Supabase schema snapshot |
| `pdca-runner` | `pdca_runs` INSERT | Runs one PDCA iteration: fix → judge → promote cycle |
| `qa-story-runner` | cron (every minute) | Runs QA Coverage stories on schedule via Firecrawl / Browserbase |
| `generate-synthetic` | cron | Playwright-based synthetic smoke tests |
| `inventory-crawler` | cron / manual | Crawls app routes to populate `inventory_nodes` |
| `inventory-propose` | manual | Proposes user-story inventory from crawl data |
| `inventory-gates` | manual | Runs gate checks (dead handlers, mock leaks) |
| `a2a-push-notify` | manual / agents | Sends A2A protocol notifications to connected agents |
| `test-gen-from-report` | manual | Generates a Playwright test from a report, opens draft PR |
| `telegram-webhook` | Telegram Bot API | Voice-note inbox: secret-token auth, `/start ` project binding, transcript + inline-keyboard confirmation |
| `cursor-webhook` | Cursor Cloud Agent (v0 callback) | Receives `statusChange` callbacks, writes `fix_attempts.pr_url`, notifies |
| `agent-status-poll` | cron (`5-55/5`) | Polls open Cursor / GitHub cloud-agent runs and closes them (PR URL, failure) |
| `agent-pr-review` | cron (`3-53/10`) + re-run route | Reviews each fix PR with Claude Opus 5.5 on the project's Anthropic key; a merge verdict readies the draft (with no review possible, a fix-worker draft falls back to its own self-check), and a "hold" blocks merging from Mushi Mushi without an override |
| `review-followup` | cron (`6-56/10`) | Sends "fix first" findings back to a cloud agent on the same PR (off by default) |
| `fix-verifier` | cron (`4-54/10`) + verify route | Checks the merge gates for a PR's head; merges only when verified auto-merge is on |
| `merge-queue` | cron (`1-56/5`) + queue route | "Merge when ready" and release trains |

The remaining workers (billing, retention, SDK upgrade, skill-sync, rewards payout, …) live alongside these. Full list: `ls packages/server/supabase/functions/` or `pnpm docs-stats`.

## JWT verification

Functions set `verify_jwt = false` in `packages/server/supabase/config.toml`. Auth is enforced **inside** each handler via one of two patterns:

- **Service-role guard** (`requireServiceRoleAuth`) — cron-triggered functions (`intelligence-report`, `pdca-runner`, `judge-batch`, etc.) verify `MUSHI_INTERNAL_CALLER_SECRET` or the Supabase service-role key in the `Authorization` header, so only the scheduler and other server functions can call them.
- **User / API-key guard** — user-facing functions (`api`, `mcp`, `classify-report`, etc.) authenticate via API key or JWT inside the handler.

This two-layer approach lets functions be deployed with `--no-verify-jwt` while keeping security equivalent to the platform default. See `packages/server/supabase/config.toml` for the per-function settings.
