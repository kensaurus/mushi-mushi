# No client data leakage: what we promise and how we enforce it

Source: https://kensaur.us/mushi-mushi/docs/security/no-leakage-claim

---
title: "No client data leakage: what we promise and how we enforce it"
description: Explicit enumeration of Mushi Mushi's privacy boundaries, the gaps we've closed, and the controls that keep client data isolated.
---

# No client data leakage

This page is the single-source citation for the privacy claims made on the Mushi Mushi landing page. It enumerates exactly what Mushi promises, which controls enforce each promise, and which gaps have been closed or documented as follow-ups.

  **Short version:** Your reports are RLS-isolated per project. Screenshots are behind signed URLs in a private bucket. Common PII patterns are scrubbed before writing to Postgres and before the diagnosis models see a report. Code snippets reach a model only for diagnosis and fixes, and cloud coding agents work in your repo under your own account. With BYOK, model calls run on your provider account instead of ours.

---

## The three promises

### 1. Your data doesn't cross project boundaries

**Control:** Row-Level Security (RLS) is enabled on every customer-facing table. The `reports`, `fix_attempts`, `qa_story_runs`, `llm_invocations`, `byok_audit_log`, and 30+ sibling tables use `project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())` or the org-member equivalent. The `soc2-evidence` cron snapshots `mushi_rls_coverage_snapshot()` daily and records a failing CC6.1 control if a public table has RLS disabled.

**Verification:** `SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;` should return zero rows.

### 2. PII is scrubbed before it reaches Postgres or an LLM

**Control (at-rest, Wave 5 Gap A):** `scrubPii()` from `_shared/pii-scrubber.ts` is called in the ingest path (`api/helpers.ts::ingestReport`) before the `reports` row is inserted. Fields scrubbed: `description`, `user_intent`, `console_logs[].message`, `network_logs[].url` (including query parameters). Patterns cover: SSN, credit-card PAN, AWS/Stripe/Slack/GitHub/OpenAI/Anthropic keys, JWTs, IPv4, IPv6, emails, phone numbers.

**Control (client-side, at capture — SDK 1.27+):** The web and Node SDKs now scrub PII *before the report leaves the browser or server process*, so sensitive values never travel the wire in the first place. The web SDK runs `scrubUrl()` over every captured network URL and route-timeline entry; the Node SDK runs `scrubPii()` / `scrubUrl()` over `description`, `environment.url`, and `error.message` / `error.stack` in `captureReport`, the Express handler, and the trace middleware. This is the same pattern set as the server-side scrubber (shared source of truth), so client and server redact identically — the at-rest and pre-LLM scrubs below are now defence-in-depth behind it rather than the first line.

**Control (pre-LLM, defence-in-depth):** `scrubReport()` is also called in `classify-report` and `fast-filter` before building the Anthropic prompt, so even if the ingest scrub is ever bypassed the LLM never sees raw PII.

**Gap not yet closed:** `performance_metrics` and `selected_element` JSONB columns are not yet scrubbed — these fields are unlikely to contain PII but are not covered by the current scrubber. Filed as a follow-up.

### 3. Screenshots are behind signed, time-limited URLs

**Control (Wave 5 Gap B):** The default `SupabaseStorageAdapter` uses `createSignedUrl()` instead of `getPublicUrl()`, and the `screenshots` bucket is private (`public = false`). The stored URL is a signed URL, so flipping the bucket to public later would not turn old URLs into public links. Its lifetime is long (about 7 years) so screenshots keep rendering in the console for as long as the report is kept; treat a stored screenshot URL as a secret.

**BYO storage:** S3/R2/GCS/MinIO adapters use SigV4-presigned GET URLs with TTL from `project_storage_settings.signed_url_ttl_secs` (default 3600s, max 604800s).

---

## BYOK — your API keys run against your account

**What "BYOK" means:** Mushi does not train models on your bug reports. When you add your own Anthropic or OpenAI key (**Settings → AI keys**), the classify, fix and judge calls use your key and your account first. Mushi's platform key is used only for a provider where you have no key.

**What happens without BYOK:** LLM calls fall back to Mushi's platform Anthropic/OpenAI account. Your prompt content (the scrubbed bug description, code context, diff) flows through that account. This is recorded as `llm_invocations.key_source = 'env'`.

**No hard "BYOK only" switch yet (Wave 5 Gap D):** `project_settings.require_byok` exists in the schema, but no edge function reads it today, so it does not block the platform-key fallback. To keep every call on your accounts, add both an Anthropic and an OpenAI key.

**Vault encryption:** BYOK key values are stored as `vault://` references pointing to Supabase Vault (`vault.secrets`). `dereferenceKey()` in `_shared/byok.ts` rejects a raw (non-vault) key reference when the environment is `production`.

---

## Where your code goes

There are two fix paths, and they treat code differently:

- **Mushi's own `fix-worker` model call** reads your codebase through a vector index (`project_codebase_files`) built by `mushi index` or the GitHub indexer. Indexed chunks keep a short `content_preview` for the console plus an embedding for search, are RLS-isolated by `project_id`, and are deleted with the project (`ON DELETE CASCADE`). Only the retrieved snippets go into the prompt, not whole files.
- **Cloud coding agents** (Cursor, GitHub's agent) work directly in your repository under your own key or account, the same as when you run them yourself. Mushi sends them the report and its diagnosis.

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
- `soc2_evidence` — daily snapshots of the CC6.1, CC6.7, CC7.2, CC8.1 and A1.2 controls
- `audit_logs` — all admin write actions
- `byok_audit_log` — BYOK key add/rotate/remove/use events per project
