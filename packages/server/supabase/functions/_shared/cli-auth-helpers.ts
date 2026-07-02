/**
 * Pure helpers for RFC 8628 CLI device-auth — extracted for unit tests and
 * shared between route handlers.
 */

export const TOKEN_REDELIVERY_GRACE_MS = 60_000

/** Validate optional client_id from /device/start body. */
export function parseClientId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return /^[A-Za-z0-9_-]{8,64}$/.test(trimmed) ? trimmed : null
}

export type TokenDeliveryDecision =
  | { action: 'deliver'; firstClaim: boolean }
  | { action: 'invalid_grant'; reason: 'no_token' | 'grace_elapsed' }

/**
 * Decide whether an approved row may still deliver its raw CLI token to the
 * polling device_code. Mirrors the /device/token handler's on-read logic.
 */
export function evaluateTokenDelivery(
  row: { cli_token_raw: string | null; cli_token_claimed_at: string | null },
  nowMs: number,
): TokenDeliveryDecision {
  if (!row.cli_token_raw) {
    return { action: 'invalid_grant', reason: 'no_token' }
  }
  if (row.cli_token_claimed_at) {
    const claimedAtMs = new Date(row.cli_token_claimed_at).getTime()
    if (nowMs - claimedAtMs > TOKEN_REDELIVERY_GRACE_MS) {
      return { action: 'invalid_grant', reason: 'grace_elapsed' }
    }
    return { action: 'deliver', firstClaim: false }
  }
  return { action: 'deliver', firstClaim: true }
}
