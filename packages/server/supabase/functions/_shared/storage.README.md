# BYO Storage

The `storage.ts` module provides a single `StorageAdapter` interface across
five backends:

| Provider   | Use case                                    | Auth                        |
| ---------- | ------------------------------------------- | --------------------------- |
| `supabase` | Default; cluster-managed Supabase Storage   | Service-role key (built-in) |
| `s3`       | AWS S3                                      | SigV4 access/secret keys    |
| `r2`       | Cloudflare R2                               | SigV4 access/secret keys    |
| `gcs`      | Google Cloud Storage                        | Service-account JSON        |
| `minio`    | Self-hosted S3-compatible                   | SigV4 access/secret keys    |

## Why an abstraction?

The whitepaper promises customers can keep binary artifacts inside their own
cloud accounts (AWS/GCP/CF) rather than sending them to Supabase. This module
makes that real without forcing every Edge Function to know about five
different SDKs.

Critical properties:

- **Default-safe**: missing config falls back to Supabase, so report ingest
  never breaks because of a misconfigured BYO bucket.
- **Vault-only secrets**: raw keys are never persisted in `project_storage_settings`;
  only Supabase Vault references. Resolved via the `vault_lookup` SECURITY
  DEFINER helper.
- **Zero-dep**: SigV4 and JWT-RS256 implemented inline using Web Crypto so
  cold-start stays under 50ms even on the busiest region.
- **Healthcheck**: `POST /v1/admin/storage/:projectId/health` round-trips a
  small probe object to validate credentials before flipping production
  uploads to a new backend.

## Adding credentials

1. Store the secret in Supabase Vault:
   ```sql
   INSERT INTO vault.secrets (name, secret)
   VALUES ('mushi_s3_access_key_acme', 'AKIA...');
   ```
2. Reference it from the admin **Storage** page:
   - `Access key Vault ref` → `mushi_s3_access_key_acme`
   - `Secret key Vault ref` → `mushi_s3_secret_key_acme`
3. Click **Health check**. The result is persisted in
   `project_storage_settings.health_status` and surfaced as a chip in the UI.

## Path layout

The canonical storage path stored on `reports.screenshot_path` is now a
URI of the form:

```
storage://<provider>/<bucket>/<path>
```

This lets downstream consumers (the admin UI, the LLM judge, intelligence
reports) re-fetch the artifact through the right adapter without parsing
provider-specific URL formats.
