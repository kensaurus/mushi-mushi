/**
 * Integration secrets kept in `project_settings` columns.
 *
 * Every secret column holds a `vault://<name>` reference, never the secret
 * itself (enforced by the `*_is_vault_ref` CHECK constraints from migration
 * 20261002170000). The name is minted by the server under the caller's own
 * project — `mushi/integration/<projectId>/<kind>/<column>` — the same name
 * PUT /v1/admin/integrations/platform/:kind uses, so every writer of a column
 * updates one Vault secret in place (vault_store_secret upserts by name).
 *
 * Readers go through `dereferenceMaybeVault`, which still accepts a raw value
 * so rows written before the data migration keep working.
 *
 * Dependency-free on purpose: Deno unit tests import it without permission
 * flags.
 */

import { isVaultRef, VAULT_REF_PREFIX } from './vault-ref.ts'

/** Minimal slice of the Supabase client the helpers need (easy to fake in tests). */
export interface VaultRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/** Deterministic Vault name for one project's settings secret. */
export function settingsSecretName(projectId: string, kind: string, column: string): string {
  return `mushi/integration/${projectId}/${kind}/${column}`
}

/**
 * Resolve a settings value to its plaintext secret. A `vault://<name>` (or
 * `vault://<uuid>`) ref is read through `vault_get_secret`; any other string
 * is a legacy raw value and is returned as-is. Null when empty or when the
 * ref cannot be read, so callers fail closed exactly as for a missing secret.
 */
export async function dereferenceMaybeVault(
  db: VaultRpcClient,
  ref: string | null,
): Promise<string | null> {
  if (!ref) return null
  if (!ref.startsWith(VAULT_REF_PREFIX)) return ref
  const id = ref.slice(VAULT_REF_PREFIX.length)
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: id })
  if (error) return null
  return typeof data === 'string' && data.length > 0 ? data : null
}

/**
 * Store `value` in Vault under the project's deterministic name and return
 * the `vault://` ref to persist. Throws when Vault refuses the write: callers
 * must fail the request rather than fall back to storing the raw value.
 */
export async function storeSettingsSecret(
  db: VaultRpcClient,
  projectId: string,
  kind: string,
  column: string,
  value: string,
): Promise<string> {
  const name = settingsSecretName(projectId, kind, column)
  const { error } = await db.rpc('vault_store_secret', { secret_name: name, secret_value: value })
  if (error) throw new Error(`vault_store_secret failed for ${column}: ${error.message}`)
  return `${VAULT_REF_PREFIX}${name}`
}

export type SecretSettingWrite =
  | { action: 'skip' }
  | { action: 'clear' }
  | { action: 'store'; value: string }
  | { action: 'reject' }

/**
 * Decide what a settings PATCH does with one secret field.
 *
 * - `null` / `''` clears the column; whitespace only is skipped.
 * - A masked hint (`…abcd`) or a value identical to the stored column is a
 *   form round-trip, not an edit: skip it. The console's General panel sends
 *   the whole settings row back, stored refs included.
 * - Any other `vault://` value is refused: refs are minted by the server only
 *   (see vault-ref.ts).
 * - Anything else is a new raw secret to store in Vault.
 */
export function planSecretSettingWrite(value: unknown, stored: string | null | undefined): SecretSettingWrite {
  if (value === null || value === '') return { action: 'clear' }
  if (typeof value !== 'string') return { action: 'skip' }
  const raw = value.trim()
  // Whitespace is an untouched input, not a request to delete the secret.
  if (!raw) return { action: 'skip' }
  if (raw.startsWith('…') && raw.length <= 6) return { action: 'skip' }
  if (stored != null && value === stored) return { action: 'skip' }
  if (isVaultRef(raw)) return { action: 'reject' }
  return { action: 'store', value: raw }
}
