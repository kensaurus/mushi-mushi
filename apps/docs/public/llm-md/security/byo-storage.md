# BYO storage

Source: https://kensaur.us/mushi-mushi/docs/security/byo-storage

---
title: BYO storage
description: Keep Mushi Mushi screenshots and crash dumps in your own storage bucket instead of Mushi's, with credentials in Vault and signed URLs.
---

# Bring-your-own storage

> **Scenario:** Your company policy requires all user screenshots to stay inside your own AWS account, not a third-party storage bucket.

By default screenshots and crash dumps go to a private Mushi-managed Supabase Storage bucket. BYO storage pins them to your own bucket instead: credentials live in Supabase Vault, URLs are signed server-side, and the admin console shows screenshots the same way from either backend.

## Supported backends

| Backend | Notes |
| --- | --- |
| **AWS S3** | `bucket`, `region`, access key ID and secret access key |
| **Cloudflare R2** | S3-compatible; set `endpoint` and `region = auto` |
| **Google Cloud Storage** | `bucket` and a service-account JSON key |
| **MinIO (self-hosted)** | S3-compatible; a custom `endpoint` is required |
| **Supabase Storage** | Default, no configuration needed |

## Setup

In the admin console: **BYO storage** (`/storage`).

1. Select your provider.
2. Fill in the fields for it:
   - **S3 / R2:** `bucket` (exact name) + `region` + access key ID + secret access key
   - **GCS:** `bucket` + service-account JSON
   - **MinIO:** `endpoint` (a public `https` URL, e.g. `https://minio.example.com`) + `bucket` + `region` + credentials
3. Click **Save**. Raw credentials are written to Supabase Vault; the settings row keeps only the Vault references, and the keys are never echoed back.

The bucket must already exist. Mushi never creates buckets.

## What moves (and what doesn't)

- **New reports** ingested after the switch land in your bucket.
- **Existing reports** stay in the Mushi-managed bucket; they are not migrated automatically.
- Edge Functions sign the URLs server-side. For your bucket the lifetime is `signed_url_ttl_secs` (default 3600 seconds, 60 to 604,800 allowed).

## Health check

The BYO storage page has a health check (`POST /v1/admin/storage/:projectId/health`) that uploads a small `_mushi_health_.txt` object and deletes it again. The result is stored as `healthy` or `failing` with the last error, and the page shows it. If an upload to your bucket fails, the report is still saved, without its screenshot, and the error is logged; run the health check after any credential change.

## Permissions required

| Backend | Minimum IAM / policy |
| --- | --- |
| AWS S3 | `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::your-bucket/*` |
| Cloudflare R2 | Object Read, Object Write on the bucket |
| GCS | `storage.objects.create`, `storage.objects.get`, `storage.objects.delete` on the bucket |
