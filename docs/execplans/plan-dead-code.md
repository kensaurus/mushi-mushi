# Plan 017 · Workstream A2 — the unreachable-feature register

Companion to [`dead-code-voice-agent-loop.md`](./dead-code-voice-agent-loop.md)
and the measured baseline in
[`knip-baseline/README.md`](./knip-baseline/README.md).

knip answers "what is not imported". It cannot answer the more expensive
question this register exists for: **what is imported, compiles, ships, and
still never runs.** Every row below is reachable-looking code with a live
import graph and a broken chain somewhere behind it. None of it would ever
appear in a knip report.

Captured 2026-09-12 on `fix/stagger-edge-cron-herd`.

## Verdict key

| Verdict | Meaning |
|---|---|
| **fixed** | The chain was repaired this plan and proven to run. |
| **wired** | Code existed and was never called; now called. |
| **keep** | Reachable on a path we do not exercise here. Left alone deliberately. |
| **decide** | Needs a product call before delete-or-finish. Not this plan's to make. |

---

## Register

### 1. `claimTenantRateLimit` — every caller silently unlimited · **fixed**

`_shared/tenant-observability.ts` called `scoped_rate_limit_claim` with
`(p_scope_key, p_limit, p_window_sec)`. No such overload exists; the real
signature is `(p_user_id uuid, p_scope text, p_max_per_window integer,
p_window interval)`. PostgREST answered "Could not find the function ... in the
schema cache", the helper's fail-open branch swallowed it, and the request was
allowed. Four limits were dead:

| Call site | Limit not enforced |
|---|---|
| `_shared/voice-intake.ts:406` | project voice burst, 30/min |
| `_shared/voice-intake.ts:221` | per-scope voice caps |
| `api/routes/skills.ts:424` | skill pipeline starts, 10/hour |
| `api/routes/push.ts:234` | push self-test, 5/min |

The exact shape the 2026-07-02 `generalize_actor` migration was written to fix,
reintroduced through a different helper. Found in prod edge logs, not by a
test. Fixed, pinned by `src/__tests__/tenant-rate-limit-contract.test.ts`, and
proven on prod: seven POSTs to `/v1/push/test` against a cap of 5 now yield
`404 404 404 404 404 429 429`.

### 2. `registerPushRoutes` — never called · **wired**

`api/routes/push.ts` exported a registrar defining four routes. `api/index.ts`
never imported it, so the entire developer Web Push surface returned 404. Wired
and deployed; all four routes verified on prod.

### 3. Confirm-token fix shipped to one entrypoint of three · **fixed**

Each edge function bundles its own copy of `_shared`. `canonicalExpiry()` was
deployed with `api` only, so a Slack button click and a Telegram callback were
still running the broken HMAC and rejecting every confirmation. Redeployed
`slack-interactions` and `telegram-webhook`; proven through a genuinely signed
Slack `block_actions` payload.

**Standing rule this produced:** a change to anything under `_shared/` is a
change to every function that bundles it. Grep the importers and redeploy all
of them, never just the one you were thinking about.

### 4. `fix.requested` — event name in two unions, absent from a third · **decide**

Present in `CURSOR_EVENTS` and the SDK event union, absent from the server
union, so a client emitting it is dropped server-side without an error. Needs a
product call: add it to the server union, or remove it from the other two.

### 5. `cursor_cloud` agent — nulled at dispatch, skipped at execution · **fixed**

`fix-dispatch`'s `ALLOWED_AGENTS` silently nulled the value and `fix-worker`'s
`SUPPORTED_AGENTS` skipped the job, so selecting the agent produced a job that
never ran and never errored. Workstream C4 replaced this with real adapters
(`_shared/agent-adapters.ts`, `cursor-cloud.ts`, `github-agent-tasks.ts`) plus
a completion webhook and a poller. Schema and deploy verified; a live dispatch
was deliberately not run (see "Not done").

### 6. Three separate Cursor clients · **decide**

Three implementations of the same API with different retry, error and timeout
behaviour. Consolidation is a refactor with no user-visible change; it needs an
owner before anyone deletes two of them.

### 7. `FixOrchestrator` · **decide**

Imported, compiles, no reachable caller path that constructs it.

### 8. `linear-agent` swallowed a 400 and logged success · **keep**

A 400 from Linear was caught and reported as a successful dispatch, so failures
were invisible. Reachable, but on a path this plan does not exercise; recorded
here so it is not mistaken for working.

### 9. `claude_code_agent` with no `workflow_run` handler · **decide**

The agent value is accepted; the webhook event that would complete its loop has
no handler, so runs never close out.

### 10. `PublicHomePage` · **deleted**

Nothing imported it. Removed in A3. Three prose/allowlist references remain
(`apps/admin/README.md:489`, `apps/admin/src/index.css`, and
`scripts/check-design-tokens.mjs`); they are inert strings.

### 11. `_unused_notifyA2A` · **deleted**

A no-op in `pdca-runner/index.ts`. Removed; `deno check` passes.

### 12. `plugin-slack-app` commands and the phantom webhook path · **fixed**

The plugin advertised slash commands against `/v1/webhooks/slack/events`, a
path the API did not serve. Workstream C3 implemented
`api/routes/slack-events.ts` and registered it; both paths are now in the
OpenAPI document.

### 13. `generate-hosted-tools.mjs` · **deleted**

Superseded by `sync:mcp-discovery-card`.

### 14. Ungated check scripts · **fixed**

`check:catalog-sync`, `check:catalog-count`, `check:sdk-api-surface`,
`check:helm-migrations`, `check:nav-registry` and the new `check:residue` /
`check:env-source-parity` all existed but none ran in CI, so all three
tool-count drift scripts were failing unnoticed. Added to the `build` job in
`.github/workflows/ci.yml` alongside the two knip ratchets.

### 15. `mushi.edge_function_post` defined only in the hosted database · **keep**

The function exists in the hosted project but in no migration, so a fresh
environment built from `supabase/migrations/` does not have it. Recorded as
schema drift; fixing it means writing the migration to match production, which
is out of this plan's scope.

### 16. Helm migration mirror out of sync · **fixed**

`deploy/helm/migrations/` held 319 files against 337 real migrations. Resynced
with `pnpm sync:helm-migrations`; now 347 files in sync, and
`check:helm-migrations` runs in CI.

### 17. Duplicated `reporter_push_subscriptions` DDL · **keep**

Two migrations create the same table. Idempotent, so harmless. Left alone
rather than rewriting migration history.

### 18. Migration ledger stamped by tool, not by filename · **fixed**

Every `20260912*` migration was applied through the MCP tool, which assigns its
own version. `schema_migrations` held `20260912063308` and five siblings while
the files on disk are `001000` upward, so `supabase db push` would have re-run
every one of them — including the `UPDATE reports SET source='sentry'` backfill
that was deliberately never applied. Renamed the six rows to their on-disk
versions and applied the three genuinely missing migrations (`005000`,
`008000`, `009000`). The ledger now mirrors all nine files exactly.

### 19. The voice page's realtime subscription had no published table · **fixed**

`VoicePage.tsx:80` calls `useRealtimeReload(['voice_intake_sessions'], …)`, but
migration `002000` never added the table to the `supabase_realtime`
publication. Prod carried 16 published tables and this was not one, so the
channel joined, reported SUBSCRIBED, and received nothing — the list only moved
when the operator pressed Refresh. The same omission `synthetic_runs` had in
2026-05. Migration `20260912009000` publishes it, guarded on
`pg_publication_tables` so it is genuinely re-runnable. Proven live by
subscribing and watching INSERT, UPDATE, UPDATE arrive for one intake.

### 20. An orphan changeset would have failed the release · **fixed**

`.changeset/reports-per-user-session-browsing.md` targeted only
`@mushi-mushi/server`, which is in `.changeset/config.json#ignore`. A changeset
whose every target is ignored produces zero version bumps, so the Release
workflow opens an empty version PR and the next push dies on "No commits
between master and changeset-release/master". `check:changeset-orphans` runs in
the required `build` job and was red.

The repo had already hit and fixed this once — commit `3a0227cc`, "drop
server-only changeset (ignored package — orphan gate)", on this same file. The
file had reappeared untracked. Deleted again; its text is preserved in commit
`8294b95d`, which shipped the work it describes.

---

## Not done, deliberately

- **The `001000` backfill.** It is a production data mutation, matches 0 rows
  today, and was never approved. It is recorded as applied so `db push` cannot
  fire it; it still runs normally on a fresh environment.
- **A live cloud-agent dispatch.** The dogfood project has no Cursor key, its
  only repository is this one, and there were no open reports. A live run would
  mean adding a production secret and letting an agent open a pull request on
  the main repository.
- **`deadcode-execute` beyond the three safe deletions.** The remaining 748
  production findings are debt to pay down against a ratchet, not a bulk
  delete. Nothing was removed without a reachability argument.
- **Landing the branch.** Nothing has been committed or pushed.
