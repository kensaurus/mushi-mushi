# Mushi-Mushi — Five-Audit Deep Sweep Summary — 2026-04-21

**Sub-reports:**
- [`audit-fe-api-2026-04-21.md`](./audit-fe-api-2026-04-21.md)
- [`audit-db-schema-2026-04-21.md`](./audit-db-schema-2026-04-21.md)
- [`audit-security-2026-04-21.md`](./audit-security-2026-04-21.md)
- [`audit-performance-2026-04-21.md`](./audit-performance-2026-04-21.md)
- [`audit-langfuse-llm-2026-04-21.md`](./audit-langfuse-llm-2026-04-21.md)

**Method:** Live MCP probes (Supabase, Sentry), full-repo static analysis, OWASP Top-10 + LLM Top-10 cross-check, Web Vitals from production Sentry, whitepaper-claim verification, Firecrawl/Context7 research against current 2026 best practices.

**Headline:**
- ✅ The architecture is **sound**. Air-gap defence, two-stage LLM pipeline, JWT/RLS coverage, Web Vitals all in **Good** territory, dedup cache implemented correctly, signature verification on all webhooks done right.
- 🔴 **Two P0 risks**: three Edge Functions are publicly invokable with no auth (cost-amplification DoS), and the primary judge model is failing 100% of the time silently (the PDCA "self-improvement" loop is operating on the secondary signal).
- 🟠 Per-report LLM cost is **~10× the whitepaper claim** (measured \$0.022 vs claimed \$0.002) — almost certainly Anthropic prompt caching not engaged.

---

## P0 — Fix today

| # | ID | Area | Finding |
|--|----|------|---------|
| 1 | **SEC-1** | Security | `fast-filter`, `classify-report`, `fix-worker` are all `verify_jwt = false` AND have **no internal auth check**. Anyone with the URL can trigger LLM calls and PR creation, billed to the project. ~10 lines per function to fix. |
| 2 | **LLM-1** | LLM | `judge_fallback_used = true` on **42/42 evaluations** — primary Sonnet judge errors out every call. The loop is silently running on the OpenAI fallback. |
| 3 | **LLM-2** | LLM | Judge disagrees with Stage 2 on **62%** of classifications (26/42). Cannot be trusted as a quality signal until LLM-1 is fixed. |

## P1 — Fix this week

| # | ID | Area | Finding |
|--|----|------|---------|
| 4 | **FE-API-1** | FE | **Zero** Zod schemas on FE responses. Every backend rename silently corrupts a page. |
| 5 | **DB-1** | DB | 20 unindexed foreign keys → JOIN/cascade slowness at scale. |
| 6 | **DB-2** | DB | 64 multiple-permissive-policies lints → every read evaluates several policies. Fix `byok_audit_log`, `usage_events`, `processing_queue` first. |
| 7 | **SEC-3** | Security | Server PII scrubber misses IP addresses (and there's no IP regex at all). GDPR exposure. |
| 8 | **SEC-4** | Security | Server PII scrubber has no secret-token regex (no `Bearer`, `AKIA…`, `ghp_…`, `xoxb-…`). Console-logged tokens get persisted to DB and shipped to LLM providers. |
| 9 | **SEC-2** | Security | `.env` with live Stripe/AWS/Anthropic/GH/NPM/Sentry/Langfuse keys lives at repo root. Gitignored, but no pre-commit guard. |
| 10 | **LLM-3** | LLM | Per-report cost \$0.022 vs whitepaper \$0.002. Verify Anthropic prompt caching is engaged; capture `cache_*_input_tokens` to `llm_invocations`. |
| 11 | **LLM-4** | LLM | Langfuse trace coverage 65% (54/84). Make `langfuse_trace_id` required at insert; wire `digest` stage to traces (currently 0/2). |
| 12 | **LLM-5** | LLM | `prompt_versions.avg_judge_score` and `total_evaluations` are NULL for every row despite 42 scored evaluations. PDCA loop has no data to optimize against. |
| 13 | **PERF-1** | Perf | `recover_stranded_pipeline()` ran 785× / 21.5s total CPU; needs early-exit guard and `(status, created_at)` index. |
| 14 | **PERF-2** | Perf | `/prompt-lab` p75 LCP 2076 ms — close to "Needs Improvement". |
| 15 | **PERF-3** | Perf | No `manualChunks`, no route-level `React.lazy()`. |

## P2 — Fix this month

| # | ID | Area | Finding |
|--|----|------|---------|
| 16 | FE-API-2 | FE | `apiFetchRaw` has no Sentry observability. |
| 17 | FE-API-3 | FE | Dedup cache key ignores headers — undocumented constraint. |
| 18 | FE-API-4 | FE | 5xx Sentry captures lack `fingerprint` → noisy issues. |
| 19 | FE-API-5 | FE | 4xx never captured → silent validation/auth bugs. |
| 20 | DB-3 | DB | 62 unused indexes; sweep after 30 d zero `idx_scan`. |
| 21 | DB-4 | DB | `pg_net` lives in `public` schema. |
| 22 | DB-5 | DB | Auth: leaked-password protection off; only one MFA factor. |
| 23 | SEC-5 | Security | `cors origin: '*'` blanket on all routes; split admin vs SDK. |
| 24 | SEC-6 | Security | API keys have no prefix display; ops can't safely rotate. |
| 25 | SEC-7 | Security | `airGap !== true` should be a 400, not a warning. |
| 26 | PERF-4 | Perf | INP not tracked in Sentry. |
| 27 | PERF-5 | Perf | `/settings` CLS 0.076 — reserve panel heights. |
| 28 | PERF-6 | Perf | Pre-emptive `(project_id, created_at DESC)` index on `processing_queue`. |
| 29 | LLM-6 | LLM | A/B traffic ramping is dormant (0% to candidates). |
| 30 | LLM-7 | LLM | Custom Langfuse SDK fails silently — capture failures to Sentry. |

---

## Top 5 quick wins (ordered by ROI)

| # | Task | Effort | Value |
|--|------|:------:|-------|
| 1 | Add `requireServiceRoleAuth` to `fast-filter`, `classify-report`, `fix-worker` (SEC-1) | 30 min | Removes unbounded cost surface |
| 2 | Aggregate `classification_evaluations → prompt_versions` (LLM-5) | 30 min | Activates the entire PDCA self-improvement loop |
| 3 | Diagnose & fix primary judge (LLM-1) | 1–2 hours | Restores quality signal |
| 4 | Add manualChunks + lazy() routes to Vite (PERF-3) | 1 hour | 30% smaller main chunk |
| 5 | One migration adding 20 missing FK indexes via `CREATE INDEX CONCURRENTLY` (DB-1) | 1 hour | Linear-scale safeguard |

## Top 5 architectural debts

1. **Hand-rolled Langfuse SDK** with silent failures and no retries. Could be replaced with the official `langfuse-deno` SDK once it stabilizes, or bound to a small reliability layer (retry + Sentry breadcrumb).
2. **Knowledge graph backed by plain tables** rather than Apache AGE. Fine for now (27 nodes), but the Critical Analysis flag stands at >100k nodes.
3. **No FE-side Zod runtime validation.** The whole FE → BE contract is unverified at runtime.
4. **PDCA loop wired but dormant.** A/B candidate prompts at 0% traffic; aggregation never runs; primary judge broken. The flagship feature is, today, a stub. Whitepaper claims need to be tempered until this is operational.
5. **Cron + Edge Function security model is asymmetric.** Six functions correctly check service-role; three don't. The pattern needs to be a shared `_shared/auth.ts` middleware (`requireServiceRoleAuth(req)`) and a lint that fails CI when an Edge Function does `Deno.serve` without going through it.

## Whitepaper claim scorecard

| Claim | Status | Evidence |
|-------|:------:|----------|
| Sentry-native companion (not replacement) | ✅ | `mushi-mushi-server` + `mushi-mushi-admin` projects, Seer enrichment loop active |
| Two-stage Haiku → Sonnet LLM pipeline | ✅ | live model breakdown |
| Air-gap prompt-injection defence (LLM01) | ✅ | implemented and documented in source |
| Anthropic prompt caching engaged | ❌ | cost 10× claim |
| Per-report cost ~\$0.002 | ❌ | measured \$0.022 |
| LLM-as-Judge with auto-tune | ⚠ scaffolding only | judge broken (LLM-1), agg never runs (LLM-5), no candidate traffic (LLM-6) |
| Apache AGE knowledge graph | ❌ | extension not installed; using plain Postgres tables |
| RLS on all tables | ✅ | 60/60 |
| Stripe + GitHub + Sentry webhook signing | ✅ | constant-time HMAC, raw-body, timestamp tolerance |
| MCP Tasks SEP-1686 | not verified | (out of scope today) |
| OWASP LLM01 defence | ✅ | air-gap + structured outputs |
| Multimodal vision | ✅ wired | not measured at runtime |
| pg_cron scheduled jobs | ✅ | 15 active |
| pgvector for embeddings | ✅ | extension installed |
| Web Vitals: Good | ✅ | p75 LCP < 2.1s, CLS < 0.08 across the board |

---

## What we did NOT cover (acknowledged gaps)

- **No live Playwright trigger** of the LLM pipeline (local admin server was unstable). Mitigated by reading 84 existing invocations from prod DB.
- **No `pnpm audit`** run (no network/install in this audit). Recommendation is to wire it into CI as a release gate.
- **No load test.** Findings here are about *shape* not measured throughput. The DB is at dev-pilot scale (max 807 rows in any table) — re-run this audit at 100k+ rows in any of the busy tables.
- **MCP Tasks SEP-1686 conformance** not verified.
- **Multi-tenant data isolation** spot-checked via RLS but not stress-tested with a hostile-tenant scenario.

---

## Recommended action order (1–2 sprint plan)

**Sprint A (3 days):**
- Day 1: SEC-1 (P0, all three functions), LLM-1 (P0, debug primary judge)
- Day 2: LLM-5 (aggregation), LLM-2 (manual disagreement audit), DB-1 migration
- Day 3: SEC-3 + SEC-4 (PII scrubber expansion), SEC-2 pre-commit hook

**Sprint B (5 days):**
- LLM-3 (prompt caching) + LLM-4 (trace coverage)
- FE-API-1 (Zod top-10 endpoints)
- PERF-1 (cron guard + index), PERF-3 (Vite manualChunks + lazy)
- DB-2 (consolidate RLS policies on hot tables)
- All P2 Sentry hygiene (FE-API-4/5, PERF-4)

**Outcome of executing the above:** the whitepaper's headline claims (cost, PDCA loop, prompt-injection defence) become *true* end-to-end, the unbounded-cost surface is closed, and the FE-BE contract becomes runtime-verified.
