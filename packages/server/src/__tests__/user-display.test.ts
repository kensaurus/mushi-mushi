/**
 * The audit feed names its actors instead of showing raw user ids
 * (2026-10-04 console audit: "Agent eb0c15cc-4139-… fix.merge").
 */
import { describe, expect, it, vi } from 'vitest'
import { displayFromAuthUser, resolveUserDisplays } from '../../supabase/functions/_shared/user-display.ts'

describe('displayFromAuthUser', () => {
  it('prefers metadata names, then a title-cased email local part', () => {
    expect(displayFromAuthUser({ email: 'a@x.dev', user_metadata: { full_name: 'Ken Sa' } })).toEqual({ email: 'a@x.dev', name: 'Ken Sa' })
    expect(displayFromAuthUser({ email: 'alice.dev@x.dev', user_metadata: {} })).toEqual({ email: 'alice.dev@x.dev', name: 'Alice Dev' })
    expect(displayFromAuthUser(null)).toEqual({ email: null, name: null })
  })
})

describe('resolveUserDisplays', () => {
  it('looks each user up once and skips non-ids and the system id', async () => {
    const getUserById = vi.fn(async (id: string) => ({ data: { user: { email: `${id.slice(0, 4)}@x.dev`, user_metadata: {} } } }))
    const db = { auth: { admin: { getUserById } } }
    const id = 'eb0c15cc-4139-490b-a335-35b3d87428df'
    const out = await resolveUserDisplays(db, [id, id, null, 'agent_cursor', '00000000-0000-0000-0000-000000000000'])
    expect(getUserById).toHaveBeenCalledTimes(1)
    expect(out.get(id)).toEqual({ email: 'eb0c@x.dev', name: 'Eb0c' })
  })

  it('maps a failed lookup to nulls instead of throwing', async () => {
    const db = { auth: { admin: { getUserById: async () => { throw new Error('down') } } } }
    const id = 'eb0c15cc-4139-490b-a335-35b3d87428df'
    expect((await resolveUserDisplays(db, [id])).get(id)).toEqual({ email: null, name: null })
  })
})
