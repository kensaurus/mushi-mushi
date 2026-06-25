# CodeQL / GitHub Advanced Security triage — 2026-06-25

Triage of the GitHub Advanced Security ("CodeQL") code-scanning gate, which was
reporting **154 open alerts** (45 high) on `master`. This is the GHAS analysis
run by [`.github/workflows/security.yml`](../../.github/workflows/security.yml)
plus the OpenSSF Scorecard upload from
[`.github/workflows/scorecard.yml`](../../.github/workflows/scorecard.yml) — it
is **not** infra noise. It surfaces real findings, the large majority of which
are low-real-risk in tests / build tooling / CLI file-IO.

## Disposition summary (154 alerts)

| Disposition | Count | Notes |
|---|---|---|
| Fixed in code (PR #242) | 20 | Auto-close on the next CodeQL scan after merge |
| Dismissed — documented | 114 | 80 "won't fix", 27 "used in tests", 6 "false positive", 1 probe |
| Kept open — needs review | 9 | Genuine runtime findings; recommended follow-up (below) |
| OpenSSF Scorecard (repo hygiene) | 11 | Repo settings / Dockerfile pinning (below) |

## 1. Fixed in code — PR #242 (`fix/codeql-runtime-hardening`)

| Rule | Where | Fix |
|---|---|---|
| `js/stack-trace-exposure` (9) | 9 edge functions | `_shared/safe-error.ts` `safeErrorResponse` — generic 5xx body, full error logged server-side |
| `js/insecure-randomness` (5) | `core/src/session.ts`, `web/src/mushi.ts` | `generateSessionId()` now uses the WebCrypto ladder, not `Math.random()` |
| `js/polynomial-redos` (1) | `mcp/src/branding.ts` | trailing-slash trim via linear scan, not `/\/+$/` |
| `js/incomplete-url-substring-sanitization` (3) | `apps/admin` fixes/integrations | shared `isGithubUrl`/`isGithubHostname` (hostname check, not substring) |

These stay "open" in GHAS until CodeQL re-scans `master` post-merge, then close
automatically.

## 2. Dismissed — with documented justification (114)

Dismissed via the code-scanning API with a per-category `dismissed_comment`.

| Reason | Count | Scope | Rationale |
|---|---|---|---|
| `used in tests` | 27 | `*.test.ts` / e2e specs | `js/insecure-temporary-file`, etc. in test-only code; never shipped |
| `won't fix` | 80 | `scripts/**`, `packages/cli`, `packages/codebase-graph`, `packages/verify`, `packages/mcp-ci`, `eslint-plugin-mushi-mushi` | Inherent file/HTTP IO and `child_process` use of operator-run build/CLI/lint tooling — operator-controlled input, not a remote trust boundary (`js/file-access-to-http`, `js/file-system-race`, `js/indirect-command-line-injection`, `js/polynomial-redos` in CLI, …) |
| `false positive` | 6 | `apps/admin` client | `js/insecure-randomness` for non-security correlation/presence ids (realtime channel, dispatch preflight) — not tokens or secrets |

Top dismissed rules: `js/file-access-to-http` (42), `js/insecure-temporary-file`
(25), `js/file-system-race` (11), `js/polynomial-redos` (9, all CLI/tooling),
`js/indirect-command-line-injection` (8), `js/insecure-randomness` (6, admin).

## 3. Kept open — recommended follow-up (9)

These are genuine **runtime** findings beyond the approved targeted scope of
PR #242. They were deliberately **not** dismissed and **not** rushed — each
deserves a careful, dedicated fix.

| # | Sev | Rule | File | Note |
|---|---|---|---|---|
| 246, 247 | high | `js/incomplete-multi-character-sanitization` | `_shared/html-sanitize.ts` | **Highest priority.** Regex HTML sanitizer for LLM-generated admin content is bypassable (e.g. nested `<scr<script>ipt>`). Recommend replacing regex sanitization with a real sanitizer or guaranteeing the output is never rendered as HTML. |
| 248 | high | `js/bad-tag-filter` | `_shared/html-sanitize.ts` | Same sanitizer; `<script>` regex misses malformed tags. |
| 249 | high | `js/incomplete-url-scheme-check` | `_shared/html-sanitize.ts` | `javascript:` strip is defeatable (embedded chars / entity encoding). |
| 112 | high | `js/incomplete-sanitization` | `api/routes/inventory.ts` | Review the sanitization on this runtime route. |
| 20 | high | `js/incomplete-url-substring-sanitization` | `_shared/operator-notify.ts` | Same class as the admin fix; apply hostname parsing. |
| 74 | high | `js/polynomial-redos` | `marketing-ui/src/StatusPill.tsx` | Shipped UI; same class as the mcp fix. |
| 81 | medium | `js/missing-origin-check` | `apps/docs/lib/migrationProgress.ts` | `postMessage` handler missing an `event.origin` check. |
| 82 | medium | `js/client-side-request-forgery` | `apps/docs/lib/migrationProgress.ts` | Request target derived from untrusted input. |

## 4. OpenSSF Scorecard (11) — repo settings, not code

These come from the Scorecard SARIF upload (`scorecard.yml`) and are repo /
supply-chain hygiene, actioned in GitHub settings or workflow files — not code
fixes:

- `BranchProtectionID`, `CodeReviewID` — branch protection + required reviews on `master`.
- `DependencyUpdateToolID` — Dependabot is configured (`.github/dependabot.yml`); ensure Scorecard detects it.
- `MaintainedID`, `VulnerabilitiesID`, `FuzzingID`, `SASTID`, `CIIBestPracticesID` — informational posture metrics.
- `PinnedDependenciesID` (3) — pin base images / actions by digest in `deploy/Dockerfile.admin` and `deploy/Dockerfile.edge`.

## Reproduce / audit

```bash
# remaining open after this triage (should be: 20 fixed-pending-rescan + 11 scorecard + 9 review)
gh api --paginate "repos/:owner/:repo/code-scanning/alerts?state=open&per_page=100" | jq length

# see a dismissed alert's reason + comment
gh api "repos/:owner/:repo/code-scanning/alerts/250" | jq '{state,dismissed_reason,dismissed_comment}'
```
