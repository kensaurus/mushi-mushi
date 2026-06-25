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
| Fixed in code (PR #242) | 20 | Auto-closed on the post-merge CodeQL scan |
| Fixed in code (PR #245) | 11 | Section-3 runtime follow-ups + 2 extra stack-trace sites — **confirmed fixed** on the post-merge scan |
| Dismissed — documented | 114 | 80 "won't fix", 27 "used in tests", 6 "false positive", 1 probe |
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

## 3. Resolved — PR #245 (`fix/codeql-section3-hardening`)

The genuine **runtime** findings deferred from PR #242's targeted scope were
fixed in a dedicated pass (researched, not rushed) and **confirmed `fixed`** by
the post-merge CodeQL scan on `master`. The pass also closed two additional
`js/stack-trace-exposure` sites (#17, #19) that were open outside the original
9-alert follow-up list.

| # | Sev | Rule | File | Fix |
|---|---|---|---|---|
| 246, 247 | high | `js/incomplete-multi-character-sanitization` | `_shared/html-sanitize.ts` | Replaced the bypassable regex blocklist with a deny-by-default allowlist tokenizer (no tag-matching regex). Backed by 13 Deno tests. The sole producer (`renderIntelligenceHtml`) is already safe-by-construction and the serving route sends a strict CSP; this is defense-in-depth without a new dependency. |
| 248 | high | `js/bad-tag-filter` | `_shared/html-sanitize.ts` | Same tokenizer — handles `</script >`, uppercase, and spaced/malformed end tags. |
| 249 | high | `js/incomplete-url-scheme-check` | `_shared/html-sanitize.ts` | URL-bearing attributes are dropped wholesale, so `javascript:`/`data:`/`vbscript:` cannot survive. Serving-route CSP also hardened (`object`/`frame`/`form-action`/`base-uri 'none'`). |
| 112 | high | `js/incomplete-sanitization` | `api/routes/inventory.ts` | Escape `\` before `\|` and collapse newlines in the Markdown table cell. |
| 20 | high | `js/incomplete-url-substring-sanitization` | `_shared/operator-notify.ts` | Parsed-host compare (`safeHost(url) !== SLACK_HOST`), mirroring `postDiscord`. |
| 74 | high | `js/polynomial-redos` | `marketing-ui/src/StatusPill.tsx` | Linear trailing-slash trim, mirroring the `mcp/src/branding.ts` fix. |
| 81 | medium | `js/missing-origin-check` | `apps/docs/lib/migrationProgress.ts` | Direct `event.origin` equality check as the first guard in the `postMessage` handler. |
| 82 | medium | `js/client-side-request-forgery` | `apps/docs/lib/migrationProgress.ts` | Fetch base pinned to the build-time `DEFAULT_API_URL` constant instead of `session.apiUrl`. |
| 17, 19 | medium | `js/stack-trace-exposure` | `fast-filter`, `judge-batch` | Return `safeErrorResponse()` instead of `String(err)`; full error still logged server-side. |

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
# after PR #242 + #245 merged & re-scanned, the remaining code-scanning open
# alerts are the 11 OpenSSF Scorecard / repo-hygiene items (no open code findings).
gh api --paginate "repos/:owner/:repo/code-scanning/alerts?state=open&per_page=100" | jq length

# see a dismissed alert's reason + comment
gh api "repos/:owner/:repo/code-scanning/alerts/250" | jq '{state,dismissed_reason,dismissed_comment}'
```
