# PDCA Full Sweep — Wave T audit SUMMARY (2026-04-23)

Baseline: Wave R `docs/audit-2026-04-21/` + in-flight Wave S `.changeset/2026-04-23-pdca-hardening-wave-s.md`.

## Big picture

**The PDCA pipeline is healthy.** A synthetic report submitted during this run went from SDK POST → classified report → dispatched fix → merged PR candidate in **~18 seconds** end-to-end, producing https://github.com/kensaurus/glot.it/pull/12 with the agent correctly self-flagging it as `needsHumanReview` (because the synthetic payload didn't reference real code). 87 % of production reports are `classified`, 83 % have a judge score, 14 % reached a PR. Database is RLS-clean across all 62 public tables, zero unindexed FKs.

**Where we're bleeding**: a small number of high-leverage bugs.

## P0 / P1 / P2 table

| # | Sev | Area | Finding | Fix location | Detail |
|---|---|---|---|---|---|
| T1 | **P0** | Ops | 6 cron jobs silently failing because `current_setting('app.settings.service_role_key')` is NULL on hosted Supabase. Blast radius: `sentry-seer-poll-15m`, `judge-batch-nightly`, `intelligence-report-weekly`, `library-modernizer-weekly`, `prompt-auto-tune-weekly`, `soc2-evidence`. | New migration `20260423040000_wave_t_runtime_config_and_rls_initplan.sql` | [audit-db-schema.md §P0](./audit-db-schema.md) |
| T2 | **P1** | Security | Unauthenticated admin API returns 500 `{"error":"internal"}` instead of 401. Silently eating Sentry capture. | Patch `jwtAuth` in `packages/server/supabase/functions/_shared/auth.ts` | [audit-security.md §S1](./audit-security.md) |
| T3 | **P1** | Security | `recover_stranded_pipeline()` calls `fast-filter` with no Authorization — latent 401 storm when the pipeline needs recovery. | Same migration as T1, change `net.http_post` body | [audit-security.md §S2](./audit-security.md) |
| T4 | P1 | Perf | Admin SPA ships all 24 pages in the main bundle, no `manualChunks`. Wave R carry-over. | `apps/admin/vite.config.ts` + `React.lazy` on 5 pages | [audit-performance.md](./audit-performance.md) |
| T5 | P1 | LLM | Prompt cache telemetry never records `cache_read_input_tokens > 0` (0/17 calls last 24 h). Either claim is wrong or we're silently paying 10× for every LLM call. | `_shared/telemetry.ts` + `_shared/prompt-ab.ts` | [audit-performance.md §LLM](./audit-performance.md) |
| T6 | P1 | UX | 14 Advanced pages render data + graphs but ship no primary CTA. User doesn't know what to do with the information. | `PageHero` rollout + `nextBestAction` registry | Phase 3a |
| T7 | P1 | UX | Action state is spread across 24 pages — no single "what do I do right now" inbox. | New `/inbox` page + keyboard shortcut + `GET /v1/admin/inbox` edge route | Phase 3b |
| T8 | P2 | Security | Supabase Auth: leaked-password protection off, only 1 MFA method. | Dashboard toggle | [audit-security.md §S5, S6](./audit-security.md) |
| T9 | P2 | DB | 64 `multiple_permissive_policies` warnings. Cleanup backlog. | Follow-up migration | [audit-db-schema.md §Perf](./audit-db-schema.md) |
| T10 | P2 | DB | `fix_events.fix_events_owner_select` re-evaluates `auth.uid()` per row. | Included in T1 migration | [audit-db-schema.md](./audit-db-schema.md) |
| T11 | P2 | DevEx | Root `.env` carries live Stripe, AWS, NPM, GitHub, Anthropic keys. Gitignored — zero git history leak — but local-machine compromise would burn the keys. | Rotate to `sk_test_*` for Stripe locally; move live values to 1Password + Supabase project secrets only. | [audit-security.md §S4](./audit-security.md) |
| T12 | P2 | Sentry | Zero error events / transactions recorded in last 30 d across both `mushi-mushi-server` and `mushi-mushi-admin`. DSN likely not deployed to function runtime. | `supabase secrets set SENTRY_DSN_SERVER=...` + verification step | [audit-security.md §S8](./audit-security.md) |
| T13 | P3 | DB | `pg_net` installed in `public` schema — advisor warning. | Separate migration (needs cross-schema `net.http_post` calls updated) | [audit-db-schema.md §Sec](./audit-db-schema.md) |
| T14 | P3 | Prompt | `generate-synthetic` hardcodes its prompt, not in `prompt_versions`. | Phase 4 | [audit-db-schema.md §Wave R carry-over](./audit-db-schema.md) |

## Wave R / Wave S carry-over status

- Wave R: 4 items → 3 closed (unauth edge paths, unindexed FKs, `recover_stranded_pipeline` hotness). 1 open (synthetic prompt hardcoded → Phase 4).
- Wave S (in-flight `.changeset/2026-04-23-pdca-hardening-wave-s.md`): untouched this audit; will land in tandem via changesets during Phase 6.

## Phase 2 deliverable list

Phase 2 implements fixes for T1, T2, T3, T4, T5 (telemetry side only), T10.

1. `packages/server/supabase/migrations/20260423040000_wave_t_runtime_config_and_rls_initplan.sql` (T1, T3, T10)
2. `packages/server/supabase/functions/_shared/auth.ts` — `jwtAuth` try/catch (T2)
3. `apps/admin/vite.config.ts` — `manualChunks` + `apps/admin/src/App.tsx` route lazy-loading (T4)
4. `packages/server/supabase/functions/_shared/telemetry.ts` — cache-token key rename (T5)

Phase 3 handles T6 / T7. Phase 4 handles T14.

## How this audit was produced

- Submitted a real synthetic report against hosted API, verified each pipeline stage via Supabase MCP `execute_sql`.
- `get_advisors(security|performance)` on project `dxptnwrhwsqckaftyymj`.
- Sentry MCP `search_issues` / `find_organizations` — 0 issues found (itself a finding).
- Edge-function logs via Supabase MCP `get_logs`.
- Source grep over `packages/server/supabase/functions/_shared/`.
- `git check-ignore` for secret hygiene.

Detailed per-skill docs:

- [live-pdca-run.md](./live-pdca-run.md) — per-stage verdict + timing
- [audit-db-schema.md](./audit-db-schema.md) — schema, RLS, indexes, advisors, migrations
- [audit-security.md](./audit-security.md) — auth, secrets, HMAC, CORS, Sentry capture
- [audit-performance.md](./audit-performance.md) — SPA bundle, edge latency, LLM cost, cache
