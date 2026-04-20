# Handover — Wave J, 2026-04-20

> Picking this up? Read this top to bottom (≈6 min) before touching code. Wave J closes the largest gap left by Wave I (real LLM cost tracking), surfaces it across Health / Billing / Prompt Lab, and patches two production crashes that Sentry caught during Wave I rollout. Pair this with [`HANDOVER-wave-i-2026-04-20.md`](HANDOVER-wave-i-2026-04-20.md) — that doc is still the source of truth for everything that landed before today.

---

## TL;DR

- **`llm_invocations.cost_usd` is now a real column.** Migration `20260420000200_llm_cost_usd.sql` adds it, indexes it (partial, `WHERE cost_usd IS NOT NULL`), and backfills every historical row with the same pricing table the TS code uses. Six decimals so a `$0.000123` Haiku ping is preserved exactly.
- **Single source of truth for pricing.** All cost math now flows through `packages/server/supabase/functions/_shared/pricing.ts` — `logLlmInvocation` writes the cost at insert time, the migration's backfill mirrors the same numbers, Health falls back to the helper for pre-column rows. Update both `pricing.ts` and the migration's CTE when adding a model.
- **Real cost rolled into 3 surfaces.** Health per-function reads `cost_usd` directly (Wave I's on-the-fly estimator is now a fallback), Billing has a per-project `LLM $X.XX` chip showing actual COGS this billing month, Prompt Lab's diff modal shows `Avg $ / eval` next to `Avg judge score` so ops can see "did the candidate get more accurate AND cheaper?" without leaving the diff.
- **2 production Sentry issues closed.** `MUSHI-MUSHI-ADMIN-4` (`TypeError: cost.toFixed` on `/health`) was a Wave I deploy-skew bug — fixed by making the new fields optional + defensive renders; resolved-in-next-release. `MUSHI-MUSHI-ADMIN-3` (`SectionHeader is not defined`) was a React Fast Refresh artifact — patched at the SDK boundary in `lib/sentry.ts` so HMR noise never costs an issue slot again.
- **Build + lint + smoke green.** `apps/admin` typecheck and ESLint both clean; Playwright smoke of `/`, `/billing`, `/prompt-lab`, `/health`, `/reports` against `localhost:6464` shows zero console errors after the toFixed fix.

---

## Phase-by-phase, what changed where

### Phase 1 — Cost truth backend

| Concern | Where | What changed |
|---|---|---|
| Schema | `packages/server/supabase/migrations/20260420000200_llm_cost_usd.sql` | `ALTER TABLE llm_invocations ADD COLUMN cost_usd numeric(12, 6)`. Comment captures the precision rationale. |
| Index | Same migration | Partial covering index `idx_llm_inv_project_cost (project_id, created_at desc) WHERE cost_usd IS NOT NULL` so the new Billing per-project monthly $ rollup is index-only. |
| Backfill | Same migration | Two-pass `UPDATE`: first joins `llm_invocations` to a CTE-defined pricing table (vendor-prefix stripped via `substring(used_model FROM '[^/]+$')`), then a second pass falls back to Sonnet pricing for unrecognised model names. Mirrors `LLM_PRICING_FALLBACK` in `pricing.ts` exactly. |
| Pricing source of truth | New `packages/server/supabase/functions/_shared/pricing.ts` | Exports `LLM_PRICING_PER_M_TOKENS`, `LLM_PRICING_FALLBACK`, and `estimateCallCostUsd(model, in, out)`. The header comment warns to mirror the SQL backfill when adding models. |
| Telemetry write | `packages/server/supabase/functions/_shared/telemetry.ts` | `logLlmInvocation` now calls `estimateCallCostUsd` and inserts `cost_usd` alongside the existing token / latency fields. Defensive: 0 input + 0 output → `cost_usd: 0` (still write the row for latency tracking). |
| Health rollup | `/v1/admin/health/llm` in `api/index.ts` | Per-function `costUsd` aggregate now prefers `r.cost_usd` (the new column) and only falls back to `estimateCallCostUsd` when the column is null (pre-backfill safety net). |

### Phase 2 — Cost rollups

| Surface | Endpoint | What it returns |
|---|---|---|
| Billing COGS | `/v1/admin/billing` | New `llm_cost_usd_this_month` per project (sum of `cost_usd` for the project this billing month, computed in parallel with the report-quota query so no extra round-trip latency). |
| Prompt cost | `/v1/admin/prompt-lab` | Per `PromptVersion`: new `cost_usd_total` (sum across invocations stamped with that prompt's version) + `avg_cost_usd` (null when no calls, else `total / calls`). |

Both rollups read the new `cost_usd` column directly — no Wave I-style on-the-fly estimation. Both filter by project to keep result sets bounded.

### Phase 3 — Frontend

| File | Change |
|---|---|
| `apps/admin/src/components/prompt-lab/types.ts` | `PromptVersion` gains `cost_usd_total: number` (always present, 0 when no calls) and `avg_cost_usd: number \| null` (null when no calls). |
| `apps/admin/src/components/prompt-lab/PromptDiffModal.tsx` | `PerfStrip` now renders three cells: `Evaluations`, `Avg judge score`, `Avg $ / eval`. New `formatCost` helper uses adaptive precision (`<$0.0001` / `$0.0004` / `$0.42`). New `numericDelta(parent, candidate, direction)` signature lets the cost cell invert tone (lower is better → green). |
| `apps/admin/src/pages/BillingPage.tsx` | `BillingProject` gains `llm_cost_usd_this_month?: number`. `UsageBar` renders an `LLM $X.XX` chip on the same line as `Fixes` and `Classifier tokens` when the field is present. New `formatLlmCost` mirrors the Prompt Lab formatter so the two pages render the same shape. Field is optional + renders only when non-null so a stale Edge Function deployment can't break the page. |
| `apps/admin/src/pages/HealthPage.tsx` | **(Verification fix)** `LlmHealth.byFunction[*]` fields `costUsd`, `p95LatencyMs`, `lastFailureAt` made optional. Renders use `?? 0` defaults. See "Verification surprises" below. |
| `apps/admin/src/lib/sentry.ts` | **(Verification fix)** `beforeSend` now drops events whose stack contains `@react-refresh` / `performReactRefresh` frames. Closes `MUSHI-MUSHI-ADMIN-3`. |

---

## Verification

- `pnpm --filter @mushi-mushi/admin typecheck` → green (`tsc --noEmit`)
- `pnpm --filter @mushi-mushi/admin lint` → green (`eslint src/`)
- `pnpm --filter @mushi-mushi/admin build` → green (1.77s, all routes chunked)
- Playwright smoke (`localhost:6464`, deployed Edge Function): `/`, `/billing`, `/prompt-lab`, `/reports`, `/health` all render with 0 console errors after the toFixed fix. Screenshots in `audit-after-wave-j/`.
- Sentry MCP scan (`sakuramoto/mushi-mushi-admin`, `sakuramoto/mushi-mushi-server`): both projects clean after resolving `MUSHI-MUSHI-ADMIN-3` + `4`.
- Note: `pnpm --filter @mushi-mushi/server test` still fails on a pre-existing Vitest issue with a `npm:` Deno-style import (87/88 pass) — unrelated to Wave J. Don't burn time chasing it without first checking whether the failing test is actually meaningful.

---

## Verification surprises (worth reading)

Two real bugs surfaced during Phase 4 that I fixed in-wave because they would have bitten the next person:

1. **`HealthPage.tsx:274` crashed with `TypeError: cost.toFixed`** the moment a deployed Edge Function lagged a Wave I FE. Wave I declared `costUsd: number` (required) but for any environment running the older Edge Function (i.e. the one that doesn't return per-function `costUsd`), the field is `undefined` and the `toFixed` call throws. Sentry caught this 10 times across 1 user (me, today, post-Wave-I deploy) — issue `MUSHI-MUSHI-ADMIN-4`. **Fix:** Made `costUsd`, `p95LatencyMs`, `lastFailureAt` optional in the type, and used `?? 0` defaults at every render site. **Lesson:** any new field added to a backend response should be optional in the FE type for at least one rollout cycle, with defensive renders. The Wave I PR shipped both ends in lockstep, but Vercel deployed the FE before Supabase Edge Functions caught up — exactly the deploy-skew window we now defend against.
2. **`MUSHI-MUSHI-ADMIN-3 (SectionHeader is not defined)`** was a React Fast Refresh re-registration artifact — function declarations DO hoist normally, but during HMR's `performReactRefresh` reentry the closure is briefly partially-registered and React calls the renderer with a stale binding. Pure dev-only; never reaches a user. **Fix:** Added a `beforeSend` filter in `lib/sentry.ts` that drops any event whose stacktrace touches `@react-refresh` / `performReactRefresh`. This is a documented class of HMR noise — fix once, never see again.

---

## Known gaps / what's next

1. **Materialised view for `report_groups` aggregates.** Still not warranted at current scale (per Citus benchmarks), but track p95 on `/v1/admin/reports` — climb above 250 ms is the trigger.
2. **Per-function p95 + cost backfill in deployed Edge Function.** The Wave I `/v1/admin/health/llm` per-function additions only return data once that Edge Function is deployed. Local dev still shows `p95 0ms · $0.0000` for each function until `supabase functions deploy api` runs. The frontend now defaults safely so this is cosmetic, but worth a follow-up deploy.
3. **Server-side PDF rendering for `/compliance`.** Still uses `@media print`; same v1-good-enough call as Wave I.
4. **Langfuse trace check.** Cost data now flows from `logLlmInvocation` → `llm_invocations.cost_usd`. Langfuse traces still carry the same `usage` payload; no Wave J change needed there, but worth a sanity check that costs reconcile within ±1% on a cross-check sample.
5. **Test failure noted above.** The Vitest `npm:` import issue in `packages/server` predates Wave J. If you decide to fix it, the workaround is usually to swap `npm:@supabase/supabase-js@2` for the resolved spec under a Vitest-only condition, or run those tests under Deno test instead.

---

## Where to look first if something breaks

- **Billing page shows weird $ amounts** → check `migrations/20260420000200_llm_cost_usd.sql` is applied. The backfill assumes the pricing CTE matches `pricing.ts` exactly — if you added a model to `pricing.ts` and not the migration, new writes use the live table but old rows used Sonnet fallback; you'll see a step-change at the migration date.
- **Prompt Lab cost cells all show `—`** → no `llm_invocations` rows match the prompt's `version` field. That field is set by the classify pipeline at call time; check whether the prompt has actually been promoted to production traffic (`/prompt-lab` → State column `Active`).
- **Health per-function `$0.0000`** → either pre-backfill `cost_usd IS NULL` rows (then the fallback estimator runs and writes a real number), or the Edge Function hasn't been redeployed since Wave I. Both heal automatically — the former on the first new write, the latter on the next `supabase functions deploy api`.
- **HMR errors leak back to Sentry** → verify the `beforeSend` filter in `lib/sentry.ts` still has the `@react-refresh` regex. If you upgrade Vite or React Refresh, double-check the new stack frame names match.
- **Adding a new LLM model** → update **both** `_shared/pricing.ts` AND the pricing CTE in `migrations/20260420000200_llm_cost_usd.sql` (or write a fresh migration if the schema is frozen). Drift means historical rows show different cost from new ones.
