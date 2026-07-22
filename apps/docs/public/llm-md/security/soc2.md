# SOC 2 readiness

Source: https://kensaur.us/mushi-mushi/docs/security/soc2

---
title: SOC 2 readiness
---

# SOC 2 readiness

> **Scenario:** Your enterprise customer's procurement team asks for a SOC 2 Type 1 evidence pack. You need to prove that access, retention, and encryption controls are documented and enforced.

Mushi ships a SOC 2 Type 1 readiness module. It is not a third-party certification on its own — but it generates the evidence auditors need and keeps it current automatically.

  All evidence is visible in the admin console at **Compliance → SOC 2**. A single button regenerates the quarterly pack on demand.

## Automated controls

| Control | Mechanism | Frequency |
| --- | --- | --- |
| Access — who / what / when | `audit_log` table, append-only, RLS per user | Real-time |
| RLS policy coverage | `mushi_rls_coverage_snapshot()` — verifies every public table has at least one policy | Daily cron |
| Data retention | `data_retention_policies` per project; nightly hard-delete cron | Nightly |
| DSAR (data subject access) | `request_dsar()` SQL fn → signed tarball URL | On-demand |
| Evidence pack | `soc2-evidence` Edge Function → quarterly snapshot in `soc2_evidence` | Quarterly + on-demand |
| Encryption-in-transit | TLS 1.2+ enforced by Supabase edge | Always |
| Encryption-at-rest | `pgsodium` for PII columns; Supabase disk encryption for all storage | Always |
| Backup / DR | Supabase point-in-time recovery | Daily |
| No cross-region row transfer | Nightly attestation written to `soc2_evidence` | Nightly |

## Audit dashboard

In the admin console: **Compliance → SOC 2**.

- **Evidence pack** — last generated date, size, download link (signed URL, 24h TTL).
- **RLS coverage delta** — lists any table where coverage changed since the last snapshot.
- **Retention cron status** — last run, rows deleted, next scheduled run.
- **DSAR requests** — list of pending requests with a one-click "generate tarball" action.

## Generating an evidence pack manually

Click **Regenerate** in the admin console under **Compliance → SOC 2**, or trigger the edge function directly:

```bash
# Trigger via the admin API (requires a service-role or admin-scoped key)
curl -X POST https://<your-project>.supabase.co/functions/v1/soc2-evidence \
  -H "Authorization: Bearer <service-role-key>"
```

The new pack appears in `soc2_evidence` within ~30 seconds.

## Data retention policies

Retention is configured per project in **Compliance → Data retention**:

| Column | Default | Notes |
| --- | --- | --- |
| `reports` | 365 days | Configurable; 0 = keep forever |
| `fix_attempts` | 180 days | — |
| `embeddings` | 365 days | — |
| `audit_log` | 2555 days (7 years) | Not configurable — required for SOC 2 |

The nightly cron hard-deletes rows older than the configured window and logs the count to `soc2_evidence`.

## DSAR (Data Subject Access Request)

Submit a DSAR via the admin API:

```bash
curl -X POST https://<your-project>.supabase.co/functions/v1/api/v1/admin/dsar \
  -H "Authorization: Bearer <admin-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
# Returns a signed URL to a tarball of all rows referencing that email.
```

The tarball includes: `reports`, `reporter_identities`, `activity_events`, `audit_log` rows where `actor_email = ?`. PII columns are decrypted in the export (the tarball itself is signed and expires in 48 hours).
