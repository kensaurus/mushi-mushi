# Error-Handling & Observability Audit — mushi-mushi

_Implemented 2026-06-24. See git history for file-level changes._

## Summary

Phases 1–4 shipped across server edge, admin console, SDK, CLI, and MCP:

- **Sentry:** Client-abort dedup at API boundary; circuit-breaker logging; admin breadcrumbs; CLI structured JSON errors in CI
- **Langfuse:** Trace coverage extended to sdk-assistant, story-mapper, PDCA, test-gen paths; ingestion failures logged; metadata PII scrub; Sentry `langfuse.trace_id` correlation
- **CI:** `pnpm check:llm-trace-linkage` guards `logLlmInvocation` call sites

## Verification

```bash
pnpm check:llm-trace-linkage
pnpm --filter @mushi-mushi/node test
pnpm --filter @mushi-mushi/cli test
cd packages/server && npm run test -- --run src/__tests__/inventory-guards.test.ts
```
