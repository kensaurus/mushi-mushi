/**
 * Bring-your-own-storage credentials: the console sends the raw key, the
 * server stores it in Vault under the project's own prefix and keeps only the
 * name.
 *
 * The /storage form used to ask for a "Vault ref" and suggested names like
 * `mushi_s3_access_key_<project>`, but the PUT only accepts names under
 * `mushi/storage/<projectId>/` and no console screen could create one, so S3,
 * R2, GCS and MinIO could not be configured at all (QA 2026-10-04). This is
 * the same pattern settings secrets use: the server mints every Vault name.
 */

import { storageSecretPrefix } from './vault-ref.ts'

/** Raw body field → the `project_storage_settings` ref column it fills. */
export const STORAGE_RAW_SECRET_FIELDS = {
  access_key: { refColumn: 'access_key_vault_ref', name: 'access_key' },
  secret_key: { refColumn: 'secret_key_vault_ref', name: 'secret_key' },
  service_account_json: { refColumn: 'service_account_vault_ref', name: 'service_account' },
} as const

export type StorageRawSecretField = keyof typeof STORAGE_RAW_SECRET_FIELDS

const MAX_SECRET_LENGTH = 16_384

// deno-lint-ignore no-explicit-any
type Db = { rpc: (fn: string, args: Record<string, unknown>) => any }

/**
 * Store every raw secret in `body` and return the ref columns to write.
 * Blank / missing fields are skipped (the saved secret stays). Returns an
 * error for a non-string or oversized value, or when Vault refuses the write;
 * a raw secret is never written to the settings row.
 */
export async function storeStorageSecrets(
  db: Db,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; refs: Record<string, string> } | { ok: false; code: string; message: string; status: 400 | 500 }> {
  const refs: Record<string, string> = {}
  for (const [field, spec] of Object.entries(STORAGE_RAW_SECRET_FIELDS)) {
    const raw = body[field]
    if (raw == null || raw === '') continue
    if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_SECRET_LENGTH) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Paste the key exactly as your storage provider shows it.',
        status: 400,
      }
    }
    const name = `${storageSecretPrefix(projectId)}${spec.name}`
    // No p_project_id: that argument enforces a `mushi_<pid>_` prefix, while
    // storage reads (vault-ref.ts) only accept `mushi/storage/<pid>/…`.
    const { error } = await db.rpc('vault_store_secret', { secret_name: name, secret_value: raw.trim() })
    if (error) {
      return {
        ok: false,
        code: 'DB_ERROR',
        message: 'Could not store the key securely. Retry in a moment.',
        status: 500,
      }
    }
    refs[spec.refColumn] = name
  }
  return { ok: true, refs }
}
