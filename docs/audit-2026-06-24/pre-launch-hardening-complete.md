# Pre-Launch Hardening Loop — Implementation Complete

_Implemented 2026-06-24 against plan `pre-launch_hardening_loop`. All 12 burndown
items shipped in code, on Supabase (`dxptnwrhwsqckaftyymj`), and in GitHub Actions
secrets._

Operator companion: [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) §3, §4, §6.

---

## Executive summary

| Area | Status | Evidence |
| --- | --- | --- |
| Secrets & key scope (S1–S3) | **Done** | Workflows + GitHub secrets |
| RLS access control (R1–R6) | **Done** | Live on Supabase + 3 migration files |
| Data integrity (D1–D3) | **Done** | Runbook + CI gate script |
| Dependency provenance (P1–P3) | **Done** | CI audit step; Dependabot already enabled |

**Not yet merged to `master`:** workflow, script, and migration file changes exist
locally — commit and push before the next deploy picks them up.

---

## Part 1 — Secrets & key scope

### S3 — Nightly prod PDCA credential isolation ✅

**Problem:** `nightly-prod-pdca.yml` held `PROD_SUPABASE_SERVICE_ROLE_KEY` and
`PROD_E2E_TEST_PASSWORD` on the same runner.

**Fix:** Split into two jobs:

| Job | Secrets in scope |
| --- | --- |
| `mint-jwt` | `PROD_E2E_TEST_EMAIL`, `PROD_E2E_TEST_PASSWORD`, `PROD_SUPABASE_ANON_KEY` |
| `pdca` | `PROD_SUPABASE_SERVICE_ROLE_KEY`, project/API keys, JWT from job output |

File: `.github/workflows/nightly-prod-pdca.yml`

> Nightly prod PDCA only runs when repo variable `ENABLE_NIGHTLY_PROD_PDCA=true`.

### S2 — AWS deploy OIDC ✅

**Problem:** `deploy-admin.yml` and `deploy-docs.yml` used long-lived
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

**Fix:** Both workflows use GitHub OIDC (`id-token: write` + `role-to-assume`).

| Item | Value |
| --- | --- |
| IAM role | `github-actions-mushi-mushi-deploy` |
| Role ARN | `arn:aws:iam::590715976857:role/github-actions-mushi-mushi-deploy` |
| Policy | `GitHubActionsS3CloudFrontDeploy` (reused from existing deploy user) |
| GitHub secret | `AWS_ROLE_ARN` (set 2026-06-24) |
| Removed secrets | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (mushi-mushi repo only) |

**Other repos:** IAM user `github-actions-deploy` (`AKIAYTCLKPSM4HQUYJMP`) remains
in AWS for other `kensaurus/*` repositories. Do not delete that user until each
repo migrates to its own OIDC role.

Setup script for future repos: `scripts/setup-aws-github-oidc.mjs`

### S1 — Cloud anon key rotation path ✅

**Problem:** `apps/admin/src/lib/env.ts` hardcodes a 2091-expiry anon JWT fallback.

**Fix:** `deploy-admin.yml` passes `VITE_CLOUD_SUPABASE_ANON_KEY` at build time and
fails early if the secret is unset.

| GitHub secret | Status |
| --- | --- |
| `VITE_CLOUD_SUPABASE_ANON_KEY` | Set 2026-06-24 |
| `VITE_SUPABASE_ANON_KEY` | Already present (local/dev Supabase) |

To rotate the cloud anon key: update the JWT in Supabase Dashboard → Settings →
API, then `gh secret set VITE_CLOUD_SUPABASE_ANON_KEY --body "<new-jwt>" --repo
kensaurus/mushi-mushi`. No source patch required.

---

## Part 2 — RLS & access control

All six cross-tenant `USING (true)` SELECT policies removed on production.
Verified: zero `SELECT` policies with `qual = true` on the affected tables.

| ID | Table | Action |
| --- | --- | --- |
| R1 | `llm_invocations` | Dropped `authenticated_reads_llm_invocations`; `org_member_select` remains |
| R2 | `anti_gaming_events` | Dropped `authenticated_reads_ag_events`; `org_member_select` remains |
| R3 | `cron_runs` | Dropped `authenticated_reads_cron_runs`; service-role only (no `project_id`) |
| R4 | `reporter_devices` | Dropped `authenticated_reads_reporter_devices`; `org_member_select` remains |
| R5 | `reporter_notifications` | Dropped `authenticated_reads_reporter_notifications`; `org_member_select` remains |
| R6 | `console_knowledge_chunks` | Dropped `console_knowledge_authenticated_select`; service-role reads only |

Migration files (apply on fresh clones via `supabase db push`; already live on cloud):

```
packages/server/supabase/migrations/20260624100000_rls_tighten_phase1.sql
packages/server/supabase/migrations/20260624110000_rls_tighten_phase2.sql
packages/server/supabase/migrations/20260624120000_rls_tighten_phase3.sql
```

Security advisor re-run after all phases: **0 ERROR-level** new findings (204
pre-existing WARNs unchanged).

### Verify RLS (Supabase SQL)

```sql
-- Should return zero rows (no cross-tenant SELECT leaks):
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'llm_invocations', 'anti_gaming_events', 'cron_runs',
    'reporter_devices', 'reporter_notifications', 'console_knowledge_chunks'
  )
  AND cmd = 'SELECT'
  AND qual = 'true';
```

---

## Part 3 — Data integrity

### D1 — PITR gate before retention cron ✅

Documented in [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) §6.1.

The `mushi-soc2-retention-sweep` cron (daily 03:30 UTC) permanently deletes
`reports` and `audit_logs` per `project_retention_policies`. **Operator must
confirm PITR is enabled** in Supabase Dashboard before relying on this cron.

```sql
-- Check cron is scheduled:
SELECT jobname, schedule FROM cron.job
WHERE jobname = 'mushi-soc2-retention-sweep';

-- Pause if PITR not verified:
SELECT cron.unschedule('mushi-soc2-retention-sweep');
```

### D2 — Destructive migration CI gate ✅

Script: `scripts/check-destructive-migrations.mjs`

Blocks migrations containing bare `DELETE FROM` / `TRUNCATE` without `WHERE`.
Wired into `.github/workflows/ci.yml` (Build & Test job).

```bash
node scripts/check-destructive-migrations.mjs
# ✓ no bare DELETE/TRUNCATE found in 297 migration files
```

Intentional exceptions: annotate the line with
`-- migration-check: allow-destructive` and explain why.

### D3 — Backup / restore runbook ✅

Full procedure in [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) §6.2–6.3.

---

## Part 4 — Dependency provenance

### P2 — `pnpm audit` in CI ✅

Added to `.github/workflows/ci.yml` after `pnpm install`:

```bash
pnpm audit --audit-level=high
```

Baseline at implementation: 0 High/Critical (3 Low/Moderate). Also present in
`.github/workflows/security.yml` for prod deps.

### P1 — SHA-pinned actions + Dependabot ✅

- `deploy-docs.yml`: all third-party actions pinned to commit SHAs (same pattern as
  `deploy-admin.yml`).
- `.github/dependabot.yml`: `package-ecosystem: github-actions` weekly updates
  already configured — no change required.

### P3 — `streamdown` provenance ✅

Direct dependency in `apps/admin/package.json` (`^2.5.0`). React streaming
markdown renderer for LLM response display — not a transitive/squat package.
Lockfile: `streamdown@2.5.0` with integrity hash in `pnpm-lock.yaml`.

---

## GitHub secrets inventory (mushi-mushi, post-hardening)

| Secret | Purpose |
| --- | --- |
| `AWS_ROLE_ARN` | OIDC deploy role (admin + docs) |
| `CLOUDFRONT_DISTRIBUTION_ID` | Cache invalidation |
| `VITE_SUPABASE_URL` | Admin build — local/dev Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Admin build — local/dev anon key |
| `VITE_CLOUD_SUPABASE_ANON_KEY` | Admin build — cloud anon JWT (S1 gate) |
| `VITE_SENTRY_DSN` | Sentry client DSN |
| `SENTRY_AUTH_TOKEN` | Sourcemap upload |

Removed from this repo: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

---

## Verification checklist

Run before declaring the hardening loop closed:

```bash
# Local gates (match CI)
pnpm audit --audit-level=high
node scripts/check-destructive-migrations.mjs
pnpm build && pnpm typecheck && pnpm lint && pnpm test

# GitHub secrets present
gh secret list --repo kensaurus/mushi-mushi | grep -E 'AWS_ROLE_ARN|VITE_CLOUD'

# Supabase RLS (via MCP or SQL editor — see query above)

# First OIDC deploy smoke test (after merge to master):
gh workflow run deploy-admin.yml --ref master
# Watch Actions → confirm "Configure AWS credentials (OIDC)" succeeds
```

### Operator items still manual

- [ ] **Commit and push** hardening changes (workflows, migrations, scripts, this doc).
- [ ] **Confirm PITR enabled** in Supabase Dashboard (§6.1) — not automatable from CI.
- [ ] **Smoke-test one admin deploy** after merge to validate OIDC role assumption.
- [ ] **Migrate other repos** to OIDC when ready (IAM user stays until then).

---

## Files changed (this implementation)

| File | Change |
| --- | --- |
| `.github/workflows/nightly-prod-pdca.yml` | S3: split jobs |
| `.github/workflows/deploy-admin.yml` | S2 OIDC + S1 anon key gate |
| `.github/workflows/deploy-docs.yml` | S2 OIDC |
| `.github/workflows/ci.yml` | P2 audit + D2 migration gate |
| `scripts/check-destructive-migrations.mjs` | D2 gate (new) |
| `scripts/setup-aws-github-oidc.mjs` | OIDC bootstrap helper (new) |
| `packages/server/supabase/migrations/20260624100000_rls_tighten_phase1.sql` | R1, R2 |
| `packages/server/supabase/migrations/20260624110000_rls_tighten_phase2.sql` | R3–R5 |
| `packages/server/supabase/migrations/20260624120000_rls_tighten_phase3.sql` | R6 |
| `docs/DEPLOYMENT.md` | §3 OIDC, §4 docs secrets, §6 PITR runbook |
