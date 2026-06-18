/**
 * FILE: packages/server/supabase/functions/_shared/end-user-identity.ts
 * PURPOSE: Verify the signed end-user identity JWT the SDK forwards
 *          (X-Mushi-User-Token) and resolve it to an `end_users` row.
 *
 * Trust model: the host app's server mints an HS256 JWT signed with the
 * project's identity secret (stored in Vault, referenced by
 * project_settings.assistant_identity_secret_ref). The SDK forwards it
 * verbatim. We verify the signature here — only verified claims are ever
 * trusted for "My Reports", rewards, and the per-user assistant data index.
 *
 * Raw PII never lands at rest: only a SHA-256 email_hash + display_name are
 * stored, matching the existing rewards-program contract.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('end-user-identity')

export const MUSHI_USER_TOKEN_HEADER = 'X-Mushi-User-Token'

export interface VerifiedEndUser {
  /** end_users.id (Mushi internal). */
  endUserId: string
  /** The host app's id for this user (end_users.external_user_id). */
  externalUserId: string
  organizationId: string
  email?: string
  name?: string
}

interface IdentityClaims {
  projectId?: string
  sub?: string
  email?: string
  name?: string
  iat?: number
  exp?: number
}

function base64UrlToBytes(segment: string): Uint8Array {
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4))
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function base64UrlToString(segment: string): string {
  return new TextDecoder().decode(base64UrlToBytes(segment))
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Constant-time compare of two equal-length byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Load the project's identity secret from Vault (null if not configured). */
async function loadIdentitySecret(db: SupabaseClient, projectId: string): Promise<string | null> {
  const { data: settings } = await db
    .from('project_settings')
    .select('assistant_identity_secret_ref')
    .eq('project_id', projectId)
    .maybeSingle()
  const ref = (settings as { assistant_identity_secret_ref?: string } | null)?.assistant_identity_secret_ref
  if (!ref) return null
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: ref })
  if (error || !data) {
    log.warn('identity_secret_load_failed', { projectId, error: error?.message })
    return null
  }
  return typeof data === 'string' ? data : null
}

async function verifyHs256(token: string, secret: string): Promise<IdentityClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts

  let header: { alg?: string; typ?: string }
  try {
    header = JSON.parse(base64UrlToString(headerB64))
  } catch {
    return null
  }
  if (header.alg !== 'HS256') return null

  let provided: Uint8Array
  try {
    provided = base64UrlToBytes(sigB64)
  } catch {
    // Malformed base64url signature segment — treat as a failed verification
    // rather than throwing, so every malformed token is fail-closed (null).
    return null
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${headerB64}.${payloadB64}`)),
  )
  if (!timingSafeEqual(expected, provided)) return null

  try {
    return JSON.parse(base64UrlToString(payloadB64)) as IdentityClaims
  } catch {
    return null
  }
}

/**
 * Verify the forwarded identity token for an authenticated SDK request and
 * upsert the matching end_users row. Returns null when no token is present,
 * the project has no identity secret configured, or verification fails.
 *
 * @param projectId  internal projects.id resolved by apiKeyAuth
 */
export async function verifyEndUserToken(
  db: SupabaseClient,
  projectId: string,
  rawToken: string | null | undefined,
): Promise<VerifiedEndUser | null> {
  if (!rawToken) return null

  const secret = await loadIdentitySecret(db, projectId)
  if (!secret) return null

  const claims = await verifyHs256(rawToken, secret)
  if (!claims || !claims.sub) return null

  // Expiry (required for safety).
  const now = Math.floor(Date.now() / 1000)
  if (typeof claims.exp !== 'number' || claims.exp < now) {
    log.warn('identity_token_expired', { projectId })
    return null
  }

  // If the token names a project, it must match the authenticated one.
  if (claims.projectId && claims.projectId !== projectId) {
    log.warn('identity_token_project_mismatch', { projectId, tokenProject: claims.projectId })
    return null
  }

  // Resolve the org for this project (end_users is org-scoped).
  const { data: project } = await db
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .maybeSingle()
  const organizationId = (project as { organization_id?: string } | null)?.organization_id
  if (!organizationId) {
    log.warn('identity_no_org', { projectId })
    return null
  }

  const emailHash = claims.email ? await sha256Hex(claims.email.trim().toLowerCase()) : null

  const { data: upserted, error } = await db
    .from('end_users')
    .upsert(
      {
        organization_id: organizationId,
        external_user_id: claims.sub,
        ...(emailHash ? { email_hash: emailHash } : {}),
        ...(claims.name ? { display_name: claims.name } : {}),
        jwt_provider: 'mushi',
        jwt_subject: claims.sub,
        jwt_verified_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,external_user_id' },
    )
    .select('id')
    .single()

  if (error || !upserted) {
    log.warn('end_user_upsert_failed', { projectId, error: error?.message })
    return null
  }

  return {
    endUserId: (upserted as { id: string }).id,
    externalUserId: claims.sub,
    organizationId,
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.name ? { name: claims.name } : {}),
  }
}
