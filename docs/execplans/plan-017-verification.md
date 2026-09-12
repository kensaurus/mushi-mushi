# Plan 017 verification log

Evidence for each shipped item, against the production project
`dxptnwrhwsqckaftyymj` (API `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`,
MCP `…/functions/v1/mcp`, console `https://kensaur.us/mushi-mushi/admin/`).
Only what was observed is recorded; "not run" is stated with the reason.

## B. Hosted MCP dual-era (deployed 2026-09-12)

Deployed with `supabase functions deploy mcp --no-verify-jwt`. Probed with curl
using a project API key.

| Probe | Result |
|---|---|
| Legacy `initialize` asking 2025-03-26 | `protocolVersion: 2025-03-26`, capabilities unchanged |
| Legacy `initialize` asking 2025-11-25 | `protocolVersion: 2025-11-25` |
| Legacy `initialize` asking 2026-07-28 | capped at `2025-11-25` (modern clients must not use `initialize`) |
| JSON-RPC batch with `MCP-Protocol-Version: 2025-06-18` | HTTP 400, `-32600` "batch arrays are not supported for protocol version 2025-06-18" |
| Unknown `MCP-Protocol-Version: 2031-01-01` | `-32022` with `data.supportedVersions` = the five-version ladder |
| Modern `server/discover` | `resultType: complete`, `supportedVersions` ladder, `capabilities.extensions["io.modelcontextprotocol/tasks"]`, `ttlMs: 3600000`, `cacheScope: public`, `_meta["io.modelcontextprotocol/serverInfo"]` |
| Modern `initialize` / `ping` | `-32601` "removed in MCP 2026-07-28" |
| `Mcp-Method` header mismatch | `-32020` with `data.header` / `data.body` |
| Modern `tools/call` without `Mcp-Name` | `-32020` "Missing Mcp-Name header" |
| Modern `tools/call activation_status` with `Mcp-Name` | `resultType: complete`, text content |
| Modern `tools/list` | 66 tools for this key's feature set, sorted (`activation_status` … `use_mushi`), `ttlMs: 3600000`, `cacheScope: public`, serverInfo in `_meta` |
| Modern GET with `Accept: text/event-stream` | HTTP 405 |
| `tasks/get` without the extension declared | `-32021` |
| `tasks/get` unknown id with the extension declared | `-32602` "unknown taskId" |
| Unauthenticated `initialize` / `server/discover` | auth-required error (pre-existing behaviour, unchanged) |

Local: `deno check` clean on `mcp/index.ts` and the three new `_shared/mcp-*.ts`
modules; Deno tests 24 + 10 + 18 passed; vitest `mcp-dual-era` and the three
existing MCP suites 55 passed; catalog parity scripts green.

Not run: the CI "MCP smoke (HTTP)" script (needs `supabase functions serve`,
Docker not running on this host); an end-to-end `tools/call dispatch_fix` as a
task (needs a report with a voice session, see C).

## C4 / C0 / A2. Cloud agents, A2A 1.0, event union (deployed 2026-09-12)

Migrations applied through the Supabase MCP `apply_migration` path (recorded
as `telegram_chat_bindings`, `agent_backends`, `agent_status_poll_cron`; the
files under `packages/server/supabase/migrations/20260912004000|006000|007000`
are the on-disk copies). Verified with `information_schema` / `pg_policies` /
`cron.job`:

| Object | Observed |
|---|---|
| `cron.job mushi-agent-status-poll` | schedule `5-55/5 * * * *` |
| `fix_attempts.external_agent_ref / github_task_id / github_task_url / branch_name` | present (jsonb, text, text, text) |
| `telegram_bind_codes`, `telegram_chat_bindings` | present, RLS policy `*_member_select` |
| `project_settings_autofix_agent_check` | includes `github_cloud_agent` |

Functions deployed with `supabase functions deploy <fn> --no-verify-jwt`:
`cursor-webhook`, `agent-status-poll`, `webhooks-linear-agent`,
`webhooks-linear`, `webhooks-github-indexer`, `a2a-push-notify`, `fix-worker`.
Local: `deno check` clean on every touched file; server vitest 85 files /
981 tests (163 new); `plugin-cursor-cloud` and `plugin-sdk` test/typecheck/lint
green.

Not run: a live Cursor or GitHub cloud-agent dispatch (needs a project with a
Cursor key or a Copilot user token; recorded below if executed later); a live
Linear agent session (no Linear webhook can be triggered from here).

Prod probes after deploy (curl, no credentials):

| Probe | Result |
|---|---|
| `POST cursor-webhook?project=<uuid>` without `X-Webhook-Signature` | 401 |
| same with a wrong signature | 401 `INVALID_SIGNATURE` |
| `POST agent-status-poll` without the internal token | 401 `UNAUTHORIZED` |
| `POST fix-worker` without the internal token | 401 `UNAUTHORIZED` |
| `POST webhooks-github-indexer` unsigned | 401 `invalid signature` |
| `POST webhooks-linear-agent` unsigned | 200 `OK` (pre-existing, deliberate: audited as `rejected_signature`, 200 so Linear stops retrying; not changed) |

Deploy warnings `failed to read file … _shared/_shared/trace.ts` and
`… supabase/_shared/setup-funnel.ts` come from the CLI's static import scanner
misresolving two relative paths that are correct at runtime (both files
exist; deploys succeeded); pre-existing, harmless.

## C1 / C2 / C3. Voice intake end-to-end (deployed 2026-09-12)

Migrations applied via MCP (`voice_scope_settings_reports`, `voice_intake_sessions`,
`voice_intake_bucket`; on-disk `20260912001000|002000|003000`). The data
backfill `UPDATE reports SET source='sentry' …` at the end of 001000 was NOT
applied (production data mutation); it would have matched 0 rows. Verified:
bucket `voice-intake` (25 MB, 8 audio MIME types), `voice_intake_sessions`
with `voice_intake_sessions_member_select`, the five `reports.voice_*`/`source`
columns, the five `project_settings` voice columns, `reports_source_check`,
and `project_api_keys_scopes_valid` including `voice:write`.

Functions deployed: `api` (twice: once with the routes, once with the fixes
below), `slack-interactions`, `telegram-webhook`, `retention-sweep`.

End-to-end on the dogfood project (`67a6453c…`, console user login, real
network, real LLM calls):

| Step | Result |
|---|---|
| `PATCH /v1/admin/settings` `voice_intake_enabled: true`, `voice_languages: [en, ja]` | ok |
| `POST /v1/admin/projects/:id/keys` scopes `['voice:write']` | key minted (revoked after the test) |
| `POST /v1/intake/voice` text "open a draft pull request to fix the upgrade button…" | `awaiting_confirm`, action `open_draft_pr`, summary generated, report created, verbatim transcript in `message`, confirm token issued |
| `POST /v1/intake/voice` 314 KB WAV (Windows TTS: "On the pricing page, clicking the upgrade button shows a spinner forever and never opens the checkout dialog.") | STT transcript identical to the spoken text; action `create_report`; report `588f5638…` created; `GET /v1/admin/reports/:id` shows `status: classified`, `source: voice`, LLM-generated title |
| `POST …/:id/cancel` with the issued token | **first run: `CONFLICT` (bug)**; after fix: `200 cancelled` |
| second cancel with the same token | `409 CONFLICT` "already cancelled" |
| `POST …/:id/confirm` with a bad token | `403 INVALID_CONFIRM_TOKEN` |
| `GET /v1/intake/voice/sessions` with the `voice:write` key | **first run: 403 (bug)**; after fix: 4 sessions listed; also ok with a console JWT |
| `GET /v1/intake/voice/:id` | ok |
| request carrying `X-Reporter-Token-Hash` | 403 |
| legacy key without `voice:write` | 403 `INSUFFICIENT_SCOPE` |
| no credentials | 401 |
| `POST /v1/admin/fixes/dispatch` with `agent: "bogus"` | 400 `UNSUPPORTED_AGENT` listing claude_code, codex, auto, rest_worker, rest_fix_worker, llm, mcp, cursor_cloud, github_cloud_agent |
| `POST /v1/webhooks/slack/events` `url_verification` signed with the workspace signing secret | 200 `{ challenge }`; unsigned: 401 `BAD_SIGNATURE` |
| `GET /.well-known/agent-card.json` | 200, `a2a-version: 1.0`, `protocolVersion: 1.0`; self-URL **was `http://` (bug)**, now `https://` |

Bugs found by the prod run and fixed before the second `api` deploy:
1. Confirm-token HMAC was signed over the JavaScript ISO timestamp and verified
   against PostgREST's `+00:00` rendering, so every confirm/cancel failed.
   Fix: `canonicalExpiry()` in `_shared/voice-intent.ts`; regression test
   added (`voice-intent.test.ts`, "survives the PostgREST timestamp round-trip").
2. `GET /v1/intake/voice/sessions` and `/:id` defaulted to `mcp:read`, which a
   `voice:write` key does not hold. Fix: `adminOrApiKey` accepts an any-of
   scope list; the two read routes accept `['mcp:read', 'voice:write']`.
3. `cancelVoice` returned untyped failures, so every failure was a 409. Fix:
   typed `status` mapped to 403/404/409/410 like `confirmVoice`.
4. Agent card self-URL used the gateway-rewritten `http:` scheme. Fix: honour
   `X-Forwarded-Proto`, default to https off loopback.

Left on the dogfood project on purpose: `voice_intake_enabled = true`, four
synthetic voice reports/sessions from this run (titles start with "Upgrade
button on pricing page…"); one session from the first run stays
`awaiting_confirm` until the 10-minute expiry sweep.

Not run: a Telegram bot conversation (no bot token configured for the
project), a Slack clip in a channel (needs the re-installed app with the new
scopes), the PWA capture (see C5), and a confirmed dispatch to a cloud agent
(would open a PR on the live repository; see C4).

## Session 2 — 2026-09-12, closing out

### Bug 5: the confirm-token fix shipped to one entrypoint out of three

`canonicalExpiry()` lives in `_shared/voice-intent.ts`, but each edge function
bundles its own copy of `_shared`. Only `api` was redeployed after the fix, so
the two phone paths — a Slack button click and a Telegram callback — were still
running the broken HMAC. Redeployed `slack-interactions` and `telegram-webhook`.

Proof through the Slack entrypoint rather than the API: a genuinely signed
`block_actions` payload (`voice_cancel`, value `<sessionId>:<confirmToken>`,
`v0=` HMAC over `v0:{ts}:{body}` with the live signing secret) POSTed to
`/functions/v1/slack-interactions`. It answered `200 ":hourglass: Cancelling…"`
and the background work landed:

    id           7740dc33-d507-4bcd-9a9f-77d7af321a37
    status       cancelled
    confirmed_by slack:U0VOICEE2E
    expires_at   2026-09-12 08:48:08.953+00     <- the `+00` that broke the HMAC

A forged signature on the identical body returned `401 Invalid signature`.

### Bug 6: every rate limit routed through `claimTenantRateLimit` was disabled

Found in the edge logs while verifying Web Push, not by a test:

    scoped_rate_limit_claim failed (non-fatal)
    Could not find the function public.scoped_rate_limit_claim(p_limit, p_scope_key, p_window_sec)

The deployed signature is `(p_user_id uuid, p_scope text, p_max_per_window
integer, p_window interval)`. The helper called a non-existent overload, the
error fell into the fail-open branch, and the request was allowed. Every caller
was silently unlimited:

| Call site | Limit that was not enforced |
|---|---|
| `_shared/voice-intake.ts:406` | project voice burst, 30/min |
| `_shared/voice-intake.ts:221` | per-scope voice caps |
| `api/routes/skills.ts:424` | skill pipeline starts, 10/hour |
| `api/routes/push.ts:234` | push self-test, 5/min |

This is the second time this exact shape has shipped here. The 2026-07-02
`generalize_actor` migration fixed the same silent fail-open in report-ingest
limiting. Fix: derive a uuid-shaped actor from the scope key (the pattern
already used by `ipRateLimitActorId`), call the real four-argument signature,
and log the unexpected-error branch at `error` so the next drift is loud.
Pinned by `src/__tests__/tenant-rate-limit-contract.test.ts` (8 tests).

Proven on prod — seven POSTs to `/v1/push/test` against a cap of 5/min:

    1:404  2:404  3:404  4:404  5:404  6:429 retry-after=60  7:429 retry-after=60

(404 = no subscriptions registered, which is the expected body; the point is
where the 429 starts.)

### Web Push verified end to end

`GET /v1/push/vapid-public-key` 200, 87-char key. Subscribe with a real P-256
public key 200. Non-allowlisted host 400. No JWT 401. `POST /v1/push/test`
reached the push service and got `410 Gone` for the fabricated endpoint —
logged as `mushi:web-push subscription_gone status:410` — which proves
aes128gcm encryption and the VAPID JWT were both well-formed, since a bad
signature returns 401/403 and a bad payload never leaves the function. The row
was auto-pruned, so the later unsubscribe correctly removed 0.

`registerPushRoutes` existed but was never called from `api/index.ts`: the whole
push surface was dead code. Wired and deployed.

### Migration ledger reconciled

All seven `20260912*` migrations had been applied through the MCP tool, which
stamps its own version. The ledger held `20260912063308`/`063328`/`063340`/
`072052`/`072236`/`072244` while the files on disk are `001000`–`007000`, so a
`supabase db push` would have re-run all of them — including the
`UPDATE reports SET source='sentry'` backfill in `001000`, which was
deliberately never applied. Renamed the six rows to their on-disk versions and
applied `005000_user_push_subscriptions` (the only genuinely missing one), then
stamped it too. `schema_migrations` now mirrors the seven files exactly.

The `001000` backfill is still unapplied against prod data and is now recorded
as applied. It matches 0 rows today; on a fresh environment it runs normally.

### Gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | 52/52 |
| `pnpm lint` | 49/49, warnings only |
| `pnpm build` | 44/44 |
| `pnpm check:drift` | pass |
| Deno entrypoint check | 58/58 |

`pnpm docs-stats --check` was red on 31 files (55→58 edge functions, 337→345
migrations, 373K→386K TS lines, 1,772→1,812 source files) and is now green.

`apps/docs` build was failing on
`packages/marketing-ui/src/connect/useConnectSelection.ts`: a hooks module with
no `'use client'`, pulled into the server-rendered root layout. The import
arrived with uncommitted work that predates this plan (at HEAD the layout does
not import marketing-ui). Added the directive.

Two turbo test failures — `@mushi-mushi/web` in one run,
`src/__tests__/mcp-server-card.test.ts` in the next — both pass in isolation
(229/229 and 3/3). They are build-order contention under parallel turbo on this
host, not defects.

### Bug 7: the voice usage ledger was blocked by a CHECK constraint

C7 asks for usage events. Adding the insert to `_shared/voice-intake.ts` was not
enough: `usage_events.event_name` is guarded by a CHECK allowlist of five names,
so the insert failed and the caller's non-fatal branch swallowed it — the ledger
stayed empty and nothing surfaced except a warn line. Exactly the fail-open
shape as bug 6, one table over.

Caught only because the write was verified in the database rather than assumed
from a 200 on the intake call:

    new row for relation "usage_events" violates check constraint
    "usage_events_event_name_check"

Migration `20260912008000_usage_events_voice_minutes.sql` extends the allowlist.
Re-ran a real audio intake and the row now lands:

    event_name  voice_minutes_transcribed
    quantity    1
    metadata    {source: api, duration_sec: 8, stt_model: gpt-transcribe,
                 stt_cost_usd: 0.0006, voice_session_id: 67e45888-…}

**Not billable, deliberately.** `usage-aggregator/index.ts` pushes a Stripe
meter event only for names in its own `meteredEvents` list, and this one is
absent from it. The row is an internal cost record. Adding it to that list is
what would make it billable, and that needs a priced SKU and a matching Stripe
meter first. The constraint comment says so, so the next person to touch it
cannot miss it.

### Open finding, not fixed: hosted STT is unpriced

Every transcription logs, at error level:

    mushi:hosted-llm-billing  No wallet price for hosted model — call not charged
    provider=openai  model=gpt-transcribe  feature=voice-intake.stt

Hosted voice transcription runs on the platform's key and is not charged to the
project wallet. The STT cost is now visible in the usage ledger, so it is at
least measurable, but pricing `gpt-transcribe` in the wallet model is a billing
decision and is left for the owner.

### Real speech-to-text, end to end on prod

Same synthesised clip as session 1, sent as `audio_base64`:

    8s wav -> gpt-transcribe -> "On the pricing page, clicking the upgrade
    button shows a spinner forever and never opens the checkout dialog."
    intake 3.4s wall clock, session created, report filed

### Admin PWA

Built exactly as CI does (`VITE_BASE_PATH=/mushi-mushi/admin/`) and served
locally. The manifest carries the right prefix throughout — scope
`/mushi-mushi/admin/`, start URL `/mushi-mushi/admin/voice?source=pwa`, share
target `/mushi-mushi/admin/voice/share` — and the service worker registers and
reaches `activated` at that scope.

Signed in as a real user against the prod backend through the dev server, which
proxies (a `vite preview` origin is correctly refused by prod CORS). `/voice`
redirects to `/login?next=%2Fvoice` when signed out, and after sign-in renders
tap-to-talk, upload a clip, type it instead, "Notify this device" and the recent
voice requests list, with zero console errors. Sign-in was confirmed from the
Supabase session in storage, not from page text.

**Console not deployed.** `deploy-admin.yml` ships the console from master. The
working tree carries about sixty uncommitted files, including admin and
marketing-ui changes authored outside this plan, so a manual S3 sync would
publish unreviewed work to the live console. Left for the normal branch-and-CI
path.

### Gates, final

| Gate | Result |
|---|---|
| `pnpm typecheck` | 52/52 |
| `pnpm lint` | 49/49, warnings only |
| `pnpm test` | 85/85 — superseded, see "`pnpm test` — what is actually true" and bug 11 below |
| `pnpm build` | 44/44 |
| `pnpm check:drift` | pass |

`pnpm install` was required and run: `wp-knip` added `eslint` and the shared
config as devDependencies to twelve packages, so both root lint and CI's
`--frozen-lockfile` would otherwise have failed. `pnpm-lock.yaml` is updated.

### Bug 8: the knip ratchets in CI were pinned to numbers that never held

`ci.yml` carried `--max-issues 733` / `579`, measured while the SDK v2
migration and the admin PWA were still in flight. On the finished tree both
fail, so the first CI run on this branch would have gone red on a gate this
plan added.

Re-measured by binary search on the real tree: 747 and 586 fail, 748 and 587
pass. Updated `ci.yml`, regenerated both baseline JSON files, and rebuilt the
per-workspace tables in `knip-baseline/README.md` from the new capture so the
tables sum to the thresholds instead of contradicting them.

The extra findings are test-only exports from the new PWA modules
(`lib/pwa.ts`, `lib/voiceIntake.ts`, `lib/voiceRecorder.ts`,
`components/voice/`). Production mode excludes tests, so it cannot see them
used — the same category as the admin components already in the baseline, not
new dead code.

The lesson generalises: **a ratchet measured mid-flight is not a ratchet.** Pin
it after everything lands, or the gate fails on its own first run.

### Open finding, not fixed: the Helm migration ConfigMap is over budget

`pnpm sync:helm-migrations` now warns:

    ConfigMap budget warning: 1239 KiB / 1024 KiB

346 migrations no longer fit a single Kubernetes ConfigMap, whose hard limit is
1 MiB. The check still passes because it is a warning, but a self-hosted Helm
install will fail at apply time. The script suggests sharding by year prefix.
Left for the owner: it changes the chart's shape, not this plan's surface.

### Documentation counters, twice

`docs-stats` went red a second time after migration `008000` landed (345 → 346)
and was fixed across 31 files. Worth knowing for anyone adding a migration:
the counter appears in every package README footer plus the root README glance
line, and `pnpm docs-stats` only prints — it does not write.

### Open finding, not fixed: one unapplied migration from other in-flight work

`packages/server/supabase/migrations/20260828100000_sdk_upgrade_jobs_stuck_reaper.sql`
is untracked on disk and is **not** in `supabase_migrations.schema_migrations`.
It is not part of Plan 017 — it arrived with the same uncommitted tree as the
SDK-upgrade reclaim work (`_shared/sdk-upgrade-reclaim.ts` and its test).

Recording it because this plan's ledger reconciliation covered only the
`20260912*` set, and "the ledger mirrors the files" is true for those eight and
no others. This one adds a `sdk_upgrade_jobs_stuck_reaper()` function and a
10-minute pg_cron job that fails jobs stuck over 30 minutes.

Not applied: it is another workstream's schema, unreviewed here, and applying
someone else's migration to production is not this plan's call. Whoever owns
the SDK-upgrade reclaim work should apply it and stamp the ledger row to
`20260828100000`, the same way the eight voice/agent migrations were.

### Hosted MCP re-probed at close of session

Re-run against prod after every redeploy, with an `mcp:read` key:

| Probe | Result |
|---|---|
| `server/discover` | `resultType: complete`, five-version ladder `2026-07-28 … 2024-11-05`, `ttlMs 3600000`, `cacheScope public` |
| `tools/list` (modern) | `resultType` + `ttlMs` + `cacheScope` present, 66 tools |
| `initialize` at `2025-03-26` | negotiated `2025-03-26`, server `mushi-mushi` |
| `tools/list` (legacy) | 66 tools, no `resultType` — correct for the legacy era |
| `Mcp-Method` header disagreeing with the body | `400`, JSON-RPC `-32020` |

66 rather than 73 is the read-only key: write tools are filtered out for an
`mcp:read` scope. The npm package's 73 is the unfiltered catalog.

Two probes initially looked like failures and were not. `server/discover`
without `params._meta["io.modelcontextprotocol/protocolVersion"]` returns
`-32020`, and `initialize` without a key returns an auth error. Both are the
server enforcing the spec and the auth contract correctly; the first probe
script simply sent malformed requests.

The hosted `mcp` function was **not** redeployed this session and did not need
to be: `_shared/mcp-rate-limit.ts` already calls `scoped_rate_limit_claim` with
the correct four-argument signature, and it only mentions
`tenant-observability.ts` in a doc comment, so it never bundled the broken
helper. Checked rather than assumed, per the `_shared` lesson above.

### Every CI gate run locally, not just the five headline ones

The `build` job in `ci.yml` runs far more than typecheck/lint/test/build. All of
it was run against this tree:

| Gate | Result |
|---|---|
| `pnpm typecheck` · `lint` · `build` | 52/52 · 49/49 · 44/44 |
| `pnpm test` | see the caveat below — green per package, flaky under turbo |
| `pnpm check:drift` (12 sub-checks) | pass |
| `pnpm check:design` (11 sub-checks) | pass |
| knip production `--max-issues 748` | pass |
| knip default `--max-issues 587 --treat-config-hints-as-errors` | pass |
| license headers · SPDX headers · dead buttons | pass |
| `check:residue` · `check:nav-registry` · `check:sdk-api-surface` | pass |
| `check:catalog-sync` · `check:catalog-count` · `check:helm-migrations` | pass |
| `check:config-docs` · `check:narrative` · `check:sdk-version-matrix` | pass |
| `check:flutter-pii-patterns` · `check:env-source-parity --warn` | pass |
| `pnpm changelog:check` | pass, after being red — see below |
| `pnpm check:changeset-orphans` | pass, after being red — see below |
| Deno entrypoint check, all 58 | pass |

`changelog:check` was red after the SDK v2 changeset was added and was fixed
with `pnpm changelog:aggregate` (`CHANGELOG.md` and
`apps/docs/data/changelog.json` regenerated, 55 releases in sync).

Four gates were red at some point today and are now green. Two belong to this
plan: the knip ratchets (thresholds measured mid-flight, see bug 8) and
`check:docs-stats` (three times, once per migration added). Two were collateral:
`changelog:check` went red the moment the SDK v2 changeset was written and was
fixed by `pnpm changelog:aggregate`, and `check:changeset-orphans` was red for
an unrelated reason (see bug 10). Adding a gate and not running it is the same
as not adding it — and `check:changeset-orphans` is the proof, because it was
missing from this table's first draft and had never been run.

### Bug 10: an orphan changeset would have failed the release

`check:changeset-orphans` runs in the required `build` job and was red on three
consecutive runs. `.changeset/reports-per-user-session-browsing.md` targeted
only `@mushi-mushi/server`, which is in `.changeset/config.json#ignore`. Every
target ignored means zero version bumps, an empty version PR, and then "No
commits between master and changeset-release/master" on the next push.

Found by the independent completion check, not by me: my own "every CI gate"
sweep had simply omitted this step. That is the honest reason it survived.

The repo had already hit and fixed this on the same file — commit `3a0227cc`,
"drop server-only changeset (ignored package — orphan gate)". The file had
reappeared untracked. Deleted again, and the text is not lost: commit
`8294b95d` shipped the work it describes and `git show` still returns the
changeset body.

### `pnpm test` — what is actually true

Per package, everything passes. The full turbo run is flaky on this Windows
host and should not be quoted as a single clean number.

| Run | Result |
|---|---|
| `turbo run test --concurrency=4 --force` | **85/85 successful**, 8m00s |
| Four other full runs | one failure each, in four *different* packages |
| Every failing package, re-run alone | passes |

The packages that failed once each: `@mushi-mushi/web` (23 files, 229 tests),
`@mushi-mushi/server` (91 files, 1101 passed and 5 skipped), `@mushi-mushi/core`
(23 files, 230 tests), and `@mushi-mushi/docs` (34 tests). The 5 skips are a
pre-existing `describe.skipIf(!isLive)` live-Supabase suite in
`e2e-pipeline.test.ts`, not narrowing introduced here.

So: one fully green turbo run exists, and the suite is green package by package,
but the run is not reliably reproducible under parallel load on this machine.
Lowering `--concurrency` to 4 did not eliminate it. The likely cause is file-lock
contention on Windows, the same thing that made `README.md` unwritable twice
today with `UNKNOWN errno -4094`. It is worth a look on its own, and it is not
evidence about the code in this plan.

### The live production console still works after the redeploys

`api` was redeployed five times today and the deployed console at
`https://kensaur.us/mushi-mushi/admin/` talks to it. Read-only smoke against
the real site, signed in as the test user:

| Check | Result |
|---|---|
| Landing page | loads, redirects to `/mushi-mushi/admin/login` |
| Sign-in | succeeds, confirmed by the Supabase session in storage |
| Destination | `/mushi-mushi/admin/dashboard` |
| Calls to `/functions/v1/api/*` | 49, **all 49 were 2xx** |
| Page and console errors | none |

This matters more than any of the new-feature probes: it is the check that says
today's deploys did not break the product for its actual users. The console
bundle itself is unchanged — this exercises the previously-deployed frontend
against the newly-deployed backend, which is exactly the pairing a partial
deploy puts into production.

### The three new webhook functions, probed on prod

Deployed with `verify_jwt = false` (they authenticate themselves), so each was
checked for reachability *and* for refusing forged traffic:

| Endpoint | No project / no auth | Bad credential |
|---|---|---|
| `telegram-webhook` | `400 MISSING_PROJECT` | `401 UNAUTHORIZED` — "Invalid webhook secret" |
| `cursor-webhook` | `400 MISSING_PROJECT` | `401 INVALID_SIGNATURE` — "X-Webhook-Signature mismatch" |
| `agent-status-poll` | `401 UNAUTHORIZED` — internal caller token | n/a |

Reachable without a Supabase JWT, as `config.toml` intends, and closed to
anyone without the right per-project secret. A valid-signature path was not
exercised for either: the dogfood project has no Telegram bot token and no
Cursor key configured, which is the same reason no live cloud-agent dispatch
was run.

### Agent card and OpenAPI document, live

The agent-card scheme fix (bug 4 in session 1) holds on prod — both self-URLs
come back `https://`, not the gateway-rewritten `http://`, and the card
advertises A2A `1.0`:

    url    https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/v1/a2a
    iface  https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/v1/a2a

`GET /openapi.json` serves 25 paths, including all six voice-intake routes and
both Slack webhook routes that were added, and carries `2026-07-28` in the
protocol-version ladder.

## Closing gaps the admin-PWA agent reported

Its final report listed five lead-owned items. Two were already done by another
agent and were verified rather than repeated: `voice:write` is in
`project-keys.ts` `ALLOWED_KEY_SCOPES` (which is why every key minted during
this verification worked), and the settings PATCH allow-list already carries the
five voice columns with vaulting for the two secret refs. Three were real.

### Bug 9: the voice page's live refresh was subscribed to an unpublished table

`VoicePage.tsx:80` calls `useRealtimeReload(['voice_intake_sessions'], …)`, but
migration `002000` never added the table to the `supabase_realtime`
publication. Confirmed against prod: the publication carried 16 tables and this
was not one. The channel joins, no row event ever arrives, and the list only
moves when the operator presses Refresh. Nothing errors — the third silent
fail-open of the day, and the same omission
`20260520930000_publish_synthetic_runs_realtime.sql` fixed for `synthetic_runs`.

Migration `20260912009000` publishes it, guarded on `pg_publication_tables` so
it is genuinely re-runnable (the synthetic_runs precedent only guarded on the
table existing, so a second run would raise 42710).

Proven live, not merely published — a signed-in client subscribed and then an
intake was created through the API:

    INSERT  status=received
    UPDATE  status=transcribed
    UPDATE  status=confirmed

### The four push routes were missing from the OpenAPI document

Added, with the SSRF allowlist and the 5/min limit described in the
descriptions, and deployed. `GET /openapi.json` now serves 28 paths including
all three push entries. The generated route manifest already covered them,
since it scans source rather than registration — which is exactly why it did
not catch that the routes were unregistered.

### The admin docs page for `/voice`

Written as `apps/docs/content/admin/voice.mdx` and registered in the section
menu. `check:admin-docs-coverage` goes from one gap to
"52 App.tsx routes have matching admin MDX".

### ADR 0012 recorded a decision the implementation reversed

The ADR chose `@pushforge/builder`. The implementation did not use it: its
2.0.5 build emits the pre-standard `aesgcm` content coding rather than RFC 8291
`aes128gcm`, which is what Apple's push service documents, so the dependency
would have failed on the exact platform this loop targets. RFC 8291/8292 are
implemented directly on Web Crypto instead.

That also contradicts the ADR's own "hand-rolled ECDH/HKDF is forbidden" line.
The rule was written to avoid unreviewed crypto; the alternative on offer was
not unreviewed, it was incorrect. ADR 0012 now records the reversal, the
evidence, and why the rule did not apply, rather than describing a library the
code does not import.

### Second observation of the rate limiter

The independent completion check noted that several live-prod claims rest on a
single observation. The rate limiter is the cheapest to repeat, so it was run
again from a clean session:

    404 404 404 404 404 429(retry-after=60) 429(retry-after=60)

Identical to the first run: five allowed, 429 from the sixth, against a cap of
5 per minute. The 404s are the expected body when no push subscriptions are
registered; the position of the first 429 is the measurement.

The remaining single-observer claims are the speech-to-text run, the signed
Slack button cancel, and the Web Push 410. Each mutates state or consumes
budget, so they were not repeated. The four prod facts the reviewer could check
independently — the MCP version ladder and `-32022`, the agent card's `https://`
self-URL and A2A 1.0, the nine-row migration ledger, and the zero-row result of
the `001000` backfill predicate — all held exactly as recorded here.


### Bug 11: the "turbo contention" was mostly one genuinely flaky test

Five full test runs produced four single-package failures, and both the log
above and the independent reviewer wrote it off as parallel-load contention on
this Windows host. That was a comfortable answer, and it was wrong.

Running the worst offender alone settled it — `@mushi-mushi/web` failed **two of
three isolated runs**, always on the same test:

    src/capture/discovery.test.ts
      createDiscoveryCapture (hashchange subscription)
        collects query-param keys from inside the hash fragment (keys only)

`createDiscoveryCapture` debounces its first emission by 100ms
(`discovery.ts:317`). The tests slept a flat `await wait(150)` and then asserted
on the collected events. A 50ms margin is not enough when several vitest workers
share a loaded machine: the timer fires late and the assertion runs against an
empty array.

Both the test and its source are committed code that predates this plan, so
this is a pre-existing defect, not a regression — but it was making the repo's
own test gate untrustworthy, and it is the reason four "green in isolation"
claims in this document needed a caveat.

Fixed by replacing the three fixed sleeps with a `waitFor(predicate, 3000)`
poll. **No assertion was changed, removed or relaxed** — a real regression still
fails, now via the timeout rather than a race. Result: five consecutive green
runs of the web package where it previously failed two in three, and a
subsequent full `turbo run test --force` at 85/85.

`@mushi-mushi/core` kept failing afterwards, so the same method was applied
again rather than shrugging at it. Capturing turbo's full output on a failing
run named it immediately:

    src/api-client.test.ts > createApiClient > retries on 5xx errors
    Error: Test timed out in 5000ms.

A second, different cause. That test exercises the real retry path, so it
genuinely sleeps through `getBackoffDelay()` instead of faking timers. Fine
alone; over 5s once several vitest instances share the CPU. The same shape had
already taken four `@mushi-mushi/server` tests — `agent-status-poll`,
`dispatch-fix`, `linear-agent-dispatch` and `web-push` — measured at 6–8s wall
clock each, where those same 45 tests finish in 3.7s when the package runs
alone, about 80ms apiece.

Both packages now set `testTimeout`/`hookTimeout` to 30s in their own
`vitest.config.ts`, with the reason written where the next person will read it.
That is a synchronisation parameter, not an assertion: a genuinely hung test
still fails, 30s is far above anything either suite legitimately needs, and no
expectation was touched.

So the unreliability had three distinct causes, none of them "the machine is
busy" as an excuse:

| Cause | Where | Fix |
|---|---|---|
| Fixed 150ms sleep against a 100ms debounce | `web/src/capture/discovery.test.ts` | poll for the condition |
| Real backoff sleep against a 5s default timeout | `core/src/api-client.test.ts` | `testTimeout: 30s` |
| Unit tests starved past the 5s default | four `server` suites | `testTimeout: 30s` |

A fourth, unfixed because it is not ours: `@mushi-mushi/docs#build` failed once
with `UNKNOWN: unknown error, open 'apps/docs/public/llms-full.txt'` — the
Windows `errno -4094` file lock that also made `README.md` unwritable twice
today. Because `docs#build` is a dependency of many test tasks, its failure
cascades and reads as a large test failure. Worth knowing before anyone chases
it as a test bug.

### And the residual really is the machine

After both timeout fixes, four consecutive full runs went green, green, and two
single-package failures — in `mushi-mushi` (root) and `@mushi-mushi/node`,
neither previously implicated. Failures that wander between packages are not
N independent test bugs. So the host was measured instead of guessed at:

| | |
|---|---|
| Logical CPUs | 20 |
| Total RAM | 31.7 GB |
| **Free RAM** | **6.1 GB** |

That is the answer. `turbo run test` starts up to ten vitest instances, each
spawning its own worker pool, against 6 GB of headroom on a machine already
carrying ~25 GB. The constraint is memory, not CPU, which is exactly why the
victim changes every run. It is a condition of this laptop at this moment, not
a property of the repository, and CI runs on a dedicated `ubuntu-latest` runner
with a clean memory budget.

The two timeout fixes are still the right change: they make the suites resilient
to scheduler and memory pressure instead of reporting it as test failure. The
genuinely broken test was the web one, and it is fixed.

**Honest bottom line on `pnpm test`:** every package passes in isolation, and
the full turbo run has completed 85/85 several times, but it is not reliably
reproducible on this host while memory is this tight. That is a statement about
the machine. The defensible claim is repository-green per package, plus multiple
clean full runs — not a single reproducible full green on demand.

**The lesson worth keeping:** "flaky under parallel load" is a hypothesis, not a
diagnosis. Running the failing package alone in a loop, or capturing turbo's
full output on a failing run, costs a few minutes and either names the test or
rules the hypothesis in. Neither the first pass nor the first review did it, and
both of us wrote "contention" over what turned out to be one real test defect
and two missing timeouts.
