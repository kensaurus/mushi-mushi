/**
 * FILE: packages/server/supabase/functions/_shared/routing-secrets.ts
 * PURPOSE: Keep routing-destination credentials (Jira, Linear, GitHub Issues,
 *          PagerDuty) in Vault. `project_integrations.config` used to hold the
 *          API tokens exactly as typed; they were only masked on read. Now the
 *          write path stores each secret in Vault and keeps a `vault://` ref in
 *          the config, and every reader resolves the refs before it calls the
 *          provider. A value that is not a ref (rows written before this) still
 *          reads as-is, so nothing breaks before a token is re-saved.
 */

import { dereferenceMaybeVault, storeSettingsSecret } from './settings-secrets.ts'
import { VAULT_REF_PREFIX } from './vault-ref.ts'

type VaultClient = Parameters<typeof storeSettingsSecret>[0]

/** Config keys that hold a credential (same heuristic the GET mask uses). */
export function isSecretRoutingKey(key: string): boolean {
  const lower = key.toLowerCase()
  return (
    lower.endsWith('token') ||
    lower.endsWith('apikey') ||
    lower.endsWith('secret') ||
    lower.endsWith('key') ||
    lower === 'routingkey'
  )
}

/**
 * Move every plaintext secret in `config` into Vault and return the config
 * with `vault://` refs in their place. Throws when Vault refuses a write, so
 * the caller fails the request instead of storing the raw token.
 */
export async function vaultRoutingSecrets(
  db: VaultClient,
  projectId: string,
  integrationType: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...config }
  for (const [key, value] of Object.entries(config)) {
    if (!isSecretRoutingKey(key) || typeof value !== 'string' || value.length === 0) continue
    if (value.startsWith(VAULT_REF_PREFIX)) continue
    out[key] = await storeSettingsSecret(db, projectId, `routing_${integrationType}`, key, value)
  }
  return out
}

/** Resolve `vault://` refs in a routing config before calling the provider. */
export async function resolveRoutingSecrets(
  db: Parameters<typeof dereferenceMaybeVault>[0],
  config: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...(config ?? {}) }
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string' && value.startsWith(VAULT_REF_PREFIX)) {
      out[key] = await dereferenceMaybeVault(db, value)
    }
  }
  return out
}
