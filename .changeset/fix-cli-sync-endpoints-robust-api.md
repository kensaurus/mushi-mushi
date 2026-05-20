---
"@mushi-mushi/cli": minor
---

**CLI: robust sync endpoints + new commands + safe API client**

All CLI commands now route through `/v1/sync/*` endpoints that accept the SDK
API key (no JWT, no scope check required). This fixes the `INSUFFICIENT_SCOPE`
errors that `status`, `reports list`, and `reports show` produced when called
with a project API key.

### New commands

- `mushi whoami` — verify the API key and print project info + report counts
- `mushi ping` — check backend connectivity with latency measurement
- `mushi reports resolve <id>` — mark a report resolved (shorthand for triage)
- `mushi reports reopen <id>` — reopen a resolved or dismissed report
- `mushi reports dismiss <id>` — dismiss a report as out of scope
- `mushi reports search <query>` — full-text search across summary and description
- `mushi lessons list` — list active mistake rules with severity and frequency
- `mushi lessons show <id>` — print full detail for a single lesson

### Fixed commands

- `mushi status` — now uses `/v1/sync/stats` (apiKeyAuth), was hitting `/v1/admin/stats` which required JWT
- `mushi reports list` — now uses `/v1/sync/reports`, was hitting `/v1/admin/reports`
- `mushi reports show <id>` — now uses `/v1/sync/reports/:id`
- `mushi reports triage <id>` — now uses `PATCH /v1/sync/reports/:id`
- `mushi index <path>` — now uses `/v1/sync/codebase/upload` (apiKeyAuth) instead of the JWT-only admin route

### Safe API client (fixes crash on non-JSON errors)

The `apiCall()` helper no longer crashes when the server returns a plain-text or
HTML response (gateway 404, Deno cold-start error, Supabase maintenance page).
Non-JSON responses are wrapped into a structured `{ ok: false, error }` object
with the HTTP status code attached. A 15-second timeout using `AbortController`
prevents CI hangs on unreachable endpoints.

### New exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | API or runtime error |
| `2` | Configuration error (missing credentials or endpoint) |
| `3` | Not found (resource does not exist) |

### New server endpoints (deployed to Supabase)

All behind `apiKeyAuth` — no JWT or scope required:

- `GET /v1/sync/whoami`
- `GET /v1/sync/stats`
- `GET /v1/sync/reports`
- `GET /v1/sync/reports/:id`
- `PATCH /v1/sync/reports/:id`
- `GET /v1/sync/lessons/:id`
- `POST /v1/sync/codebase/upload`

### Documentation

`packages/cli/README.md` rewritten with:
- Quick start in 5 steps
- Full command reference with `--json` output and exit code docs
- Environment variable table
- Step-by-step guide for finding Project ID and API key
- CI usage examples (GitHub Actions, env-var-only config)
- Biological evolution analogy connecting the CLI to the closed-loop pipeline
