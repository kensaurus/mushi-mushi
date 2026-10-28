/**
 * FILE: packages/server/src/__tests__/llm-quota-cooldown.test.ts
 * PURPOSE: A monthly provider usage cap cools the key until the reset date
 *          named in the error, instead of the one-hour 429 cooldown.
 */
import { beforeAll, describe, expect, it } from 'vitest'

let markKeyStatus: typeof import('../../supabase/functions/_shared/byok.ts').markKeyStatus

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: () => undefined } } }).Deno = { env: { get: () => undefined } }
  ;({ markKeyStatus } = await import('../../supabase/functions/_shared/byok.ts'))
})

function recordingDb() {
  const updates: Array<Record<string, unknown>> = []
  const db = {
    from() {
      return {
        update(row: Record<string, unknown>) {
          updates.push(row)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
  return { db, updates }
}

const USAGE_CAP =
  'Error: AI_APICallError: upstream LLM provider usage limit reached (access resumes 2026-11-01 00:00 UTC)'

describe('markKeyStatus quota cooldown', () => {
  it('cools a monthly usage cap until the reset date in the provider error', async () => {
    const { db, updates } = recordingDb()
    await markKeyStatus(db as never, 'k1', 'quota_exhausted', USAGE_CAP)
    expect(updates[0]?.cooldown_until).toBe('2026-11-01T00:00:00.000Z')
    expect(updates[0]?.status).toBe('quota_exhausted')
  })

  it('cools until midnight UTC when the provider names a date and no clock time', async () => {
    const { db, updates } = recordingDb()
    await markKeyStatus(
      db as never,
      'k1',
      'quota_exhausted',
      'API usage limits reached. You will regain access on 2026-11-01',
    )
    expect(updates[0]?.cooldown_until).toBe('2026-11-01T00:00:00.000Z')
  })

  it('keeps a one-hour cooldown for a plain 429', async () => {
    const { db, updates } = recordingDb()
    const before = Date.now()
    await markKeyStatus(db as never, 'k1', 'quota_exhausted', 'Error: 429 Too Many Requests')
    const until = Date.parse(String(updates[0]?.cooldown_until))
    expect(until).toBeGreaterThanOrEqual(before + 59 * 60 * 1000)
    expect(until).toBeLessThanOrEqual(Date.now() + 61 * 60 * 1000)
  })

  it('sets no cooldown when the key is rejected', async () => {
    const { db, updates } = recordingDb()
    await markKeyStatus(db as never, 'k1', 'auth_failed', '401 invalid x-api-key')
    expect(updates[0]?.cooldown_until).toBeNull()
  })
})
