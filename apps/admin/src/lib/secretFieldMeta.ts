/**
 * Display hints for configured secrets — prefixes and normalizers shared
 * across Settings, Integrations, and other admin surfaces.
 */

import { formatConfiguredKeyHint, maskSecret } from '../components/ConfiguredSecretField'

/** Known prefix when the server only returns vault:// or no hint. */
export const SECRET_FIELD_PREFIX: Record<string, string> = {
  sentry_auth_token_ref: 'sntrys_',
  sentry_webhook_secret: 'whsec_',
  langfuse_public_key_ref: 'pk-lf-',
  langfuse_secret_key_ref: 'sk-lf-',
  github_installation_token_ref: 'ghs_',
  github_webhook_secret: 'whsec_',
  github_deploy_key: 'ssh-ed25519 ',
  apiToken: 'ATATT',
  apiKey: 'lin_api_',
  token: 'ghp_',
  routingKey: 'routing_',
  anthropic: 'sk-ant-api03-',
  openai: 'sk-',
  firecrawl: 'fc-',
}

export function isSecretConfigured(value: unknown): boolean {
  if (value == null) return false
  const s = String(value).trim()
  return s.length > 0
}

/** Turn a masked GET value, vault ref, or plaintext into a display hint. */
export function normalizeSecretHint(raw: unknown, fieldName?: string): string | null {
  if (!isSecretConfigured(raw)) return null
  const s = String(raw).trim()
  if (s.startsWith('vault://')) return null
  if (/^•+$/.test(s)) return null
  if (s.includes('…') || s.startsWith('…')) return s
  if (s.length > 12 && !s.startsWith('•')) return maskSecret(s)
  return formatConfiguredKeyHint(s, fieldName ? SECRET_FIELD_PREFIX[fieldName] : undefined)
}

export function secretFallbackPrefix(fieldName: string): string | undefined {
  return SECRET_FIELD_PREFIX[fieldName]
}
