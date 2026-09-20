# Security & compliance

Source: https://kensaur.us/mushi-mushi/docs/security

---
title: Security & compliance
description: How Mushi Mushi protects bug-report data — residency, bring-your-own keys and storage, retention sweeps, nightly RLS coverage, prompt-injection defence, SOC 2 readiness, status page, and how to report a vulnerability.
---

# Security & compliance

Mushi handles raw bug reports — screenshots, console output, sometimes a
user's email. This page is the one-screen summary for whoever has to sign off
on that. Every row links to the page with the mechanism and the evidence.

  **Short version.** Your data is scoped to your project by row-level security
  on every table, you can run diagnoses on your own model keys and keep
  screenshots in your own bucket, old reports are hard-deleted on your plan's
  schedule, and the controls are checked by cron, not by promise. Mushi is
  **SOC 2 ready, not SOC 2 certified** — see the last row.

## Posture at a glance

| Control | What it means for you | Status | Details |
| --- | --- | --- | --- |
| **Data residency** | Pick a region at project creation; rows never replicate across regions | Live: single Tokyo (`ap-northeast-1`) cluster today. EU / JP dedicated clusters reserved, nightly no-cross-region attestation already runs | [Data residency](/security/data-residency) |
| **Bring-your-own-key (BYOK)** | Diagnoses run against *your* Anthropic / OpenAI / OpenRouter account. Keys are stored in Vault, never shown back in plaintext, and nothing is billed to Mushi's provider account | Live | [BYOK](/security/byok) |
| **BYO storage** | Screenshots and crash dumps pinned to your own S3 / R2 / GCS / MinIO bucket; URLs signed server-side | Live | [BYO storage](/security/byo-storage) |
| **Retention sweep** | Reports older than your plan window (Free 7 d · Indie 30 d · Pro 90 d · Enterprise custom) or your per-project policy are hard-deleted daily; legal holds are skipped | Live, daily 03:00 UTC | [SOC 2 → retention](/security/soc2#data-retention-policies) |
| **Tenant isolation** | Every table carries a row-level-security policy keyed on `(SELECT auth.uid())`; every policy column is indexed | Live | [No client data leakage](/security/no-leakage-claim) |
| **Nightly RLS coverage check** | `mushi_rls_coverage_snapshot()` verifies each public table still has a policy and writes the delta to the evidence table | Live, nightly | [SOC 2 → automated controls](/security/soc2#automated-controls) |
| **Prompt-injection sanitizer** | Report text, console lines, OCR output, and screenshots pass `sanitizeForLLM()` and a vision-safe path before any model sees them; the OWASP LLM01 corpus runs in CI | Live | [Prompt-injection defence](/security/prompt-injection) |
| **Encryption** | TLS 1.2+ in transit; disk encryption at rest; PII columns (`reporter_email`, `reporter_name`, `screenshot_url`) additionally encrypted with `pgsodium` | Live | [SOC 2 readiness](/security/soc2) |
| **Audit log** | Append-only `audit_log` of who did what, per user, under RLS | Live | [SOC 2 readiness](/security/soc2) |
| **DSAR tooling** | One SQL call produces a signed export per reporter for data-subject requests | Live | [SOC 2 → DSAR](/security/soc2#dsar-data-subject-access-request) |
| **SOC 2** | **Readiness, not certification.** The evidence pack, RLS and retention attestations, and the audit log are generated and refreshed automatically so an auditor has what they need. No third-party audit has been performed | Readiness live · certification not started | [SOC 2 readiness](/security/soc2) |

## Operational transparency

- **Status page:** [updown.io/p/b6lod](https://updown.io/p/b6lod) — live
  availability and history for the ingest API, hosted MCP, console, and docs.
  What is monitored and the uptime commitment per plan are on
  [Status & uptime](/operating/status).
- **Open source:** the server that enforces all of the above is
  [public](https://github.com/kensaurus/mushi-mushi) under AGPLv3, so the
  policies, the cron jobs, and the tests can be read rather than trusted.
- **Sub-processors, retention table, and your rights:** on the
  [Privacy Policy](/legal/privacy).

## Report a vulnerability

Please do not open a public issue. Use either channel:

1. **GitHub private vulnerability reporting** (preferred):
   [github.com/kensaurus/mushi-mushi/security/advisories/new](https://github.com/kensaurus/mushi-mushi/security/advisories/new)
2. **Email:** [kensaurus@gmail.com](mailto:kensaurus@gmail.com), subject
   prefix `[mushi-security]`

Acknowledgement within 2 days, triage within 7, and a fix for critical and
high findings within 30. The full timeline, safe-harbor terms, and what to
include are in
[SECURITY.md](https://github.com/kensaurus/mushi-mushi/blob/master/SECURITY.md).

## What we do not claim

- No SOC 2 Type 1 or Type 2 report exists yet.
- Dedicated EU and JP clusters are not live; the region setting is honoured
  by the attestation but all rows sit in Tokyo today.
- Prompt-injection defences reduce risk; they do not make model output safe to
  merge unreviewed. Keep the fix agent on draft PRs.

The deeper pages: [BYOK](/security/byok) · [Data residency](/security/data-residency) ·
[BYO storage](/security/byo-storage) · [SOC 2 readiness](/security/soc2) ·
[Prompt-injection defence](/security/prompt-injection) ·
[No client data leakage](/security/no-leakage-claim)
