---
"@mushi-mushi/node": minor
"@mushi-mushi/mcp": minor
"@mushi-mushi/cli": patch
"eslint-plugin-mushi-mushi": patch
---

Phase 3 / Phase 5 non-deploy completion (production-readiness uplift, Jul 2026):

**`@mushi-mushi/node` — test uplift (Phase 3 DX/TEST)**
- `unhandled.test.ts` (6 tests) — verifies `attachUnhandledHook` fires `captureReport` on `unhandledRejection` and `uncaughtException`, coerces non-Error reasons, respects `swallowCrashes`, uses custom `component` label, and teardown removes both process listeners.
- `otel.test.ts` (12 tests) — verifies `createOtelSpanProcessor` active path: ERROR span → `captureException`, traceparent inclusion, span-name fallback, non-error skip when `errorsOnly=true`, OTLP fetch POST shape, OTLP env-var headers, OTLP object-headers, shutdown/forceFlush no-throw.

**`@mushi-mushi/mcp` — `use_mushi` meta-tool + X-RateLimit headers (Phase 5)**
- `use_mushi` tool registered in `server.ts` and `catalog.ts`: intent-aware orientation tool returning a curated subset of 6–12 relevant tool names for the caller's stated intent, a project-aware orientation paragraph, and a recommended first tool. Mirrors Sentry's `use_sentry` context-cost-reduction pattern.
- `USE_MUSHI_INTENTS` map in `catalog.ts`: 6 intent clusters (fix, status, setup, qa, pipeline, audit) each with curated tool lists and hint text.
- `buildRateLimitHeaders()` in `_shared/mcp-rate-limit.ts`: produces `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Policy`, and `Retry-After` (on 429) headers conforming to IETF draft-ietf-httpapi-ratelimit-headers-06 (same format as GitHub, Linear, Stripe). Published limits: 120/min tools-call, 60/hr nl_query.

**`@mushi-mushi/cli` — Phase 4 `printResult()` migration**
- `diagnostics.ts` `test` command: migrated from `if (opts.json)` to `printResult()` — respects both per-command `--json` (alias) and global `-o json`.
- `diagnostics.ts` `index` command: migrated to `outputIsJson()` for parity.
- `reports.ts` (all 10 subcommands: list/thread/show/triage/resolve/reopen/verify/dismiss/reply/search) and `keys.ts` `list`: migrated to `printResult()`/`outputIsJson()` so global `-o json` works uniformly; per-command `--json` help text now reads "(alias for -o json)".

**`@mushi-mushi/eslint-plugin-mushi-mushi` — typecheck fix**
- `no-allowlist-jsx-textnode.ts`: annotated `create()` return as `Rule.RuleListener` so TypeScript's index-signature check accepts the JSX visitor overloads. No behaviour change.

**`@mushi-mushi/cli` — `mushi keys rotate` (Phase 2)**
- New `keys rotate` command: re-runs device auth inline, mints a fresh project API key for the same project, saves it to local config. Prints old/new key prefixes and a reminder to revoke the predecessor in the console (server-side revoke needs jwtAuth, CLI-token revoke endpoint is a tracked follow-up).

**Supabase migrations (deployed to production `dxptnwrhwsqckaftyymj`)**
- `20260720000001_add_rotated_from_to_project_api_keys.sql`: adds `rotated_from UUID REFERENCES project_api_keys(id)` + sparse index to support key rotation lineage. (`revoked_at` was already present from an earlier migration.)

**Supabase edge functions — `mcp/index.ts` (code-only, deploy via `supabase functions deploy mcp`)**
- `buildRateLimitHeaders()` now imported and wired into the POST `tools/call` response path: every tool-call response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Policy` headers (IETF draft-06 format). On rate-limit miss (`ERR_RATE_LIMITED = -32001`), also adds `Retry-After`.
- The `?features=` curated-tool filter (`parseFeaturesParam` / `toolMatchesFeatures`) was already wired in `feature-groups.ts` — no additional change needed.

**Supabase edge functions — `_shared/validate.ts` (code-only, deploy via function deploys)**
- Changed from `npm:zod@4` → `npm:zod@3` for consistency with `classify-report` / `fast-filter` (avoids dual-version bundle bloat).
- `ApiReportBodySchema`: `description` changed from required `.min(1)` to optional (backward-compat; legacy SDK < v1.21 doesn't always include it). Added `.passthrough()` so unknown keys (console_logs, breadcrumbs, screenshot_url, etc.) are preserved — prevents data loss when schema is used alongside `ingestReport`.
