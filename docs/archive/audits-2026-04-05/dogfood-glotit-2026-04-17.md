# Glot.it Dogfood — Findings & P0 Fixes

**Date:** 2026-04-17
**Tester:** kensa
**Scope:** Validate end-to-end Mushi pipeline (SDK → Edge Function → Stage 1 → Stage 2 → Admin Console) against a real production-grade webapp ([glot.it](https://github.com/kensaurus/glot.it) — Next.js 16 + React 19 PWA + Capacitor + Sentry).
**Project under test:** `glot.it` — `542b34e0-019e-41fe-b900-7b637717bb86`

---

## TL;DR

Dogfood validated **all three capability surfaces** (SDK + classify + admin triage; full PDCA loop; cloud + plugin marketplace), but uncovered **one P0 silent-failure bug** that would have shipped to every hosted customer:

1. ✅ SDK loads via `deferWork()` lazy queue alongside Sentry. Widget renders. Reports submit at HTTP 201.
2. ✅ Stage 1 (Haiku 4.5) and Stage 2 (Sonnet 4.6) both run successfully — billed and traced in `llm_invocations`.
3. ❌ **P0:** Pipeline `UPDATE` writes silently failed because `stage1_prompt_version` and `stage2_prompt_version` columns were referenced by the code but **never added to the schema**. Customers would have paid for two LLM calls and seen `status='new'` with no severity/summary/symptoms — i.e. zero visible AI value.
4. ✅ After fix, all reports show full classification, severity, component identification, and AI summaries in the admin console.

---

## The P0 Bug

### Symptom

5 fixture reports submitted from glot.it:

| Report | Status After Pipeline | Severity | Summary | Stage 1 model | Stage 2 model |
|---|---|---|---|---|---|
| bug | `new` | NULL | NULL | NULL | NULL |
| slow | `new` | NULL | NULL | NULL | NULL |
| visual | `classified` | NULL | (partial) | NULL | NULL |
| confusing | `new` | NULL | NULL | NULL | NULL |
| other | `new` | NULL | NULL | NULL | NULL |

Yet `llm_invocations` showed **9 successful calls** (5 fast-filter + 4 classify-report) totalling ~80 seconds of Anthropic billing, all with `status='success'`.

### Root Cause

`packages/server/supabase/functions/fast-filter/index.ts:180` and `packages/server/supabase/functions/classify-report/index.ts:219` both write:

```ts
await db.from('reports').update({
  ...
  stage1_prompt_version: promptSelection.promptVersion,  // ← column does not exist
  ...
}).eq('id', reportId)
```

But neither `stage1_prompt_version` nor `stage2_prompt_version` was ever added to the `reports` table by any migration. Only `prompt_version_id` (single, aggregate) exists.

The `supabase-js` `.update().eq().error` pattern resolves the promise even when the underlying PostgREST request returns a 400 — which is exactly what happened. The error was logged but only at `error()` level inside a try/catch that didn't re-throw, so the queue was marked `completed` and the customer never knew.

The smaller "high-confidence" UPDATE in fast-filter (`status: 'classified', summary`) succeeded for one report because it didn't touch the missing columns — which is why exactly one of the 5 fixtures showed a partial classification.

### Fix

Migration: `add_stage_prompt_version_columns` + `fix_stage_prompt_version_columns_to_text`:

```sql
ALTER TABLE reports
  ADD COLUMN stage1_prompt_version text,
  ADD COLUMN stage2_prompt_version text;

CREATE INDEX reports_stage1_prompt_version_idx ON reports(stage1_prompt_version);
CREATE INDEX reports_stage2_prompt_version_idx ON reports(stage2_prompt_version);
```

(`text`, not `uuid`, because the code passes the version string from `prompt_versions.version`, not the row id.)

### Verification

Re-ran 3 fresh fixtures post-fix:

| Report | Status | Severity | Confidence | Component | Stage 1 | Stage 2 |
|---|---|---|---|---|---|---|
| bug — spinner delay | `classified` | high | 82% | Home Page / "Get Started" CTA | haiku-4-5 (2155 ms) | sonnet-4-6 (17373 ms) |
| slow — Sing Along chip | `classified` | medium | 78% | Home Page – Sing Along Chip | haiku-4-5 (1865 ms) | sonnet-4-6 (15611 ms) |
| visual — chip carousel | `classified` | high | 90% | (visual fast-track) | haiku-4-5 (2193 ms) | (skipped, high confidence) |

All three render in the admin console with structured fields, summaries, and the `Dispatch fix` agentic-fix CTA visible.

### Hardening Recommendations

1. **Make `.update()` errors fatal in the worker pipeline.** `if (updateError) { throw updateError }` instead of `log.error(...)`. A silent UPDATE failure in a billed pipeline is a worst-case bug shape — the customer pays, sees nothing, and the system reports success.
2. **Add a row-level invariant test** that runs every migration: pick a report, run the pipeline end-to-end, assert `status != 'new'`. This would have caught the bug in CI.
3. **Type-generate from migrations.** If the function bodies were typed against generated DB types (`supabase gen types`), `stage1_prompt_version` would have been a TypeScript compile error.

---

## SDK Integration in glot.it (Reference)

For other downstream integrators, this is what landed:

```
glot.it/
├── lib/mushi.ts                          ← lazy init mirroring lib/sentry.ts
├── components/providers.tsx              ← deferWork(() => initMushi())
├── contexts/auth-context.tsx             ← setMushiUser(dbUserId) on resolve
├── components/feedback-sheet.tsx         ← MUSHI_CATEGORY_MAP — bug-shaped mirror
├── features/exercises/components/
│   └── exercise-results.tsx              ← showMushiReport on accuracy ≤ 50%
├── .env.local                            ← NEXT_PUBLIC_MUSHI_{PROJECT_ID,API_KEY,API_ENDPOINT,ENABLED}
└── README.md                             ← user-facing docs in Observability section
```

**Auth header:** `X-Mushi-Api-Key: mushi_<...>` (not `Authorization: Bearer`). Worth a docs note since multiple Edge Function patterns exist in the codebase.

**Required submission fields** that aren't obvious from the SDK shape: `environment` (full object), `reporterToken` (any string), `createdAt` (ISO). The SDK fills these — but custom integrations need them.

**Closed Shadow DOM** (`mode: 'closed'`) means E2E tests can't poke into the widget UI — testers should call `window.__mushi__.report({...})` instead. Consider exposing a `__MUSHI_DEV__` global behind a config flag.

---

## What Worked Beautifully

- **Lazy load via `deferWork`** dropped cleanly into glot.it's existing pattern (same shape as Sentry, Web Vitals).
- **Sentry bridge** (`replay: 'sentry'`) — no double rrweb shipping. Mushi reports correlate to Sentry replays out of the box.
- **PII scrubber + offline queue** — both worked without configuration.
- **Admin console** — clean dark-mode layout, drill-down detail view shows USER REPORT vs LLM CLASSIFICATION side-by-side, environment + triage thread + dispatch-fix CTA all in one screen.
- **Per-stage telemetry** — `llm_invocations` table captured every model call with `latency_ms`, `input_tokens`, `output_tokens`, `key_source` (env/byok). Made debugging the P0 trivial.

## What Needs Work

- **Schema/code drift detection** (the P0 above).
- **Owner-less projects.** When a project is provisioned via raw SQL (no JWT auth), `owner_id` is `NULL` and the admin console silently hides it. Either require `owner_id` (NOT NULL), or surface a "no-owner" warning row in the admin Projects page.
- **`Authorization: Bearer` header rejected with `MISSING_API_KEY`** — confusing because that's the OAuth/JWT pattern most SDKs default to. Either accept both headers, or return a clearer error like `USE_X_MUSHI_API_KEY_HEADER`.

---

## Validation matrix

| Capability surface | Status | Evidence |
|---|---|---|
| **SDK + classify + admin triage** | ✅ | 8 reports submitted, 4 classified end-to-end with severity + summary + component, all visible in admin console |
| **Full PDCA loop** | 🟡 | `Dispatch fix` button visible in report detail, but agentic fix not exercised in this round |
| **Cloud sign-up + Stripe billing + plugin marketplace** | 🟡 | Marketplace + Storage + SSO + Compliance pages render in admin nav, but billing flow not exercised |

PDCA + billing exercise → next round.

---

## Reporter pipeline remediation (Jun 2026)

Follow-up to the RT-TEST E2E audit. Fixes shipped in `mushi-mushi` + `glot.it` to close SDK → console → MCP → My Reports propagation gaps.

### glot.it project

| Field | Value |
|-------|-------|
| Project ID | `542b34e0-019e-41fe-b900-7b637717bb86` |
| Host | `kensaur.us/glot-it` (local: `:3847`) |
| Widget trigger | `banner` (not FAB) |

### Multi-project MCP (kensaurus@gmail.com)

If Cursor MCP is pinned to a **different** project than the host app SDK, `get_recent_reports` returns empty while ingest still works.

**Fix (pick one):**

1. Admin console → select glot.it project → **Connect** → **Add to Cursor** (mints a key scoped to `542b34e0-…`).
2. CLI: `mushi setup --all-projects --ide cursor` after `mushi login` — writes one MCP entry per linked project. Restart Cursor MCP.

The MCP server now returns `PROJECT_SCOPE_MISMATCH` when a tool passes a `projectId` that differs from the entry's `MUSHI_PROJECT_ID` (instead of silent empty results).

### SDK changes (`@mushi-mushi/core` + `@mushi-mushi/web`)

- **Project-scoped reporter token:** `localStorage` key `mushi:reporter-token:${projectId}`; legacy `mushi_reporter_token` migrates on first use.
- **Rewards + `identifyWithToken`:** glot.it identity JWT path now initializes rewards with the same reporter token.
- **Notification polling:** 60s + `visibilitychange`, gated by `reporterNotificationsEnabled` from `GET /v1/sdk/config`.

### Backend changes (edge functions)

Shared [`report-status-notify.ts`](../packages/server/supabase/functions/_shared/report-status-notify.ts):

| Transition | Reporter notification |
|------------|---------------------|
| → `fixing` | `confirmed` (+50 pts) |
| → `fixed` | `fixed` (+25 pts) |
| → `verified` / `reopened` / `dismissed` | matching type |

Wired into admin PATCH, `fix-worker` (after PR opened), and `finalizeFixMerge`. All paths respect `project_settings.reporter_notifications_enabled`.

### Proper fix closure (do **not** use SQL shortcuts)

**Forbidden:** `UPDATE reports SET status = 'fixed'` in SQL for audit closure.

**Canonical path:**

```
fix-worker opens draft PR → status fixing → reporter confirmed notification
→ console Merge / mushi fixes merge → finalizeFixMerge → fixed notification
→ My Reports shows Fixed — confirm?
```

### E2E harness

- `examples/e2e-dogfood/tests/sdk-widget-features.spec.ts` — `MUSHI_WIDGET_TRIGGER=banner|fab`
- `examples/e2e-dogfood/tests/reporter-inbox.spec.ts` — token scoping + My Reports list

