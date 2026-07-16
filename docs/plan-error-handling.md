# Plan — Error handling (Mushi console + API + SDK)

Audit-and-plan output of `/plan-error-handling` (Jul 2026). Implementation
tracked in the burndown plan `mushi-console-error-validation`.

## Verdict (pre-fix)

| Area | Finding |
| --- | --- |
| Fetch capture | Strong — `apiFetch` breadcrumbs / 5xx capture / PII scrub |
| Dead red bars | Overview, Activity, McpAuth, CliAuth discarded real errors; QaCoverage dumped `<pre>` |
| Envelope | Auth omitted `ok`; `onError` bare `{error:'internal'}`; some webhooks used string `error` |
| Codes | No central registry; `DB_ERROR` / `RPC_ERROR` echoed raw PG text |
| Feedback | Only Fixes surface humanized well (`humanizeFixError`) |
| Provenance | `lastFetchedAt` / lineage fields existed but missing from many views + errors |
| SDK | Rate-limit / quota / permanent fail rendered as success or "queued offline" |

## Shipped remediation

| Phase | Change |
| --- | --- |
| 0 | Portfolio reads `X-Mushi-Org-Id`; dead bars → `<ErrorAlert>` / `<PageLoadError>` |
| 1 | `_shared/error-codes.ts` + `jsonError` / auth / `onError` / safe DB messages |
| 2 | `humanizeApiError` + `PageLoadError` + humanize parity gate + panel boundary |
| 3 | Zod + validators + fail-closed reward webhooks + Streamdown prefix pins |
| 4 | Honest SDK `failureKind` (web + RN) + RN min-length / maxLength / assistant catch |
| 5 | `X-Request-Id` round-trip, ErrorAlert captions, FreshnessPill on Overview/Activity |
| 6 | OpenAPI `Error.code` enum, docs catalog, `check:error-codes` drift gate |

## Langfuse sub-audit (Phase 6)

Ran `node scripts/check-llm-trace-linkage.mjs` → **ok** (every `logLlmInvocation`
call site passes `langfuseTraceId`).

### Traced (good)

| Surface | Evidence |
| --- | --- |
| SDK assistant (`sdk-assistant.ts`) | `logLlmInvocation` + `langfuse_trace_id` on messages |
| Ask Mushi (`ask-mushi.ts`) | `langfuseTraceId` on invocation logs |
| `classify-report` | Stage LLM + vision paths log with `trace.id` |
| `fix-worker` | Trace tagged; `langfuse_trace_id` persisted |
| `fast-filter` | Both generateObject paths pass `langfuseTraceId` |

### Gaps (route to `audit-langfuse-llm` — not fixed in this burndown)

| Surface | Gap |
| --- | --- |
| `library-modernizer` | `generateObject` without nearby `logLlmInvocation` / trace id in the same block |
| `prompt-auto-tune` | Same |
| `mistake-clusterer` | Same |
| `generate-synthetic` | Second nested `generateObject` may skip cost logging |
| `pdca-runner` | Trace tagged at start; verify every producer/critic path logs usage+cost |
| `inventory-propose` | Uses `generateText`; confirm Langfuse observation is created |
| Prompt version linkage | Confirm `prompt_version` is set on assistant / classify / fix-worker traces |

## Verify

- Unauthenticated `GET /v1/admin/portfolio` → `{ ok:false, error:{ code:'MISSING_AUTH', …, requestId? } }`
- Console error caption shows `code · endpoint · request`
- `pnpm check:error-codes` and `pnpm check:humanize-parity` green
