/**
 * Guards for `vault://<name>` references kept in settings rows.
 *
 * Vault secrets are read by name with the service role (vault_get_secret /
 * vault_lookup), so whoever picks the name picks the secret. The server must
 * mint every name itself, under the caller's own project or org. A request
 * body value that already starts with `vault://` is therefore refused:
 * storing it verbatim let one tenant point its settings at another tenant's
 * secret, which the health probes then sent to a host the tenant chose
 * (security pass 2026-09-23). The settings GETs mask secret fields, so no
 * legitimate client ever sends a reference back.
 */

export const VAULT_REF_PREFIX = 'vault://'

/** True for any string that would be dereferenced as a Vault reference. */
export function isVaultRef(value: unknown): value is string {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith(VAULT_REF_PREFIX)
}

/** Name prefix for one project's bring-your-own-storage secrets. */
export function storageSecretPrefix(projectId: string): string {
  return `mushi/storage/${projectId}/`
}

/**
 * True when a storage secret reference (bare name or `vault://` form) names a
 * secret under the project's own prefix.
 */
export function isProjectStorageSecretRef(ref: string, projectId: string): boolean {
  const trimmed = ref.trim()
  const name = trimmed.toLowerCase().startsWith(VAULT_REF_PREFIX)
    ? trimmed.slice(VAULT_REF_PREFIX.length)
    : trimmed
  const prefix = storageSecretPrefix(projectId)
  return name.startsWith(prefix) && name.length > prefix.length && !name.includes('..')
}
