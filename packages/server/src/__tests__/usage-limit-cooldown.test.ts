/**
 * FILE: usage-limit-cooldown.test.ts
 * PURPOSE: A workspace usage cap lasts until the date Anthropic names.
 *          Marking the key exhausted must hold it until that time, not for
 *          the one-hour cooldown used by an ordinary 429.
 */

import { describe, expect, it } from 'vitest'
import { markKeyStatus } from '../../supabase/functions/_shared/byok.ts'

const CAP =
  'Claude quota exceeded: You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.'

function capturingDb() {
  const updates: Array<Record<string, unknown>> = []
  const db = {
    from() {
      return {
        update(payload: Record<string, unknown>) {
          updates.push(payload)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
  return { db, updates }
}

describe('markKeyStatus usage-cap cooldown', () => {
  it('holds a capped key until the regain-access time', async () => {
    const { db, updates } = capturingDb()
    await markKeyStatus(db as never, 'key-1', 'quota_exhausted', CAP)
    expect(updates[0]?.cooldown_until).toBe('2026-11-01T00:00:00.000Z')
  })

  it('keeps the one-hour cooldown when the quota error names no reset time', async () => {
    const { db, updates } = capturingDb()
    const before = Date.now()
    await markKeyStatus(db as never, 'key-1', 'quota_exhausted', '429 Too Many Requests')
    const until = Date.parse(String(updates[0]?.cooldown_until))
    expect(until).toBeGreaterThan(before + 50 * 60 * 1000)
    expect(until).toBeLessThan(before + 70 * 60 * 1000)
  })
})
