# BYO storage

Source: https://kensaur.us/mushi-mushi/docs/security/byo-storage

---
title: BYO storage
---

# Bring-your-own storage

> **Scenario:** Your company policy requires all user screenshots to stay inside your own AWS account, not a third-party storage bucket.

By default screenshots and crash dumps go to a Mushi-managed Supabase Storage bucket. BYO storage lets you pin them to your own bucket instead — credentials live in Vault, URLs are signed server-side, and the admin console renders identically regardless of backend.

## Supported backends

| Backend | Notes |
| --- | --- |
| **AWS S3** | Standard `accessKeyId` / `secretAccessKey` / `region` / `bucket` |
| **Cloudflare R2** | S3-compatible; set `endpoint` + `region = auto` |
| **Google Cloud Storage** | HMAC key pair (`accessKeyId` + `secretAccessKey` from the GCS interoperability page) + `bucket` |
| **MinIO (self-hosted)** | Path-style addressing; set a custom `endpoint` |
| **Supabase Storage** | Default — no configuration needed |

## Setup

In the admin console: **Settings → Storage**.

  **Required fields:** `bucket` and `region` are required for S3, Cloudflare R2, and GCS. Submitting without them returns a `400 VALIDATION_ERROR`. Region for Cloudflare R2 should be `auto`.

1. Select your provider from the dropdown.
2. Fill in the required fields:
   - **S3 / R2 / GCS:** `bucket` (exact name) + `region` + `accessKeyId` + `secretAccessKey`
   - **MinIO:** `endpoint` (e.g. `https://minio.internal`) + `bucket` + `region` + credentials
3. Click **Save**. Credentials are written to Supabase Vault and never echoed back.

## What moves (and what doesn't)

- **New reports** ingested after the switch land in your bucket.
- **Existing reports** stay in the Mushi-managed bucket — they are not migrated automatically.
- Edge Functions sign all presigned URLs server-side, so the admin console renders screenshots from either location transparently.

## Health check

**Settings → Health** runs a probe against your configured bucket (a zero-byte `PUT` + `DELETE` to `mushi-health-probe`) and shows `ok` / `degraded` / `error`. If the probe fails, screenshots will fall back to the Mushi-managed bucket and a warning chip appears on the Storage card.

## Permissions required

| Backend | Minimum IAM / policy |
| --- | --- |
| AWS S3 | `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::your-bucket/*` |
| Cloudflare R2 | Object Read, Object Write on the bucket |
| GCS | `storage.objects.create`, `storage.objects.get`, `storage.objects.delete` on the bucket |
