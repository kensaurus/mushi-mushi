# No client data leakage — what we promise and how we enforce it

Source: https://kensaur.us/mushi-mushi/docs/security/no-leakage-claim

---
title: No client data leakage — what we promise and how we enforce it
description: Explicit enumeration of Mushi Mushi's privacy boundaries, the gaps we've closed, and the controls that keep client data isolated.
---

# No client data leakage

This page is the single-source citation for the privacy claims made on the Mushi Mushi landing page. It enumerates exactly what Mushi promises, which controls enforce each promise, and which gaps have been closed or documented as follow-ups.

  **Short version:** Your reports are RLS-isolated per project. Screenshots are behind signed URLs. PII is scrubbed before writing to Postgres and before any LLM call. Your code never leaves your repo. BYOK means Anthropic/OpenAI never sees your data under our account when configured.

---

## The three promises

### 1. Your data doesn't cross project boundaries

**Control:** Row-Level Security (RLS) is enabled on every customer-facing table. The `reports`, `fix_attempts`, `qa_story_runs`, `llm_invocations`, `byok_audit_log`, and 30+ sibling tables use `project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())` or the org-member equivalent. The `soc2-evidence` cron snapshots `mushi_rls_coverage_snapshot()` daily and alerts if a new table has RLS disabled.

**Verification:** `SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;` should return zero rows.

### 2. PII is scrubbed before it reaches Postgres or an LLM

**Control (at-rest, Wave 5 Gap A):** `scrubPii()` from `_shared/pii-scrubber.ts` is called in the ingest path (`api/helpers.ts::ingestReport`) before the `reports` row is inserted. Fields scrubbed: `description`, `user_intent`, `console_logs[].message`, `network_logs[].url` (including query parameters). Patterns cover: SSN, credit-card PAN, AWS/Stripe/Slack/GitHub/OpenAI/Anthropic keys, JWTs, IPv4, IPv6, emails, phone numbers.

**Control (pre-LLM, defence-in-depth):** `scrubReport()` is also called in `classify-report` and `fast-filter` before building the Anthropic prompt, so even if the ingest scrub is ever bypassed the LLM never sees raw PII.

**Gap not yet closed:** `performance_metrics` and `selected_element` JSONB columns are not yet scrubbed — these fields are unlikely to contain PII but are not covered by the current scrubber. Filed as a follow-up.

### 3. Screenshots are behind signed, time-limited URLs

**Control (Wave 5 Gap B):** The default `SupabaseStorageAdapter` now uses `createSignedUrl()` (TTL 3600s) instead of `getPublicUrl()`. The `screenshots` Supabase Storage bucket was created with `public = false`. This means even if the bucket flag were accidentally flipped, the URL stored in `reports.screenshot_url` would still be a signed URL that expires.

**BYO storage:** S3/R2/GCS/MinIO adapters use SigV4-presigned GET URLs with TTL from `project_storage_settings.signed_url_ttl_secs` (default 3600s, max 604800s).

---

## BYOK — your API keys run against your account

**What "BYOK" means:** Mushi never trains on your bug reports. When you configure your own Anthropic or OpenAI key (`Settings → API Keys (BYOK)`), all LLM calls (classify, fix, judge) use your key and your account. Mushi's platform key is not used.

**What happens without BYOK:** LLM calls fall back to Mushi's platform Anthropic/OpenAI account. Your prompt content (the scrubbed bug description, code context, diff) flows through that account. This is logged in `llm_invocations.key_source = 'env'` and surfaced as a warning chip on `/onboarding` and `/settings`.

**Enterprise opt-out (Wave 5 Gap D):** `project_settings.require_byok = true` makes the env fallback a hard error. Set automatically on Cloud-paid and Enterprise plans.

**Vault encryption:** BYOK key values are stored as `vault://` references pointing to Supabase Vault (`vault.secrets`). The `project_settings.byok_*_key_ref` columns never hold raw key strings in production (enforced by `dereferenceKey()` in `_shared/byok.ts` which rejects non-vault refs in the `production` environment).

---

## Your code stays in your repo

The `fix-worker` edge function reads your codebase via a RAG vector index (`project_codebase_files`) built by `mushi index`. It generates a diff and opens a draft PR via the GitHub REST API. Your source files are:

- Stored in `project_codebase_files` with `content_preview` (first 500 chars) for UI display and full-text embedding for semantic search. They are RLS-isolated by `project_id`.
- Never sent to Anthropic/OpenAI as raw files — only the relevant snippet (≤ 8 KB context window) extracted by RAG is included in the prompt, already scrubbed for PII.
- Deleted from the vector index when `project_settings.codebase_index_enabled = false` or the project is deleted (cascade via `project_id FK ON DELETE CASCADE`).

---

## Screenshot URL host validation

**Control (Wave 5 Gap G):** `screenshot_url` values are validated at ingest time (`validateScreenshotUrlIngest()` in `api/helpers.ts`). Invalid URLs, non-HTTPS schemes, private/metadata hosts (RFC1918, `169.254.*`, `.local`, `.internal`), and hosts outside the allowlist are rejected and stored as `NULL`. The ingest allowlist defaults to `*.supabase.co`, `*.supabase.in`, `*.supabase.red` — extensible via `MUSHI_SCREENSHOT_HOST_ALLOWLIST`.

---

## Vault secret scoping

**Control (Wave 5 Gap F):** The `vault_store_secret(name, value, project_id)` Postgres function now enforces the naming convention `mushi__*` when `project_id` is supplied. A misconfigured caller cannot overwrite a different tenant's secret. The three-arg form is used by all admin routes that manage BYOK keys.

---

## What we defer (known follow-ups)

| Gap | Description | Status |
|-----|-------------|--------|
| C | SSRF allowlist for self-hosted deployments should auto-derive from `project_storage_settings.endpoint` | Deferred — needs ops coordination |
| H | Sentry Replay in the admin console runs on routes that display customer report data. DOM structure may implicitly reveal topic/count metadata. | Deferred — disable Replay on `/reports/:id`, `/fixes/:id`, `/query` |
| Langfuse tenant isolation | Mushi's Langfuse workspace correlates project IDs with prompt+response payloads. Self-hosted Langfuse per region for "no third-party LLM observability" customers is possible but not yet automated. | Deferred — document opt-out path |

---

## Compliance surfaces

- `project_retention_policies` — per-project data retention with `legal_hold` support
- `data_subject_requests` — GDPR/CCPA DSR tracking
- `soc2_evidence` — daily snapshots of CC6.1, CC7.2, A1.2 controls
- `audit_logs` — all admin write actions
- `byok_audit_log` — BYOK key add/rotate/remove/use events per project
