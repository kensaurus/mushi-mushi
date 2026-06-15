# Mushi Mushi — Re-baselined Audit Findings (2026-06-15)

**Scope:** Admin console, SDK, CLI, MCP, Edge Functions, Postgres  
**Method:** Live codebase review vs April 2026 audits + plan gap analysis  
**Project:** `dxptnwrhwsqckaftyymj` (Supabase Postgres)

---

## Findings table (sorted by severity)

| Severity | Area | Finding | File | Fix | Effort |
|----------|------|---------|------|-----|--------|
| P0 | Security | April SEC-1 **FIXED** — `fast-filter`, `classify-report`, `fix-worker` all call `requireServiceRoleAuth` | `packages/server/supabase/functions/*/index.ts` | None — verified | — |
| P0 | Security | April SEC-7 **FIXED** — `airGap !== true` returns 400 in Stage 2 | `classify-report/index.ts:165` | None — verified | — |
| P0 | Security | April SEC-3/4 **FIXED** — server PII scrubber covers IPs + secret tokens | `_shared/pii-scrubber.ts` | None — verified | — |
| P0 | Security | Prompt-injection screening **SHIPPED** — `sanitizeForLLM` + CI corpus | `_shared/sanitize.ts` | None — verified | — |
| P0 | FE-API | Zero runtime Zod validation of `apiFetch<T>` responses (FE-API-1 still open) | `apps/admin/src/lib/api.ts` | Add Zod fail-soft on `/setup`, `/dashboard`, `/projects` | M |
| P0 | Onboarding | Wizard test report silently skips when `--endpoint` unset | `packages/cli/src/init.ts:433` | Auto-fill `DEFAULT_API_ENDPOINT` | S |
| P0 | Onboarding | `mushi doctor` hides ingest/dispatch checks behind `--server`/`--ingest` | `packages/cli/src/doctor.ts` | Run ingest+server by default | S |
| P1 | Onboarding | No client-side screenshot/payload size cap before POST | `packages/web/src/mushi.ts`, `packages/core/src/api-client.ts` | Downscale + reject oversized payloads | M |
| P1 | Onboarding | API key only visible at mint time; no prefix on revisit | `SdkInstallCard.tsx` | Persist 12-char prefix + rotate affordance | M |
| P1 | Onboarding | Three parallel install surfaces (Onboarding/Copilot/MCP) | `OnboardingPage.tsx`, `SetupCopilotPage.tsx`, `McpPage.tsx` | Canonical path + links | S |
| P1 | Onboarding | Capacitor `configure()` vs web `init()` snippet mismatch | `lib/sdkSnippets.ts`, `packages/capacitor` | Alias + aligned snippets | S |
| P1 | Onboarding | No MCP `diagnose_connection` credential self-test | `packages/mcp/src/catalog.ts` | Add tool | M |
| P1 | Product | Session replay type stub only; no native rrweb buffer | `packages/core/src/types.ts:253` | Implement `capture/replay.ts` | L |
| P1 | Product | Screenshot annotation missing in widget | `packages/web/src/widget.ts` | Canvas overlay tools | M |
| P1 | Product | Public roadmap page missing (backend ready) | `apps/testers` | Add `/roadmap` page | M |
| P1 | Product | Push notification channel is stub | `_shared/notifications.ts` | Wire web-push ledger path | M |
| P1 | Auto-fix | No per-dispatch `max_spend_usd` or daily quota | `fix-worker/index.ts` | Migration + enforcement | M |
| P1 | Auto-fix | No operator agent-run trace UI | `apps/admin` Fixes/report-detail | Trace panel from `llm_invocations` | M |
| P2 | Security | CORS `origin: '*'` on admin routes (SEC-5) | `api/index.ts` | Split CORS per route group | M |
| P2 | Security | API key prefix not displayed in admin (SEC-6) | `project_api_keys` | Prefix column + UI | S |
| P2 | DB | 20 unindexed FKs (DB-1) — verify via advisors | migrations | `CREATE INDEX CONCURRENTLY` batch | M |
| P2 | DB | 64 multiple-permissive policies (DB-2) | `byok_audit_log`, `usage_events` | Consolidate policies | L |
| P2 | Perf | April PERF-3 partially addressed — `manualChunks` exists | `apps/admin/vite.config.ts:164` | Verify route lazy still complete | S |
| P2 | Perf | Sentry INP tracking may still be null (PERF-4) | `apps/admin` Sentry init | Enable `enableInp: true` | S |
| ✅ | Product | Reporter status surface **SHIPPED** | `widget.ts`, `public.ts:1135` | Extend, don't rebuild | — |
| ✅ | Product | Closed-loop notifications **SHIPPED** | `_shared/notifications.ts` | Extend push channel | — |
| ✅ | Product | Resolution survey **SHIPPED** | `reporter_verify_reopen.sql`, widget chips | — | — |
| ✅ | Product | Feature voting + changelog **SHIPPED** | `feature-board.ts`, `release-builder` | Add public page only | — |

---

## April audit closure summary

| April ID | Status |
|----------|--------|
| SEC-1 (unauthenticated internal fns) | **CLOSED** |
| SEC-3/4 (server PII gaps) | **CLOSED** |
| SEC-7 (airGap advisory only) | **CLOSED** |
| FE-API-1 (no Zod validation) | **OPEN** |
| PERF-3 (no code splitting) | **PARTIAL** |
| DB-1/2/3 | **OPEN** (re-verify on deploy) |

---

## Implementation priority (this plan)

1. Phase 1 — Onboarding friction (P0 items in table above)
2. Phase 2 — Session replay + annotation
3. Phase 3 — Public roadmap + push delivery
4. Phase 4 — Auto-fix budget caps + trace view
