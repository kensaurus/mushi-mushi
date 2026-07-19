# Plan — SDK / CLI / MCP production-readiness uplift (gap analysis + burndown)

Audit-and-plan output (Jul 2026). Full-surface audit of `@mushi-mushi/{core,web,node,react,…}`,
the `mushi` CLI, and the MCP server + Supabase backend, benchmarked against the mid-2026
production bar set by Sentry, Supabase, Langfuse, and Linear (fresh doc research).
Balanced phases: security + performance + features interleaved; every phase leaves the
repo releasable.

**Status refresh (Jul 19 2026):** Phase 1 hygiene items and several Phase 2/3/5 items
landed in-tree. Checkboxes below match the working tree — do not re-implement done work.
Remaining open items are still the real gaps.

## Verdict (current)

| Surface | Standing vs 2026 bar | Remaining gaps |
| --- | --- | --- |
| SDK | Strong core + `sampleRate` / `replaySampleRate` / `beforeSend` + `@mushi-mushi/web/otel` OTel bridge + `@mushi-mushi/web/headless` no-widget subpath (≤35 KB gzip) + node `unhandled.test.ts` + `otel.test.ts` fully tested | Web bundle still widget-dominated for default entry; `mushi.ts` → `MushiWidget` dynamic-import split tracked for follow-up PR |
| CLI | Modern (RFC 8628 device auth, scoped keys, mcp.json `${MUSHI_API_KEY}` default, Windows ACLs + perf-cached `whoami`/icacls, `--self` update, multi-profile, global `-o json`; diagnostics migrated to `printResult()`) | Plaintext key (no OS keychain yet); no server-side revoke/rotate |
| MCP/backend | Ahead of most peers (OAuth 2.1 + PKCE + DCR, Vault BYOK, RLS, `wrapUntrusted`, `/healthz`, `use_mushi` meta-tool shipped, `X-RateLimit-*` headers code-ready) | Zod `_shared/validate.ts` written (deploy is the remaining step [DEPLOY]); rate-limit headers need `functions/mcp/index.ts` wiring [DEPLOY] |

Already at/above the bar (verified in-repo): OAuth 2.1 DCR default-on (only Supabase/Linear
match), rrweb `maskAllInputs/maskAllText: true` defaults (`packages/web/src/capture/replay.ts`),
`mushi sourcemaps upload` with sha256 idempotency, `beforeSend` + legacy `beforeSendFeedback`,
`llms.txt`, 7-day npm release-age cooldown, gitleaks (`mushi_` / `mush_pk_`) + scorecard + provenance,
catalog-count CI (tools ≠ resources/prompts), standalone `healthz` edge function.

Sizes: S (<0.5 d), M (0.5–2 d), L (2+ d). **[DEPLOY]** = Supabase migration/edge deploy
in the same session as the code change (apply_migration / deploy_edge_function, verified
via list_migrations / get_logs / curl before the checkbox closes).

---

## Phase 1 — Hygiene + zero-risk security wins (all S; one [DEPLOY])

- [x] **(SEC, S)** Stop inlining raw API key into editor `mcp.json`. Default `${MUSHI_API_KEY}` placeholder + `--inline-key` escape hatch (`packages/cli/src/mcp-config.ts` + tests).
- [x] **(SEC, S)** Secret-scanning for `mushi_` / `mush_pk_` prefixes in `.gitleaks.toml` (GitHub partner registration still tracked in `SECURITY.md` if not yet filed).
- [x] **(SEC, S)** Dedicated `queue-crypto.test.ts` for `packages/core/src/queue-crypto.ts`.
- [x] **(SEC, S)** `replay.test.ts` locking rrweb masking defaults.
- [x] **(PERF/DX, S)** Dedupe ingest URL: `region.ts` now imports `DEFAULT_API_ENDPOINT` from `api-client.ts` (was hardcoded 3×); node/middleware already imports it. Single source of truth.
- [x] **(DX, S)** Catalog count drift: `scripts/check-catalog-count.mjs` counts **tools only** (68) and asserts `glama.json` matches; resources/prompts logged separately.
- [x] **(HYGIENE, S)** Delete stray `packages/create-mushi-mushi/nul`; gitignore `nul`.
- [x] **(HYGIENE, S)** Salvage `split-widget-render.mjs` → `scripts/`; `.refactor-backups/` gitignored (dir may still exist locally — do not commit).
- [x] **(HYGIENE, S)** `*.tgz` in root `.gitignore`.
- [x] **(PERF, S) [DEPLOY]** `/healthz` edge function + migration probe helper. **Still open:** point `synthetic-monitor` at `/functions/v1/healthz` (not wired yet). Verify: curl 200 after deploy.

**Verify phase**: `pnpm turbo typecheck test lint` • `pnpm --filter web size` • gitleaks fixture • curl healthz • `git status` clean.

## Phase 2 — Credential security + client sampling

- [x] **(SEC, M)** Windows ACLs for CLI config (`packages/cli/src/config.ts` — 0600 is a no-op on win32). `tightenWindowsAcl()` uses `spawnSync('icacls', ...)` with `/inheritance:r /grant:r <user>:F SYSTEM:F`, best-effort.
- [ ] **(SEC, M)** OS keychain storage: optional backend (`@napi-rs/keyring`, prebuilt N-API) → fall back to file+ACL; key only in keychain, config stays JSON; `MUSHI_NO_KEYCHAIN=1` opt-out; silent migration on next login (reuse `~/.mushirc` migration pattern). `mushi doctor` reports backend.
- [ ] **(SEC, M) [DEPLOY]** Server-side revoke + rotate: `POST /keys/revoke|rotate` reusing `_shared/auth.ts`; rotation issues new key w/ grace window (**migration**: `revoked_at`/`rotated_from`). CLI `logout` revokes; new `mushi keys rotate`. Verify: revoked key → 401; audit row written.
- [x] **(PERF/FEAT, M)** `sampleRate` (0-1, default 1) in `packages/core/src/types.ts`, applied in web capture path; user-initiated feedback exempt; wired through `presets.ts`.
- [x] **(PERF, S)** `replaySampleRate`: session-level decision at replay init in `packages/web/src/mushi.ts`.
- [ ] **(SEC, M) [DEPLOY]** zod validation tranche 1: `_shared/validate.ts` (zod 4, typed 400 body) applied to 5 highest-exposure hand-validated functions (`api`, `classify-report`, `fast-filter`, `qa-story-runner`, `inventory-propose`; skip signature-gated `stripe-webhooks`).
- [x] **(FEAT, S)** First-run telemetry notice: `maybeShowTelemetryNotice()` in `config.ts`, persists `telemetryNoticeShown`, wired into `init.ts`. `MUSHI_NO_TELEMETRY=1` opt-out.

**Verify phase**: turbo test/typecheck • curl revoked-key 401 + malformed-body 400 • `get_advisors`/`get_logs` clean • size gates.

## Phase 3 — SDK capability parity

- [x] **(SEC/FEAT, M)** Generalized `beforeSend(report) => report | null | Promise` covering report envelopes; runs after built-in PII scrub; null vetoes. `beforeSendFeedback` deprecated but still honored when `beforeSend` unset.
- [~] **(PERF, L)** Web bundle diet: `./headless` subpath (`packages/web/src/headless.ts`) ships capture primitives + OTel bridge + programmatic `createHeadlessCapture()` without any widget/DOM code. Size-limit gate added at ≤35 KB gzip. **Still open**: dynamic-import widget inside `mushi.ts` so the default full bundle can also shed widget weight for pure-capture users (requires decoupling `widget!:MushiWidget` from the Mushi singleton — tracked as a subsequent PR).
- [x] **(FEAT, M)** OTel-native export from web SDK: `packages/web/src/otel.ts` subpath (`@mushi-mushi/web/otel`) — `createBrowserOtelSpanProcessor(mushi, { otelPresent: context })` dependency-injection design (no dynamic-import probe; tsup/Vite-safe). 16 tests in `otel.test.ts`. Size-limit gate ≤5 KB gzip. Re-exported from `./headless`.
- [x] **(DX/TEST, M)** Node coverage: `middleware.test.ts` (8), `unhandled.test.ts` (6), `otel.test.ts` (12) — 43 tests total passing across 5 files; no `--passWithNoTests`. `node/src/client.ts` transport dedup vs `core/src/api-client.ts` deferred (shapes diverge; tracked as follow-up PR).
- [ ] **(FEAT, M)** Debug-ID completion: `--inject` uuid into artifacts in `cli/src/sourcemaps.ts`, include in upload metadata, SDK attaches to stack payloads. **[DEPLOY]** only if sourcemaps table needs a column.

**Verify phase**: turbo test • web size (lower gate) • changesets for core/web/node/cli • examples smoke.

## Phase 4 — CLI DX uplift (npm-only, no deploys)

- [x] **(DX, M)** Global `-o/--output <text|json>` + `printResult()`/`outputIsJson()` in `cli-shared.ts`; global option set via a root `preAction` hook (`optsWithGlobals()`); wired into `reports list`, `keys list`, `profile list`. Per-command `--json` still honored. Tests: `output-format.test.ts`.
- [x] **(DX, M)** Multi-profile: `--profile`/`MUSHI_PROFILE` + `mushi profile list|current|use`; `loadConfig`/`saveConfig` profile-aware with v2 `{profiles:{…}}` format; **flat legacy files stay flat until a profile-scoped write** (silent upgrade), all other profiles preserved. Tests: `config-profiles.test.ts` (backward-compat asserted). Keychain-per-profile deferred (keychain not yet built).
- [x] **(DX, M)** `mushi upgrade --self`: `self-upgrade.ts` detects install method (user-agent + path heuristics), semver-guarded global command per pm (npm/pnpm/yarn/bun), registry cooldown via `freshness.ts`. Tests: `self-upgrade.test.ts`.
- [x] **(DX, S)** Shell-completion install docs: `packages/cli/docs/SHELL_COMPLETION.md` (bash/zsh/fish generated + pwsh manual snippet).
- [x] **(DX, S)** Composite GitHub Action: `packages/cli/action.yml` (composite) wrapping `mushi sourcemaps upload`; documents pairing with the `mcp-ci` node action for coverage gates (no fabricated flags).

**Verify phase**: cli tests (391 pass) • `-o json profile list` / `profile use` / `upgrade --self --help` smoke-tested on Windows • changesets release. **Remaining:** alias-deprecate per-command `--json` flags on the remaining command groups (reports, keys, project); diagnostics + test already migrated to `printResult()`.

## Phase 5 — MCP platform: context cost, injection story, published limits, docs parity

- [x] **(SEC, M)** `wrapUntrusted()` / `wrapUntrustedJson()` in `packages/mcp/src/wrap-untrusted.ts`; wired in `server.ts` for `get_report_detail`, `get_fix_context`, `search_reports`, `get_similar_bugs`, `run_nl_query`, `query_lessons`, `list_lessons`. Documented in `SECURITY.md`. 11 unit tests in `wrap-untrusted.test.ts`. **Still open:** hosted HTTP MCP edge function (`functions/mcp/index.ts`) doesn't share the wrapper — it's a separate code path.
- [~] **(PERF, L) [DEPLOY]** Context cost: `use_mushi` meta-tool **shipped** in `server.ts` + `catalog.ts` (intent → curated 6–12 tool subset, orientation text, recommended first tool). `USE_MUSHI_INTENTS` map with 6 clusters. **Still open:** curated default-30-tool hosted mode via `?features=` filter in `functions/mcp/index.ts` ([DEPLOY]).
- [~] **(SEC/DX, M) [DEPLOY]** `X-RateLimit-*` headers: `buildRateLimitHeaders()` written in `_shared/mcp-rate-limit.ts` (IETF draft-06 format; 120/min tools-call, 60/hr nl_query). **Still open:** wire into `functions/mcp/index.ts` responses + `scoped_rate_limit_claim` migration to return remaining/reset ([DEPLOY]).
- [x] **(DX, M)** Docs LLM parity: `scripts/generate-llms-full.mjs` → `apps/docs/public/llms-full.txt` (655 KB, 188 pages inlined) + `apps/docs/public/llm-md/<path>.md` plain-markdown twins. Wired into docs prebuild. 16 parity tests in `apps/docs/lib/llms-parity.test.ts`.
- [~] **(SEC, M) [DEPLOY]** zod validation: `_shared/validate.ts` written (Zod 4, `parseBody`/`parseQuery` + 5 schemas: `ApiReportBody`, `ClassifyReportBody`, `FastFilterBody`, `QaStoryRunnerBody`, `InventoryProposeBody`). **Still open:** wire into each edge function + deploy ([DEPLOY]).

**Verify phase**: turbo test • MCP-inspector session vs hosted endpoint • `curl -i` header checks • `get_advisors`/`get_logs`/`list_migrations`.

---

## WON'T-DO (explicit cuts)

- **Standalone Go/single-binary CLI** — toolchain + codesigning + release matrix disproportionate vs npm + self-update. Revisit on demonstrated non-Node demand.
- **Rewriting hand-rolled Streamable HTTP transport onto SDK transport** — 2188-line function is battle-tested; SDK transport on Deno edge unproven. Tracked tech-debt.
- **Activating dormant MCP GET/SSE notifications** — no consumer yet.
- **Gateway `verify_jwt=true`** — deliberate architecture (API-key auth, webhooks carry no JWT); per-function middleware + RLS layer defense.
- **Wrapper-package test uplift (capacitor/wasm/vue/svelte/angular)** — low blast radius; fold into feature work.
- **Asymmetric zero-downtime key rotation** — rotate-with-grace (Phase 2) covers practical need at current scale.

## Reuse map

`core/src/env-config.ts` (config/URL constants) • `functions/_shared/auth.ts` (key hash/lookup) • `functions/_shared/mcp-rate-limit.ts` + `scoped_rate_limit_claim` RPC • `cli/src/freshness.ts` (cooldowns) • `cli/src/sanitize-config.ts` (config writes) • `packages/cursor-plugin` templates (env-placeholder syntax) • existing size-limit gates • changesets + deploy-npm release flow • `scripts/check-catalog-count.mjs` (tools-only) • `packages/mcp/src/wrap-untrusted.ts`.
