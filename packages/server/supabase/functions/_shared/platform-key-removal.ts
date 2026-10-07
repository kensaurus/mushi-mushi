/**
 * FILE: packages/server/supabase/functions/_shared/platform-key-removal.ts
 * PURPOSE: "Remove key" on a platform integration card (Sentry, Langfuse,
 *          GitHub, Cursor Cloud, Claude Code): clear the secret fields this
 *          project stores, then delete their Vault secrets when it is safe.
 *
 * A Vault secret is deleted only when (a) its ref is exactly the name the
 * project PUT writes for this project, kind and field, and (b) no other
 * project's row points at the same ref. Bulk "apply to all projects" copies a
 * ref verbatim when it cannot read the secret, so another project can share
 * it; deleting it then would silently break that project. Such a secret is
 * left in Vault (orphaned, harmless) and reported as kept.
 */

/** The name PUT /v1/admin/integrations/platform/:kind stores a secret under. */
function platformSecretName(projectId: string, kind: string, field: string): string {
  return `mushi/integration/${projectId}/${kind}/${field}`
}

/** The Vault secret name to delete for `ref`, or null when it is not this project's own. */
function ownPlatformSecretName(
  ref: unknown,
  projectId: string,
  kind: string,
  field: string,
): string | null {
  if (typeof ref !== 'string') return null
  const name = platformSecretName(projectId, kind, field)
  return ref === `vault://${name}` ? name : null
}

/** Storage operations the removal needs; the route binds them to Supabase. */
export interface PlatformKeyStore {
  /** The project's current values for `fields` (null row = no settings yet). */
  readFields(fields: readonly string[]): Promise<{ row: Record<string, unknown> | null; error: string | null }>
  /** Set `fields` to null on the project's row. Returns an error message or null. */
  clearFields(fields: readonly string[]): Promise<string | null>
  /** True when another project's row stores the same ref in `field`. */
  refUsedElsewhere(field: string, ref: string): Promise<boolean>
  /** Delete a Vault secret by name. Returns an error message or null. */
  deleteVaultSecret(name: string): Promise<string | null>
}

interface PlatformKeyRemoval {
  /** Fields that held a value and are now null. */
  cleared: string[]
  /** Vault secrets deleted. */
  deletedSecrets: string[]
  /** Vault secrets left in place (shared with another project, or delete failed). */
  keptSecrets: string[]
  error: string | null
}

export async function removePlatformKeys(
  store: PlatformKeyStore,
  input: { projectId: string; kind: string; fields: readonly string[] },
): Promise<PlatformKeyRemoval> {
  const result: PlatformKeyRemoval = { cleared: [], deletedSecrets: [], keptSecrets: [], error: null }
  const { row, error: readError } = await store.readFields(input.fields)
  if (readError) return { ...result, error: readError }
  const set = input.fields.filter((f) => row?.[f] != null && row[f] !== '')
  if (set.length === 0) return result

  // Row first: once it is null nothing reads the secret, so a failed Vault
  // delete below leaves an orphan, never a dangling ref.
  const clearError = await store.clearFields(set)
  if (clearError) return { ...result, error: clearError }
  result.cleared = set

  for (const field of set) {
    const ref = row?.[field]
    const name = ownPlatformSecretName(ref, input.projectId, input.kind, field)
    if (!name) continue
    if (await store.refUsedElsewhere(field, ref as string)) {
      result.keptSecrets.push(name)
      continue
    }
    const deleteError = await store.deleteVaultSecret(name)
    if (deleteError) result.keptSecrets.push(name)
    else result.deletedSecrets.push(name)
  }
  return result
}
