---
"@mushi-mushi/node": minor
"@mushi-mushi/mcp": minor
"@mushi-mushi/cli": patch
"@mushi-mushi/eslint-plugin-mushi-mushi": patch
---

Phase 3 / Phase 5 non-deploy completion (production-readiness uplift, Jul 2026):

**`@mushi-mushi/node` — test uplift (Phase 3 DX/TEST)**
- `unhandled.test.ts` (7 tests) — verifies `attachUnhandledHook` fires `captureReport` on `unhandledRejection` and `uncaughtException`, coerces non-Error reasons, respects `swallowCrashes`, uses custom `component` label, and teardown removes both process listeners.
- `otel.test.ts` (14 tests) — verifies `createOtelSpanProcessor` active path: ERROR span → `captureException`, traceparent inclusion, span-name fallback, non-error skip when `errorsOnly=true`, OTLP fetch POST shape, OTLP env-var headers, OTLP object-headers, shutdown/forceFlush no-throw.

**`@mushi-mushi/mcp` — `use_mushi` meta-tool + X-RateLimit headers (Phase 5)**
- `use_mushi` tool registered in `server.ts` and `catalog.ts`: intent-aware orientation tool returning a curated subset of 6–12 relevant tool names for the caller's stated intent, a project-aware orientation paragraph, and a recommended first tool. Mirrors Sentry's `use_sentry` context-cost-reduction pattern.
- `USE_MUSHI_INTENTS` map in `catalog.ts`: 6 intent clusters (fix, status, setup, qa, pipeline, audit) each with curated tool lists and hint text.
- `buildRateLimitHeaders()` in `_shared/mcp-rate-limit.ts`: produces `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Policy`, and `Retry-After` (on 429) headers conforming to IETF draft-ietf-httpapi-ratelimit-headers-06 (same format as GitHub, Linear, Stripe). Published limits: 120/min tools-call, 60/hr nl_query.

**`@mushi-mushi/cli` — Phase 4 `printResult()` migration**
- `diagnostics.ts` `test` command: migrated from `if (opts.json)` to `printResult()` — respects both per-command `--json` (alias) and global `-o json`.
- `diagnostics.ts` `index` command: migrated to `outputIsJson()` for parity.

**`@mushi-mushi/eslint-plugin-mushi-mushi` — typecheck fix**
- `no-allowlist-jsx-textnode.ts`: annotated `create()` return as `Rule.RuleListener` so TypeScript's index-signature check accepts the JSX visitor overloads. No behaviour change.

**Supabase edge functions (code-only, no deploy yet)**
- `_shared/validate.ts` (new): Zod 4 backed `parseBody<T>()` / `parseQuery<T>()` helpers + per-function schemas for the 5 highest-exposure functions (`ApiReportBodySchema`, `ClassifyReportBodySchema`, `FastFilterBodySchema`, `QaStoryRunnerBodySchema`, `InventoryProposeBodySchema`). Returns structured `ValidationErrorBody` on HTTP 400; never throws. Deploy via Supabase MCP is the next step.
