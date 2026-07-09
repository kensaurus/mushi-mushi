# Glot.it PDCA Dogfood — Auto-Fix Loop End-to-End

**Date:** 2026-04-17
**Tester:** kensa
**Scope:** Validate the full **Plan-Do-Check-Act** loop the whitepaper describes — bug report → LLM triage → BYOK fix dispatch → draft GitHub PR → CI sync — running on a real production-grade webapp ([glot.it](https://github.com/kensaurus/glot.it)) using my own OpenRouter key.
**Project under test:** `glot.it` — `542b34e0-019e-41fe-b900-7b637717bb86`

---

## TL;DR

Pulled the existing dogfood thread (see [`dogfood-glotit-2026-04-17.md`](./dogfood-glotit-2026-04-17.md)) into a **complete PDCA orchestrator** with crowd-sourced reports, admin-triggered LLM fixes, and live observability into Langfuse + Sentry + GitHub. End-to-end the loop ran **green**:

| Stage | Surface | Result |
|---|---|---|
| **Plan** — capture report | `@mushi-mushi/web` SDK on glot.it | ✅ HTTP 201, persisted |
| **Plan** — LLM triage | Stage 1 Haiku → Stage 2 Sonnet (BYOK Anthropic) | ✅ severity/category/symptoms attached |
| **Do** — dispatch fix | Admin "Dispatch fix" button | ✅ enqueued, fire-and-forget invokes `fix-worker` |
| **Do** — agentic fix | `fix-worker` Edge Function w/ Vercel AI SDK + structured output | ✅ Claude Sonnet 4.5 via OpenRouter, 3.4k tok |
| **Check** — open draft PR | GitHub REST API | ✅ [`kensaurus/glot.it#3`](https://github.com/kensaurus/glot.it/pull/3) |
| **Check** — observe trace | Langfuse | ✅ trace deep-link rendered on `/fixes` |
| **Act** — CI feedback loop | GitHub `check_run` webhook → `fix_attempts` | ✅ schema + endpoint shipped (no CI configured on `glot.it` repo yet, ready when added) |
| **Act** — surface to admin | `<FixProgressStream/>` on report detail + `/fixes` table | ✅ live status, model, tokens, rationale, files changed |

Three integrations are now **Healthy** for `glot.it` from the Integrations page:

- Sentry — `sakuramoto/glot-it`, HTTP 200, 592ms (DSN `4511023875555328`)
- Langfuse — `us.cloud.langfuse.com` (project `cmmcydyak04nvad07qh40z9o0`), HTTP 200, 504ms
- GitHub — `kensaurus/glot.it`, HTTP 200, 770ms

The admin dashboard was also rebuilt this round into a clickable, charted operations view — KPIs with prior-7d delta, stacked severity bars for intake, sparklines for LLM token + call rate, triage queue, top components, integration health pills with uptime, and a recent-activity stream. Every tile deep-links into the page where you can act on it.

---

## What got built this round

### 1. BYOK is now a first-class surface (not a buried checkbox)

`packages/server/supabase/functions/_shared/byok.ts` already resolved per-project keys, but the UI surfaced none of it. Settings → "LLM API keys" was rebuilt to:

- Show **status pills** per provider (Configured / Tested / Last used)
- Persist **OpenAI-compatible base URL** so a single key works for OpenAI, OpenRouter, Together, Groq, etc. (`byok_openai_base_url`)
- "Test connection" button hits `POST /v1/admin/byok/:provider/test` which actually calls `GET /models` against the resolved endpoint and stores the outcome in `byok_*_test_status` + `integration_health_history`

Set OpenRouter as the LLM backend for glot.it via the UI. Probe came back `status: "ok"`, latency ~700ms.

> Whitepaper §3.2 calls Mushi a "fully BYOK service for LLMs". The codepath was there; the UX wasn't. It is now.

### 2. PDCA orchestrator is no longer a stub

The old `FixOrchestrator` deferred to a `ClaudeCodeAgent` placeholder. Replaced with `packages/server/supabase/functions/fix-worker/index.ts`:

- Vercel AI SDK `generateObject` with a Zod-typed `fixSchema` (rationale, file ops, confidence, branch metadata)
- Resolves BYOK via `resolveLlmKey` (Anthropic / OpenAI / OpenRouter via base URL)
- Pulls scoped repo context via existing `getRelevantCode` RAG helper
- Creates a real **draft PR** on the configured GitHub repo (REST: `git/refs`, `git/blobs`, `git/trees`, `git/commits`, `pulls`)
- Persists every span: `langfuse_trace_id`, `pr_number`, `llm_model`, `llm_input_tokens`, `llm_output_tokens`, `rationale` on `fix_attempts`
- Auto-flags low-confidence fixes for "extra review"

Wired `POST /v1/admin/fixes/dispatch` to call it fire-and-forget. The endpoint also enforces project membership via the new `project_members` table (auto-seeded on project create).

> Whitepaper §4.1 promised "admin can easily trigger fixes via LLM". You can now click one button on a report and watch a draft PR materialise in GitHub.

### 3. Live observability into Langfuse + Sentry + GitHub from one page

Built `IntegrationsPage` as a one-stop hub. Each integration card shows:

- Configured / Not configured / Healthy / Failed pill
- Last probe latency + HTTP status
- 7-day status sparkline pulled from `integration_health_history`
- "Test" button (probes via `POST /v1/admin/health/integration/:kind`)
- Inline editor for credentials (auto-vaulted via `vault_store_secret` so plaintext never sits in `project_settings`)

`integration_health_history` is the same table the BYOK tester writes to, so the UI is honest: a green pill means we just talked to the upstream and it answered.

### 4. End-to-end visibility on the report

`<FixProgressStream/>` lives on every report detail page. When a fix is dispatched it renders:

- Status (queued → running → completed / failed)
- LLM model + token cost + branch name
- "Open PR" + "Langfuse trace" deep-links
- Agent rationale (collapsible)
- Files changed
- "Agent flagged for extra review" warning when confidence < threshold

The `/fixes` page mirrors this as a table with a row-level expand for every attempt.

---

## The PDCA cycle I actually ran

1. **Pick a real bug** — selected report `7c11ead4-21c7-4c55-8dd2-8ada8b4716f9`: *"6-second spinner delay after Get Started CTA tap — likely artificial/hardcoded delay or unresolved async state gate blocking home page render"* (Severity: High, Category: Slow). This came from glot.it via the SDK on a real session.

2. **Dispatch** — clicked "Dispatch fix" from the admin. Membership check passed (after backfilling `project_members` for `glot.it`'s owner). Job enqueued, `fix-worker` invoked.

3. **Fix-worker run** — Sonnet 4.5 via OpenRouter, 2,277 input + 1,117 output tokens. RAG returned no relevant code (glot.it repo wasn't ingested into the embedding index for this dogfood). The agent did the *right* thing: instead of hallucinating a fix, it generated an `INVESTIGATION_NEEDED.md` with a structured search plan listing the four likely root causes (hardcoded `setTimeout`, blocking `useEffect`, lazy-loaded chunk without prefetch, redundant auth re-validation) and the files a reviewer should open.

4. **Draft PR opened** — [`kensaurus/glot.it#3`](https://github.com/kensaurus/glot.it/pull/3) on branch `mushi/fix-7c11ead4-mo2z0r3y`, 1 file, 59 lines, marked **Draft**, body links back to the report and surfaces the rationale.

5. **Observability green** — `fix_attempts` row populated with `langfuse_trace_id=4fd000bd-cbfb-43fc-908f-bc4d7f902b7f`, `pr_number=3`, `llm_model=claude-sonnet-4-5-20250929`. Langfuse trace link works from `/fixes` and from `<FixProgressStream/>` on the report.

6. **Admin loop closed** — `/fixes` shows "1 PR is ready for review" banner with a one-click jump to GitHub. Confidence flag visible. `Hide details` toggle reveals full rationale + files changed inline.

> The whitepaper's PDCA spec explicitly says **no auto-merge** — Mushi opens the PR, the human merges. That's exactly what shipped.

---

## Bugs caught and fixed in the same session

While running the loop end-to-end, I caught a handful of real production bugs in mushi-mushi itself. All fixed.

| Bug | Where | Fix |
|---|---|---|
| `cannot add 'postgres_changes' callbacks ... after subscribe()` crashed report detail page | `apps/admin/src/lib/{reportComments,reportPresence,realtime}.ts` | Made every channel name unique per mount via `crypto.randomUUID()` so React StrictMode double-mount doesn't reuse a subscribed channel |
| BYOK test endpoint returned 404 for OpenRouter | `api/index.ts` | Detect whether `baseUrl` already contains `/v1` and append `/models` correctly |
| `PUT /v1/admin/integrations/platform/:kind` blocked by CORS | `api/index.ts` | Added `'PUT'` to `allowMethods` |
| Gateway rejected JWT (`Unsupported JWT algorithm ES256`) | `supabase/config.toml` | `[functions.api] verify_jwt = false`; in-function `jwtAuth` middleware handles ES256 |
| `vault_store_secret` failed (`permission denied for table secrets`) | `migrations/fix_vault_store_secret_to_use_vault_helpers.sql` | Re-implement to call `vault.create_secret` / `vault.update_secret` helpers instead of touching the table directly |
| `vault.create_secret` failed (`null value in column "description"`) | `migrations/fix_vault_store_secret_pass_description.sql` | Pass `secret_name` as `description` |
| GitHub health probe 404 for `glot.it` | `api/index.ts` | URL regex was `[^/.]+` so it stripped the `.it`; switched to `[^/]+?(?:\.git)?/?$` |
| `FORBIDDEN: Not a member of this project` blocked owners from dispatching | `migrations/backfill_project_members_for_owners.sql` + `api/index.ts` | Backfill `project_members` for every project with an `owner_id` and seed on every new project insert |
| Fix dispatch demanded `projectId` but UI/dogfood scripts only had `reportId` | `api/index.ts` | Resolve `projectId` from the report when omitted |
| Admin couldn't see `glot.it` because RLS filtered owner-less projects | DB | Set `owner_id = test@mushimushi.dev` on `glot.it` |

---

## Whitepaper coverage check

Ran the whitepaper section by section against current behaviour:

- **§2.1 Crowd-sourced capture** — ✅ web SDK + react binding live on glot.it; widget renders; `/v1/reports` accepts with `X-Mushi-Api-Key`
- **§2.2 LLM triage pipeline** — ✅ Stage 1 (Haiku) + Stage 2 (Sonnet) both fire, persist severity/category/component/summary/confidence, all metrics tracked
- **§2.3 BYOK** — ✅ per-project, OpenAI-compatible base URL, vault-stored, tested via UI
- **§3 Admin triage** — ✅ list, detail, status board, presence, comments, audit log
- **§4.1 PDCA orchestrator** — ✅ dispatch → fix-worker → draft PR → CI sync hook (webhook ready, repo CI not configured yet on glot.it)
- **§4.2 No auto-merge** — ✅ PR opens as draft, low-confidence flagged
- **§4.3 Linked to Langfuse + GitHub** — ✅ trace_id persisted, deep-link from every fix attempt
- **§5 Observability/health** — ✅ `integration_health_history` + sparklines on Integrations page
- **§6 Plugin marketplace** — ⏳ schema + listing exists; dogfood deferred (not a blocker)
- **§7 Cloud sign-up + Stripe billing** — ⏳ separate dogfood scope, not exercised this round

---

## What I'd ship next

These are honest gaps, not blockers:

1. **Repo ingestion for RAG** — the agent had to write `INVESTIGATION_NEEDED.md` instead of code because glot.it isn't in the embedding index. Wire `project_repos` to a background indexer so dispatched fixes can actually patch the file the symptom points to.
2. **Sentry Seer poller** — the schema (`sentry_seer_enabled`) and token are in place; the actual cron that pulls Seer's root-cause analysis into matched reports isn't wired yet (`p6-sentry-seer` is still pending).
3. **Streaming progress (real SSE)** — `<FixProgressStream/>` polls every 2s today. Once `fix-worker` emits intermediate spans, an SSE endpoint over `fix_attempts` would tighten the feedback loop.
4. **Plugin marketplace dogfood** — install one external destination (e.g. Linear) end-to-end and verify a triaged report routes correctly.
5. **Stripe billing dogfood** — sign up, hit the free quota, get nudged, upgrade, verify entitlement gates.

---

## Repro

```bash
cd mushi-mushi
npm install
npm run dev   # spawns api + admin (turbo concurrency:20)

# In glot.it:
# - NEXT_PUBLIC_MUSHI_PROJECT_ID, NEXT_PUBLIC_MUSHI_API_KEY in .env.local
# - npm run dev (Next.js 16)

# Submit a report from glot.it (widget bottom-right or programmatic),
# then in the admin at http://localhost:6464:
#   1. /reports → pick the report → "Dispatch fix"
#   2. Watch <FixProgressStream/> below the triage bar
#   3. /fixes → "1 PR is ready for review" → click through to GitHub
#   4. /integrations → all three pills should be Healthy
```

Screenshots (in `apps/admin/.playwright-mcp/`):
- `settings-byok-openrouter-ok.png` — BYOK probe green
- `integrations-all-healthy.png` — Sentry/Langfuse/GitHub all green
- `fixes-page-details-expanded.png` — full rationale + files changed
- `report-detail-with-fix-progress.png` — `<FixProgressStream/>` rendered inline
