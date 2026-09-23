/**
 * Request-body checks for integration settings and routing configs
 * (api/routes/integrations.ts). Pure, so the rules are unit-tested without
 * loading the route module.
 */
import { isVaultRef } from './vault-ref.ts'
import { assertSafeOutboundUrl } from './inventory-guards.ts'

export type BodyError = { code: string; message: string }

// Tenant-set hosts the server later calls with credentials attached.
const PLATFORM_URL_FIELDS = new Set(['langfuse_host'])
const ROUTING_URL_FIELDS = new Set(['baseUrl', 'base_url', 'url', 'webhookUrl', 'webhook_url'])
const GITHUB_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/

function vaultRefError(field: string): BodyError {
  return {
    code: 'VAULT_REF_NOT_ALLOWED',
    message: `${field}: paste the secret itself. Mushi stores it in Vault and keeps the reference.`,
  }
}

function unsafeUrlError(field: string, reason: string): BodyError {
  return { code: 'UNSAFE_URL', message: `${field} must be a public https URL (${reason}).` }
}

/**
 * Shapes a settings body must never carry: a `vault://` reference (the server
 * mints those, see vault-ref.ts) or an outbound URL that is not public https.
 */
export function validatePlatformBody(body: Record<string, unknown>): BodyError | null {
  for (const [k, v] of Object.entries(body)) {
    if (isVaultRef(v)) return vaultRefError(k)
    if (PLATFORM_URL_FIELDS.has(k) && typeof v === 'string' && v.trim() !== '') {
      const safe = assertSafeOutboundUrl(v.trim())
      if (!safe.ok) return unsafeUrlError(k, safe.reason)
    }
  }
  return null
}

/** Same rules for a routing provider's config, plus plain GitHub names. */
export function validateRoutingConfig(type: string, config: Record<string, unknown>): BodyError | null {
  for (const [k, v] of Object.entries(config)) {
    if (isVaultRef(v)) return vaultRefError(k)
    if (ROUTING_URL_FIELDS.has(k) && typeof v === 'string' && v.trim() !== '') {
      const safe = assertSafeOutboundUrl(v.trim())
      if (!safe.ok) return unsafeUrlError(k, safe.reason)
    }
  }
  if (type === 'github') {
    // "owner/repo" in `repo` would also match the push-routing lookup in
    // webhooks-github-indexer for someone else's repository.
    for (const k of ['owner', 'repo']) {
      const v = config[k]
      if (v == null || v === '') continue
      if (typeof v !== 'string' || !GITHUB_NAME_RE.test(v)) {
        return { code: 'VALIDATION_ERROR', message: `${k} must be a plain GitHub name without "/".` }
      }
    }
  }
  return null
}
