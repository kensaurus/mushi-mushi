/**
 * FILE: _shared/voice-confirm-listing.ts
 * PURPOSE: Let the console's "Recent voice requests" list confirm or cancel a
 *          request that is still waiting, after a reload or when it came in
 *          through Telegram, Slack or a Shortcut.
 *
 * The confirm token is never stored (only its SHA-256 is), but it is a
 * deterministic HMAC of the session's stored binding (voice-intent.ts
 * `mintConfirmToken`), so the server can mint it again. It is handed out only:
 *   - to a signed-in console user (JWT) who can edit the project — never to an
 *     API key, so an `mcp:read` key cannot pick up a dispatch capability, and
 *     never to a viewer;
 *   - for a session still `awaiting_confirm`, unexpired, whose stored hash
 *     matches the re-minted token (the gate would refuse anything else).
 *
 * Imported only by api/routes/intake-voice.ts.
 */

import { constantTimeEqualStrings, mintConfirmToken, sha256Hex, type VoiceAction } from './voice-intent.ts'

export interface VoiceGateRow {
  id: string
  status: string
  action: string | null
  transcript_sha256: string | null
  confirm_token_hash: string | null
  expires_at: string | null
}

export interface VoiceListCaller {
  authMethod: string | undefined
  /** organization_role from resolveOwnedProject; null when unknown. */
  role: string | null | undefined
}

/** Console users who can edit the project. API keys and viewers never. */
export function callerMayConfirmFromList(caller: VoiceListCaller): boolean {
  if (caller.authMethod !== 'jwt') return false
  return caller.role === 'owner' || caller.role === 'admin' || caller.role === 'member'
}

/** The token the confirm gate will accept for this row, or null. */
export async function confirmTokenForListing(row: VoiceGateRow, now = Date.now()): Promise<string | null> {
  if (row.status !== 'awaiting_confirm') return null
  if (!row.confirm_token_hash || !row.expires_at || !row.transcript_sha256) return null
  const expiresAt = Date.parse(row.expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null
  const token = await mintConfirmToken({
    sessionId: row.id,
    transcriptSha256: row.transcript_sha256,
    action: (row.action ?? 'open_draft_pr') as VoiceAction,
    expiresAtIso: row.expires_at,
  })
  return constantTimeEqualStrings(await sha256Hex(token), row.confirm_token_hash) ? token : null
}
