# Storage

Source: https://kensaur.us/mushi-mushi/docs/admin/storage

---
title: Storage
description: The Storage view in the Mushi Mushi console chooses where report screenshots and attachments are kept, managed storage or your own bucket, per project.
---

# Storage

**Route:** `/team?view=storage` (**Team → Storage**; the old `/storage` address redirects there)

The Storage view configures where Mushi Mushi writes report screenshots and attachments.
By default it uses managed Supabase storage. You can switch to your own bucket for
data-residency or cost reasons. The view has three tabs: **Overview**, **Configure** and
**Usage** (objects and last write per project).

---

## Providers

| Provider | Notes |
|----------|-------|
| **Supabase Storage** (default) | Managed, no configuration required. |
| **AWS S3** | Needs a bucket, a region, and an access key ID + secret access key. |
| **Cloudflare R2** | Needs a bucket and an R2 access key ID + secret; region `auto` or blank. |
| **Google Cloud Storage** | Needs a bucket and a service-account key (JSON). |
| **MinIO (self-hosted)** | Needs an endpoint URL and an access key ID + secret. |

---

## Configuring a custom bucket

Each project has its own storage config card. The card shows:
- **Health status chip** with the last-check time
- **Last error** if the previous check failed
- **Show debug log**: a toggle that reveals the per-step results of the last health check

To configure:

1. Choose a **Provider** from the dropdown.
2. Fill in the required fields for your provider (see table below).
3. Click **Save & enable** (first save) or **Save** (later changes).
4. Click **Health check** to confirm Mushi Mushi can write to the bucket. Health check needs a saved configuration.

| Field | Required for |
|-------|-------------|
| **Bucket** | S3, R2, GCS, MinIO |
| **Region** | S3 (e.g. `us-east-1`); R2 takes `auto` or blank |
| **Endpoint (S3-compatible only)** | MinIO; must be a public https URL |
| **Path prefix** | All providers (optional subfolder) |
| **Signed URL TTL (seconds)** | All providers |
| **Access key ID** | S3, R2, MinIO |
| **Secret access key** | S3, R2, MinIO |
| **GCS service-account key (JSON)** | GCS |
| **KMS Key ID (optional)** | Server-side encryption |
| **Use signed URLs** | Checkbox: serve uploads via short-lived links |
| **Require encryption** | Checkbox: reject uploads without server-side encryption |

Paste the keys themselves. Mushi Mushi stores them in Supabase Vault under names tied to
the project; the API refuses a Vault name you type (`VAULT_REF_NOT_ALLOWED`). When a key
is saved, its field reads "Saved" and a new value replaces it.

The form blocks **Save** until the provider's required fields are filled: a region for
S3, an endpoint for MinIO, the key pair for S3, R2 and MinIO, and the JSON key for GCS.
These checks run in the console, not on the server.

Storage settings are per-project. Different projects can use different providers.

---

## Required IAM permissions (S3)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::YOUR_BUCKET", "arn:aws:s3:::YOUR_BUCKET/*"]
    }
  ]
}
```

---

## Required R2 permissions

Create an R2 API token with **Object Read & Write** scope scoped to the target bucket.

---

## Required GCS permissions

Attach the `roles/storage.objectAdmin` role to your service account, scoped to the bucket.

---

## Data residency

For data-residency requirements, use a bucket in the same region as your Supabase instance.
See [Security → Data residency](/security/data-residency) for the full matrix.

---

## Related pages

- [Security → BYO storage](/security/byo-storage): architecture and encryption details
- [Settings](/admin/settings): other project configuration
