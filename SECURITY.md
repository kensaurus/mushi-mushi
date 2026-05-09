# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do NOT open a public GitHub issue.**

Use either channel below:

1. **GitHub Private Vulnerability Reporting** — strongly preferred.
   <https://github.com/kensaurus/mushi-mushi/security/advisories/new>
   Routes the report into a private advisory with built-in CVE issuance,
   patch coordination, and contributor-credit workflow.
2. **Email** — `kensaurus@gmail.com`, subject prefix `[mushi-security]`.
   PGP welcome but not required.

Include:
- Description of the vulnerability
- Steps to reproduce (smallest reproducer wins)
- Impact assessment (what an attacker gains)
- Suggested fix (if any)
- Whether you want public credit (and how to spell your name)

### Coordinated-disclosure timeline

| Day | Action |
|-----|--------|
| 0 | Report received |
| ≤ 2 | Acknowledgment + assigned a tracking ID |
| ≤ 7 | Triage complete: severity assigned (CVSS 3.1) and target patch date communicated |
| ≤ 30 | Patch released for critical / high (CVSS ≥ 7.0); ≤ 60 days for medium; best-effort for low |
| Patch + 7 | Public advisory + CVE published; reporter credited unless they declined |
| Patch + 90 | Embargo expires regardless; if upstream is unresponsive, the reporter is free to publish |

### Safe harbor

Good-faith security research on Mushi Mushi is welcome. If you stay
within the rules below, we will not pursue legal action, will not ask
your hosting provider to take you offline, and will publicly credit your
work:

- Test only against your own self-hosted instance, the public demo at
  <https://kensaur.us/mushi-mushi/admin/>, or accounts you own.
- Do not access, exfiltrate, or modify data belonging to other users.
- Do not run automated scanning that affects availability for others
  (rate-limit your tooling, exclude `/health`).
- Disclose privately first (channels above); do not publish before the
  embargo above expires.
- Do not intentionally exploit a finding to escalate beyond proving it
  exists.

If a finding requires touching production data to confirm, **stop and
ask first** — describe what you'd need to do and we'll spin up a sandbox.

### Hall of fame

Researchers who report a confirmed vulnerability are credited in the
release notes for the patched version and added to
[`docs/SECURITY_HALL_OF_FAME.md`](./docs/SECURITY_HALL_OF_FAME.md) (with
permission).

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
- **Verify SDK integrity** with `npm audit signatures` after install
- **Set `Content-Security-Policy`** on any page embedding the Mushi widget;
  the widget itself ships with `script-src 'self'` and does not load
  remote scripts.

## Threat model

What we treat as in-scope attacker capabilities, and what we don't.

| Capability | In scope | Notes |
|-----------|----------|-------|
| Unauthenticated network attacker hitting public endpoints | ✅ | Rate-limit + HMAC + replay protection on every webhook endpoint (`packages/server/supabase/functions/_shared/webhook-middleware.ts`). |
| Authenticated user trying to read another tenant's data | ✅ | Postgres RLS on every `public.*` table; advisor lints reviewed monthly. |
| Authenticated user trying to escalate to super-admin | ✅ | Role lives in `auth.users.raw_app_meta_data.role`; cannot be self-edited via PostgREST. |
| Compromised dependency (npm supply-chain attack) | ✅ | 7-day cooldown + provenance + Harden-Runner + pinned SHAs (see "Supply-chain hardening" below). |
| Stolen API key | ✅ | Per-key scopes (`api_key_has_scope`), revocation via admin console, audit log of every use. |
| User pasting a Stripe / OpenAI / GitHub PAT into a bug report | ✅ | PII scrubber redacts ~15 vendor token formats client-side before the report leaves the device. Mirrors `packages/core/src/pii-scrubber.ts` across iOS, Android, Flutter, React Native. |
| Stolen end-user device with the SDK installed | ⚠️ partial | Offline queue is AsyncStorage / Keychain / SharedPreferences — no app-level encryption beyond the OS default. Reports waiting to flush are vulnerable to a forensic attacker. |
| Compromised Supabase service-role key | ❌ | Treated as a tier-0 incident; would require key rotation and audit-log forensics. Not defendable in software. |
| Compromise of `kensaurus@gmail.com` | ❌ | Treated as a project-fork event; downstream consumers should pin to the last known-good version and follow the new release channel. |
| Physical / OS-level attacker on an end-user device | ❌ | Out of scope. |
| Malicious fork using the Mushi name to ship malware | ❌ (technical) ✅ (legal) | The MIT/BSL grant lets the fork exist; the trademark policy (`TRADEMARK.md`) makes shipping it under the Mushi name an infringement we will pursue. |

## Data handling and PII

### What the SDK collects by default

| Field | Scope | PII risk |
|-------|-------|----------|
| URL / route the user was on | Always | Low — strip query strings if your routes encode user IDs. |
| Browser / OS / device | Always | None |
| Console errors (last 50) | Opt-in via `captureConsole: true` | Medium — can include user data your code logs. |
| Network failures (URL + status) | Opt-in via `captureNetwork: true` | Medium — query params logged as-is unless you redact in-app. |
| User id / email / role | Only if you call `setUser()` | High — only set what you need; we do not auto-discover. |
| Session replay frames | Off by default | High — handled by the masking layer; passwords / cards / opted-out elements never leave the page. |
| Free-text bug description | Always | Medium — passed through the PII scrubber (see below). |

### What the PII scrubber redacts before send

Implemented identically across `@mushi-mushi/core`, the iOS, Android,
Flutter, and React Native SDKs. Defaults are below — every category can
be toggled off, but `secretTokens` is on by default and we recommend
keeping it that way.

| Category | Default | Patterns |
|----------|---------|----------|
| `ssns` | on | `123-45-6789` |
| `creditCards` | on | 12–19 digit Luhn-shaped sequences with optional separators |
| `secretTokens` | on | AWS access key (`AKIA…` / `ASIA…`), AWS secret (`aws_secret_access_key=…`), Stripe (`sk_live_…`, `sk_test_…`, `rk_…`, `pk_…`), Slack (`xox[abpor]-…`), GitHub PAT (`ghp_…`, `github_pat_…`), OpenAI (`sk-…`, `sk-proj-…`), Anthropic (`sk-ant-…`), Google API (`AIza…`), JWT (`eyJ…` 3-segment) |
| `emails` | on | RFC-5322 lite |
| `phones` | on | E.164 with optional country code |
| `ipAddresses` | off | IPv4 (off because internal IPs are usually not PII and noise hurts triage) |
| `ipv6` | off | Same |

The fields scrubbed are:

- `description` — primary free-text field of every bug report
- `summary` — short summary, in the same composer
- `breadcrumbs[].message` — auto-captured user-action trail (clicks, route changes, console messages)

Structured fields you set explicitly (`metadata.userEmail`,
`metadata.userId`, etc.) are intentionally **not** scrubbed — those are
opt-in attribution data, and silently rewriting them would break
support workflows.

### Where data lives

- **Reports & telemetry** — Supabase Postgres in the `us-west-1` region.
- **Session replays** — Supabase Storage, same region. Lifecycle policy
  trims replays older than 30 days unless explicitly retained from the
  admin console.
- **Inbound webhook bodies** — only a SHA-256 hash + `delivery_id` of
  the body is persisted (`webhook_audit_log`). The full body is
  processed in memory and discarded.
- **Outbound integrations** (Slack, Jira, …) — Mushi is a sender only;
  the receiving system's retention applies.

### Encryption

| Surface | At rest | In transit |
|---------|---------|------------|
| Postgres (Supabase) | AES-256 (Supabase default) | TLS 1.2+ |
| Supabase Storage (replays) | AES-256 | TLS 1.2+ |
| Edge Function ↔ Postgres | — | TLS via the Supavisor pooler |
| SDK ↔ ingest endpoint | — | TLS 1.2+ enforced; HSTS preload on `kensaur.us` |
| Inbound webhooks | — | TLS terminated at CloudFront / Supabase edge |
| Audit log integrity | append-only by RLS; no in-row signing | — |

### Cryptographic primitives

| Use | Algorithm | Implementation |
|-----|-----------|---------------|
| Webhook HMAC verification (Sentry, GitHub, Datadog, Honeycomb, Grafana, Bugsnag, Rollbar, Crashlytics) | HMAC-SHA256, constant-time compare | Web Crypto in Deno; `crypto.subtle.timingSafeEqual` analogue |
| AWS SNS subscription confirmation | RSA-SHA1 / RSA-SHA256 | Deno `crypto.subtle.verify` with the cert from `SigningCertURL` (URL allow-listed to `*.sns.*.amazonaws.com`) |
| Opsgenie JWT shared-token | HS256 with `aud` claim verification | `jose` (Deno-compatible) |
| API-key hashing (database) | SHA-256 prefix + bcrypt secret half | `pgcrypto` |
| Provenance attestations (npm) | Sigstore (Fulcio + Rekor) | `npm publish --provenance` |

We deliberately do not roll our own crypto. If you find an algorithm or
library above that has been deprecated, please file a security advisory.

### Operator security checklist

When you provision a new self-hosted Mushi instance:

- [ ] Set `auth_leaked_password_protection = true` in Supabase Auth
      (HaveIBeenPwned blocklist; flagged as `auth_leaked_password_protection`
      in the security advisor).
- [ ] Enable at least two MFA factors in Supabase Auth (`auth_insufficient_mfa_options`).
- [ ] Rotate the service-role key on day 1, then quarterly.
- [ ] Restrict Postgres direct connections to your CI / migration runners
      via Supabase network restrictions.
- [ ] Run `pnpm dlx supabase advisors --project-ref <ref>` after every
      migration; aim for zero ERROR-level findings.
- [ ] Configure a Supabase log drain to your SIEM if you are subject to
      SOC 2 / ISO 27001.
- [ ] Set CSP `frame-ancestors` on the host page if you embed the Mushi
      widget (the widget is iframe-friendly but does not enforce
      framing constraints itself).

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
