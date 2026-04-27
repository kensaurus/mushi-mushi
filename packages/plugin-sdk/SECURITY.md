<!--
  AUTO-SYNCED from repo root by scripts/sync-community-files.mjs.
  Do not edit here — edit the canonical file at the repository root and
  re-run `node scripts/sync-community-files.mjs` (pre-commit hook does this
  automatically).
-->

# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do NOT open a public GitHub issue.**

Instead, email: **kensaurus@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to release a patch within 7 days for critical issues.

## Scope

- All `@mushi-mushi/*` npm packages
- Supabase Edge Functions (server-side)
- Admin console application
- CLI tool

## Out of Scope

- Self-hosted deployments configured by the user
- Third-party integrations (Jira, Linear, PagerDuty)
- Vulnerabilities requiring physical access

## Security Best Practices for Users

- **Never commit your API keys** — use environment variables
- **Rotate API keys** regularly via the admin console
- **Enable SSO** for team projects (Enterprise tier)
- **Review audit logs** periodically for suspicious activity

## Supply-chain hardening (how this package is protected)

Mushi Mushi is built and published with the controls below. Consumers can
verify each control independently — the goal is to make tampering both
difficult and detectable.

### Publish-time controls

| Control | What it does | How to verify |
|---|---|---|
| **npm Trusted Publisher (OIDC)** | Every release is published from `.github/workflows/release.yml` on `master` using a short-lived OIDC token. Long-lived `NPM_TOKEN` is not used for publishing. | `npm view @mushi-mushi/<pkg> --json` shows `"trustedPublisher"` populated for recent versions. |
| **npm provenance attestations** | Every published tarball ships a [Sigstore provenance attestation](https://docs.npmjs.com/generating-provenance-statements) cryptographically linking the tarball to the exact GitHub Actions run that built it. | `npm audit signatures` (run inside any project that depends on `@mushi-mushi/*`) reports `verified registry signatures` and `verified attestations`. The npm web UI shows a "Built and signed on GitHub Actions" badge on each version. |
| **Pre-publish workspace-protocol guard** | Aborts the publish if `workspace:*` ranges leaked into the tarball (the bug class behind the v0.1.0 incident). | `scripts/check-workspace-protocol.mjs` runs before `changeset publish` in `pnpm release`. |
| **Post-publish tarball verification** | Re-downloads each just-published tarball and asserts it doesn't contain `workspace:*`. | See the "Verify published tarballs do not contain workspace:*" step in `release.yml`. |
| **Post-publish `npm audit signatures`** | Re-installs each published version and validates registry signatures + provenance against npm's transparency log. | See the "Audit signatures of installed dependencies" step in `release.yml`. |

### Build-time controls

| Control | What it does |
|---|---|
| **All third-party GitHub Actions pinned to commit SHAs** | Every `uses:` in every workflow under `.github/workflows/` is pinned to a 40-character commit SHA with a version comment. Floating tags (`@v4`, `@main`) are mutable and were the entry point for the [tj-actions/changed-files compromise (CVE-2025-30066)](https://github.com/step-security/harden-runner#detected-attacks). |
| **Harden-Runner egress audit on every job** | [step-security/harden-runner](https://github.com/step-security/harden-runner) records every outbound network call, file write, and process spawn on every CI runner. Detects exfiltration attempts in real time — caught the tj-actions, NX, Shai-Hulud, and Axios attacks for other projects. |
| **OpenSSF Scorecard** | Weekly + on-push score of the repo's security posture (Pinned-Dependencies, Token-Permissions, Branch-Protection, Code-Review, Dangerous-Workflow, Maintained, SAST, Security-Policy, Signed-Releases, Vulnerabilities). Public results at [scorecard.dev](https://scorecard.dev/viewer/?uri=github.com/kensaurus/mushi-mushi). |
| **Server-side secret scan (Gitleaks)** | Every PR and every push to `master` runs Gitleaks across the diff / full tree. Belt-and-suspenders to the local pre-commit hook (`scripts/check-no-secrets.mjs`) which can be bypassed with `--no-verify`. |
| **Local pre-commit secret scanner** | `scripts/check-no-secrets.mjs` runs as a git hook installed by `pnpm install`, blocking commits that look like AWS / Stripe / GitHub / Anthropic / OpenAI / Slack / Supabase keys. |
| **CodeQL `security-extended`** | Semantic analysis of every TypeScript / JavaScript change finds injection sinks, taint flows, prototype pollution, etc. Runs on every PR, push, and weekly cron. |
| **Dependency review on PRs** | `actions/dependency-review-action` blocks the PR if it adds or upgrades a dep with a high-severity advisory. |
| **`pnpm audit --prod --audit-level=high`** | Weekly cron + every push to `master` fails on any high/critical advisory in production deps. |

### Install-time controls (protect the project's own dependency graph)

| Control | What it does |
|---|---|
| **`min-release-age` (npm) / `minimumReleaseAge` (pnpm)** | Refuses to resolve any dep version published less than 7 days ago. The Axios 1.14.1 / 0.30.4 compromise (Mar 2026) was detected and removed within ~5 hours; Shai-Hulud (Sep 2025) within <12 hours — a 7-day cooldown blocks every publicly-disclosed 2025–2026 npm supply-chain attack outright. |
| **`strictDepBuilds: true`** | Fails the install if any transitive dep tries to run a `postinstall` hook the workspace hasn't pre-approved (`onlyBuiltDependencies` allow-list). |
| **`blockExoticSubdeps: true`** | Refuses to resolve transitive deps from git URLs, tarball URLs, or filesystem paths — anything that didn't go through the npm registry's signing pipeline. |
| **Dependabot with cooldown** | Routine dep upgrades wait 7 days; security advisories bypass the cooldown automatically. |
| **`pnpm audit signatures`-style verification** | The release pipeline re-runs `npm audit signatures` against each published version after the publish, with `--audit-level=high`. |

### Verifying a Mushi Mushi tarball before installing

```bash
# 1. Check provenance attestation matches the public GitHub Actions run
npm view @mushi-mushi/core --json | jq '.signatures, .dist'

# 2. Inside your own project after install
npm audit signatures

# Expected: every @mushi-mushi/* package reports
#   "verified registry signature"
#   "verified attestation"
```

If `npm audit signatures` reports any `@mushi-mushi/*` package as unsigned
or with an invalid attestation, **stop the install and email
kensaurus@gmail.com immediately** — that's the symptom of either a
registry compromise or a tampered tarball, and we want to know within
hours, not days.

### What this hardening does NOT cover

- **Self-hosted deployments.** Once the package is on your machine, the
  security of your `node_modules`, build pipeline, and runtime is your
  responsibility. The hardening above protects the path from source to
  registry; it cannot protect a tarball after it has been downloaded.
- **Compromise of `kensaurus@gmail.com`.** A trusted-publisher rule still
  lets the legitimate maintainer publish from any branch they push. If
  you find yourself with admin access to this repo, treat
  `.github/workflows/release.yml` as a tier-0 secret.
- **First-party bugs.** Provenance proves *who* built the tarball and
  *when*; it does not prove the code is bug-free. CodeQL + tests cover
  that surface, but no automation catches everything — please continue
  to report issues to the address above.
