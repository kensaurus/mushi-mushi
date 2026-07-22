# Docs Drift Sync — mushi-mushi (Jul 19 2026)

_Audit + execution record. Preservation contract: code is source of truth; no aspirational docs._

## Preservation contract

Follows `plan-docs-sync` skill: every drift pairs doc claim + code fact; stale prose corrected not deleted; factual vs subjective separated.

## Drift taxonomy (at audit)

| Type | Count | Status after this pass |
|------|------:|------------------------|
| stale | ~12 | plan-uplift + AGENTS refreshed |
| missing | ~8 | healthz / Linear / CLI / sampling documented |
| phantom | 2 | `close_report` removed; “83 tools” retired |
| contradictory | 3 | glama/catalog-count = **68 tools**; footers 55/325 |
| onboarding-breaking | 0 | still green |
| inline-rot | 1 | configDocs fixed + regen |
| api-contract | 1 | CONFIG_REFERENCE regenerated |

## Phase execution

| Phase | Scope | Outcome |
|-------|--------|---------|
| A | close_report, catalog-count tools-only, glama 68, docs-stats footers | Done — `check:docs-stats`, `check:catalog-count`, `check:config-docs` green |
| B | AGENTS infra/CLI, plan-uplift checkboxes, DEPLOYMENT/SELF_HOSTED/edge-functions healthz | Done |
| C | sampleRate / replaySampleRate / beforeSend in web.mdx + core.mdx + core README; fixed phantom `onBeforeSubmit` | Done — SECURITY.md already documents wrapUntrusted |
| AS-1/2 | Console + docs anti-slop | Done — see [`plan-antislop.md`](./plan-antislop.md) |

## MCP tools semantics (canonical)

- **68 tools** = `TOOL_CATALOG` + `TDD_TOOL_CATALOG` + `CODEBASE_TOOL_CATALOG`
- **8 resources** + **4 prompts** are separate (generated MDX: `68 tools · 8 resources · 4 prompts`)
- `scripts/check-catalog-count.mjs` asserts tools-only count vs `glama.json`

## Remaining / deferred

- Wire `synthetic-monitor` → `healthz` (code, not docs)
- Hosted curated ~30-tool MCP default — do not document until shipped
- Ingest URL dedupe still open in plan-uplift Phase 1

## Related

- Anti-slop (console): [`docs/plan-antislop.md`](./plan-antislop.md)
- Landing anti-slop history: [`apps/docs/plan-antislop.md`](../apps/docs/plan-antislop.md)
- Uplift burndown: [`docs/plan-uplift-sdk-cli-mcp.md`](./plan-uplift-sdk-cli-mcp.md)
