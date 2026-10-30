/**
 * A provider usage cap cools the key for one hour.
 * The reset date in the error can be weeks away; using it as the cooldown
 * would ignore a raised spend limit until the key was re-saved.
 */
import { beforeAll, describe, expect, it } from 'vitest'

type Byok = typeof import('../../supabase/functions/_shared/byok.ts')
type Quota = typeof import('../../supabase/functions/_shared/llm-quota.ts')
let markKeyStatus: Byok['markKeyStatus']
let quota: Quota

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: () => undefined } } }).Deno ??= { env: { get: () => undefined } }
  quota = await import('../../supabase/functions/_shared/llm-quota.ts')
  ;({ markKeyStatus } = await import('../../supabase/functions/_shared/byok.ts'))
})

function capturingDb() {
  const updates: Record<string, unknown>[] = []
  const db = {
    from() {
      const b = {
        update(payload: Record<string, unknown>) {
          updates.push(payload)
          return b
        },
        eq() {
          return b
        },
        then(resolve: (value: unknown) => void) {
          resolve({ error: null })
        },
      }
      return b
    },
  }
  return { db, updates }
}

describe('spend-cap cooldown', () => {
  it('cools the key for one hour, not until the reset date in the provider error', async () => {
    const { db, updates } = capturingDb()
    const before = Date.now()
    const reason =
      'You have reached your specified API usage limits. You will regain access on 2099-01-01 at 00:00 UTC.'
    await markKeyStatus(db as never, 'key-1', 'quota_exhausted', reason)
    const until = Date.parse(String(updates[0]?.cooldown_until))
    expect(Number.isNaN(until)).toBe(false)
    expect(until).toBeGreaterThanOrEqual(before + quota.QUOTA_KEY_COOLDOWN_MS - 1000)
    expect(until).toBeLessThanOrEqual(Date.now() + quota.QUOTA_KEY_COOLDOWN_MS + 1000)
    expect(new Date(until).toISOString().startsWith('2099')).toBe(false)
  })

  it('quotes the provider reset date without treating that date as the cooldown clock', () => {
    expect(quota.quotaCooldownUntil(Date.parse('2020-01-01T00:00:00.000Z'))).toBe('2020-01-01T01:00:00.000Z')
    expect(quota.quotaUserMessage('regain access on 2099-01-01 at 00:00 UTC')).toBe(
      'Provider quota exhausted until 2099-01-01 at 00:00 UTC. Update your key in Settings.',
    )
    expect(quota.quotaUserMessage('Your credit balance is too low to access the Anthropic API.')).toBe(
      'Provider quota exhausted. Update your key in Settings.',
    )
  })
})
