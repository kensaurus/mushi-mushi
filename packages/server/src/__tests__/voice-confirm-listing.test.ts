/**
 * The console's voice list can confirm a waiting request after a reload
 * (suspected-bugs entry 114). The token is minted again from the stored binding,
 * and only for a signed-in editor, an unexpired waiting row, and a token
 * whose hash matches what the gate stored.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/llm-failover.ts', () => ({ withAnthropicOrOpenAi: vi.fn() }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = () => {}
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger }
  return { log: logger }
})
vi.mock('../../supabase/functions/_shared/observability.ts', () => ({
  createTrace: () => ({ span: () => ({ end: () => {} }), end: async () => {} }),
}))
vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({ reportLlmUsage: vi.fn() }))

type Listing = typeof import('../../supabase/functions/_shared/voice-confirm-listing.ts')
type Intent = typeof import('../../supabase/functions/_shared/voice-intent.ts')
let listing: Listing
let intent: Intent

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const SHA = 'f'.repeat(64)

beforeAll(async () => {
  process.env.MUSHI_INTERNAL_CALLER_SECRET = 'voice-test-secret-0123456789'
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  intent = await import('../../supabase/functions/_shared/voice-intent.ts')
  listing = await import('../../supabase/functions/_shared/voice-confirm-listing.ts')
})

async function waitingRow(expiresAtIso: string) {
  const token = await intent.mintConfirmToken({
    sessionId: SESSION,
    transcriptSha256: SHA,
    action: 'open_draft_pr',
    expiresAtIso,
  })
  return {
    token,
    row: {
      id: SESSION,
      status: 'awaiting_confirm',
      action: 'open_draft_pr',
      transcript_sha256: SHA,
      confirm_token_hash: await intent.sha256Hex(token),
      // Postgres hands timestamps back as +00:00, not Z; the binding is canonicalised.
      expires_at: expiresAtIso.replace('Z', '+00:00'),
    },
  }
}

describe('callerMayConfirmFromList', () => {
  it('allows signed-in owners, admins and members', () => {
    for (const role of ['owner', 'admin', 'member']) {
      expect(listing.callerMayConfirmFromList({ authMethod: 'jwt', role })).toBe(true)
    }
  })

  it('never gives a token to an API key or a viewer', () => {
    expect(listing.callerMayConfirmFromList({ authMethod: 'apiKey', role: 'owner' })).toBe(false)
    expect(listing.callerMayConfirmFromList({ authMethod: 'jwt', role: 'viewer' })).toBe(false)
    expect(listing.callerMayConfirmFromList({ authMethod: 'jwt', role: null })).toBe(false)
    expect(listing.callerMayConfirmFromList({ authMethod: undefined, role: 'owner' })).toBe(false)
  })
})

describe('confirmTokenForListing', () => {
  it('re-mints the exact token the gate verifies', async () => {
    const expires = new Date(Date.now() + 5 * 60_000).toISOString()
    const { token, row } = await waitingRow(expires)
    const minted = await listing.confirmTokenForListing(row)
    expect(minted).toBe(token)
    expect(
      await intent.verifyConfirmToken(minted, {
        sessionId: SESSION,
        transcriptSha256: SHA,
        action: 'open_draft_pr',
        expiresAtIso: row.expires_at,
      }),
    ).toBe(true)
  })

  it('returns null once the 10-minute window has passed', async () => {
    const { row } = await waitingRow(new Date(Date.now() - 1000).toISOString())
    expect(await listing.confirmTokenForListing(row)).toBeNull()
  })

  it('returns null for a request no longer waiting or whose hash was cleared', async () => {
    const { row } = await waitingRow(new Date(Date.now() + 60_000).toISOString())
    expect(await listing.confirmTokenForListing({ ...row, status: 'confirmed' })).toBeNull()
    expect(await listing.confirmTokenForListing({ ...row, confirm_token_hash: null })).toBeNull()
  })

  it('returns null when the stored hash does not match (binding changed)', async () => {
    const { row } = await waitingRow(new Date(Date.now() + 60_000).toISOString())
    expect(await listing.confirmTokenForListing({ ...row, transcript_sha256: 'e'.repeat(64) })).toBeNull()
  })
})

describe('GET /v1/intake/voice/sessions wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/intake-voice.ts'), 'utf8')
  const start = src.indexOf("app.get('/v1/intake/voice/sessions'")
  const body = src.slice(start, src.indexOf("app.get('/v1/intake/voice/:id'"))

  it('mints tokens only behind callerMayConfirmFromList with the auth method and role', () => {
    expect(body).toContain('callerMayConfirmFromList({ authMethod: c.get(\'authMethod\')')
    expect(body).toContain('role: resolved.project.organization_role')
    expect(body).toContain('confirmTokenForListing(row)')
  })

  it('reads the gate columns in their own project-scoped query', () => {
    expect(body).toContain(".select('id, status, action, transcript_sha256, confirm_token_hash, expires_at')")
    expect(body).toContain(".eq('project_id', resolved.project.id)")
  })
})
