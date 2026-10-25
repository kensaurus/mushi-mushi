/**
 * FILE: key-mint-refusal.test.ts
 * PURPOSE: A refused CLI/MCP key says who approved, what they are, where,
 *          and who can fix it (2026-10-24: "Owner or admin access required"
 *          left the owner guessing which account and which org).
 */
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('Deno', { env: { get: () => undefined } })
const { keyMintRefusalMessage } = await import('../../supabase/functions/api/routes/project-keys.ts')

describe('keyMintRefusalMessage', () => {
  it('names the account, its role, the organization and who can promote it', () => {
    const text = keyMintRefusalMessage({
      signedInAs: 'kensaurus@gmail.com',
      role: 'member',
      organization: 'Mushi Mushi',
      canPromote: ['owner@example.com'],
      teamUrl: 'https://example.com/admin/team',
    })
    expect(text).toContain('You approved as kensaurus@gmail.com, a member of Mushi Mushi.')
    expect(text).toContain('needs an owner or admin')
    expect(text).toContain('Owners and admins here: owner@example.com.')
    expect(text).toContain('https://example.com/admin/team')
    expect(text).toContain('run the same command again')
  })

  it('still reads as a sentence when the details could not be read', () => {
    const text = keyMintRefusalMessage({ signedInAs: null, role: null, organization: null, canPromote: [], teamUrl: 'https://x/team' })
    expect(text.startsWith('The account that approved. Creating a CLI or MCP key needs an owner or admin.')).toBe(true)
    expect(text).not.toContain('Owners and admins here')
  })
})
