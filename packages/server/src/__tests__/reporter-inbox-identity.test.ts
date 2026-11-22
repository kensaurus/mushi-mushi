import { describe, expect, it } from 'vitest'
import { ownReportsOrFilter } from '../../supabase/functions/api/routes/reporter-inbox.ts'

const HASH = 'rk1_' + 'a'.repeat(64)
const PERSON = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

describe('"Your reports" by token or verified identity (2026-11-16)', () => {
  it('matches the device token or the verified person', () => {
    expect(ownReportsOrFilter(HASH, PERSON)).toBe(`reporter_token_hash.eq.${HASH},end_user_id.eq.${PERSON}`)
  })

  it('without a verified person, matches the token only (null = token filter)', () => {
    expect(ownReportsOrFilter(HASH, null)).toBeNull()
  })

  it('never builds a filter from a value that could break out of it', () => {
    expect(ownReportsOrFilter(HASH, `${PERSON}),reporter_token_hash.neq.x`)).toBeNull()
    expect(ownReportsOrFilter('x,end_user_id.neq.0', PERSON)).toBeNull()
  })
})
