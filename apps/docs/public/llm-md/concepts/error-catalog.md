# API error catalog

Source: https://kensaur.us/mushi-mushi/docs/concepts/error-catalog

---
title: API error catalog
description: Stable error codes returned by the Mushi API envelope, how to read them in the console, and how they correlate with Sentry and Langfuse.
---

# API error catalog

Every Mushi API failure uses the same envelope:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-safe explanation",
    "requestId": "a1b2c3d4e5f6"
  }
}
```

## Why codes exist

- **`code`** is stable and greppable — quote it in bug reports.
- **`message`** is safe for end users (no Postgres text, no stacks, no secrets).
- **`requestId`** (also on the `X-Request-Id` response header) links the console
  error, Sentry event, edge access log, and — for LLM routes — the Langfuse
  trace.

The closed set of codes lives in
[`error-codes.ts`](https://github.com/kensaurus/mushi-mushi/blob/master/packages/server/supabase/functions/_shared/error-codes.ts)
and is published as the OpenAPI `Error.code` enum. The generated table is
[`docs/ERROR_CATALOG.generated.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/ERROR_CATALOG.generated.md).

## Codes you will see often

| Code | What it usually means | What to do |
| --- | --- | --- |
| `MISSING_AUTH` | No Bearer token / API key | Sign in again or mint a key |
| `INVALID_TOKEN` | Expired or revoked JWT | Refresh the session |
| `NO_ORG` / `NO_ORGANIZATION` | Console call without `X-Mushi-Org-Id` | Pick a team in the org switcher |
| `NO_PROJECT` / `PROJECT_NOT_FOUND` | Missing or inaccessible project | Switch project or reconnect |
| `VALIDATION_ERROR` | Body / field failed Zod or validators | Fix the highlighted fields |
| `RATE_LIMITED` | Too many requests | Wait and retry |
| `QUOTA_EXCEEDED` / `FEATURE_NOT_IN_PLAN` | Plan gate | Upgrade or lower usage |
| `DB_ERROR` / `RPC_ERROR` | Persistence failure (detail in Sentry only) | Retry; if persistent, quote `code` + `requestId` |
| `INTERNAL` | Unhandled server exception | Quote `requestId` — it was captured |

## Console feedback

Admin pages that load through `usePageData` render failures with
`` → ``, which shows:

1. A plain-English **title** + **hint** (`humanizeApiError`)
2. A recovery **action** when one exists (create team, switch project, …)
3. A monospace caption: `code · endpoint · request`

## SDK reporters

The web and React Native widgets distinguish:

- queued offline / retrying
- rate limited (`429`)
- quota blocked (`403` / `QUOTA_EXCEEDED`)
- permanent credential failures (`401` / `403`)

so reporters never see a fake "success" checkmark for a dropped report.

## Drift gate

`pnpm check:error-codes` (part of `pnpm check:drift`) fails when the registry,
OpenAPI `Error.code` enum, or this page drift apart.
