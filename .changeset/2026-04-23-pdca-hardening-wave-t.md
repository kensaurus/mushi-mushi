---
"@mushi-mushi/admin": patch
"@mushi-mushi/server": patch
"@mushi-mushi/e2e-dogfood": patch
---

PDCA hardening (Wave T — 2026-04-23)

Follow-on to Wave S. Focus: live-pipeline verification, three formal audits
(performance / db-schema / security), and incremental UX scaffolding toward
the Advanced-mode Action Inbox.

- **Audits** — Added `docs/audit-2026-04-23/` with per-domain reports
  (`audit-performance.md`, `audit-db-schema.md`, `audit-security.md`,
  `live-pdca-run.md`, `user-story-run.md`) and a consolidated `SUMMARY.md`
  with P0/P1/P2 prioritisation. Also added `readiness.md` capturing the
  provider-probe matrix and new-wire-up recommendations (Loops.so,
  Sentry-Seer finish, Upstash, Vercel mirror, Datadog LLM Observability).
- **Auth hardening (P1)** — `jwtAuth` now explicitly catches throws from
  `db.auth.getUser`, so malformed / anonymous tokens get a clean 401
  instead of a 500 `{"error":"internal"}` via `sentryHonoErrorHandler`.
  Unmasks real server errors and cuts scanner-induced Sentry noise.
- **Chart-events authz hardening (review-found, P0)** —
  `/v1/admin/chart-events` previously used the service-role client with
  no owner-scope check, so any logged-in user could read deploy / cron /
  BYOK events from every project on the platform by spoofing or omitting
  `?project_id`. The handler now resolves the caller's owned project ids
  server-side, validates the optional `project_id` query param as a UUID
  (defusing PostgREST `.or()` filter-string injection), rejects unowned
  ids with 403, and only surfaces rows the caller actually owns plus the
  globally-scoped (`project_id IS NULL`) deploy / cron events. Marketing
  preview lands clean — no cross-tenant leak path on the new endpoint.
- **Cron runtime config (P0)** — New migration
  `20260423040000_wave_t_runtime_config_and_rls_initplan.sql` seeds
  `mushi_runtime_config.internal_caller_token`, adds
  `mushi_internal_auth_header()` /  `mushi_runtime_supabase_url()`
  helpers, rewrites 6 cron jobs (sentry-seer-poll, judge-batch,
  intelligence-report, library-modernizer, prompt-auto-tune,
  soc2-evidence) to read the URL + auth from the runtime table instead
  of the NULL `app.settings.*` GUCs that hosted Supabase can't set, and
  patches `recover_stranded_pipeline` to call `fast-filter` with a valid
  Authorization header.
- **Prompt-cache telemetry (P1)** — Added
  `extractAnthropicCacheUsage` helper in `_shared/telemetry.ts` and
  threaded `cache_creation_input_tokens` / `cache_read_input_tokens`
  through `fast-filter`. Pre-fix the Billing COGS rollup read cache-hit
  ratio as 0; post-fix, Anthropic prompt-caching savings finally show up
  where the spend shows up.
- **Synthetic prompts registry** — `generate-synthetic` now pulls its
  system prompt from `prompt_versions` (stage `synthetic`) so A/B
  iteration in Prompt Lab flows into synthetic generation too. Falls
  back to the previous literal when the registry is empty so there's no
  regression on brand-new projects.
- **Stage-2 v3 prompt candidate** — New migration
  `20260423050000_seed_stage2_v3_visual_layout.sql` seeds
  `stage2/v3-visual-layout` as a 50 %-traffic candidate with explicit
  severity triggers for visual / layout / auth-blocking bugs (directly
  motivated by the glot.it dogfood misclassifications). Auto-promotes
  via existing `promoteCandidate` once its `avg_judge_score` exceeds
  baseline by ≥ 0.05 over ≥ 20 evaluations.
- **Action Inbox (new)** — New `/inbox` page, sidebar-pinned above the
  PDCA sections, reachable via `⌘⇧I` / `Ctrl⇧I`. Renders one card per
  stage using `computeNextBestAction` with live counts from the
  existing `/v1/admin/dashboard` aggregate. `data-inbox-card` /
  `data-inbox-primary` test hooks support the new dead-button sweep.
- **PageHero test hooks** — Added `data-hero-primary`,
  `data-hero-secondary`, and `data-hero-verify` attributes so Playwright
  sweeps can assert every Advanced page has reachable CTAs without
  fragile text selectors. Retro-fitting `PageHero` onto the remaining 14
  pages is deferred to Wave U (see `docs/HANDOVER-2026-04-23-wave-t.md`).
- **TabbedSubNav primitive** — New
  `apps/admin/src/components/TabbedSubNav.tsx` + `VITE_ADVANCED_IA_V2`
  feature flag. Primitive only — the full 24→11 IA collapse is a Wave U
  task once the flag bakes in dogfood.
- **Playwright** — New `examples/e2e-dogfood/tests/dead-buttons.spec.ts`
  sweeping 16 Advanced routes for 404-landing CTAs, and
  `user-story-triage.spec.ts` simulating a real user's glot.it → admin
  PDCA walkthrough with `data-inbox-*` / `data-hero-*` assertions.
