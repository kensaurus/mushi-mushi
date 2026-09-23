/**
 * FILE: packages/server/src/__tests__/end-user-resolver.test.ts
 * PURPOSE: An unverified identify can create a person but never rewrite an
 *          existing person's name or email hash (_shared/end-user-resolver.ts).
 *
 * Audit #31: identify() from any public SDK key upserted end_users with
 * ignoreDuplicates:false, so it could rename or re-email any user in the org.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

const { resolveEndUser } = await import('../../supabase/functions/_shared/end-user-resolver.ts')

interface Call {
  op: 'upsert' | 'update'
  values: Record<string, unknown>
  options?: Record<string, unknown>
}

/** Fake end_users table: `exists` decides whether the insert-only upsert hits a conflict. */
function fakeDb(exists: boolean) {
  const calls: Call[] = []
  const row = { id: 'eu-1', opted_in_to_rewards: true, anti_fraud_flags: [] }
  const builder = (op: Call['op'], values: Record<string, unknown>, options?: Record<string, unknown>) => {
    calls.push({ op, values, options })
    const q: Record<string, unknown> = {}
    q.eq = () => q
    q.select = () => q
    q.single = async () => ({ data: row, error: null })
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: op === 'upsert' ? (exists ? [] : [row]) : [row], error: null }).then(resolve)
    return q
  }
  return {
    calls,
    db: {
      from: () => ({
        upsert: (v: Record<string, unknown>, o: Record<string, unknown>) => builder('upsert', v, o),
        update: (v: Record<string, unknown>) => builder('update', v),
      }),
    },
  }
}

const opts = {
  organizationId: 'org-1',
  externalUserId: 'user-42',
  traits: { email: 'victim@example.com', name: 'Mallory' },
}

describe('resolveEndUser', () => {
  let fake: ReturnType<typeof fakeDb>

  it('creates a new person with the supplied name and email hash', async () => {
    fake = fakeDb(false)
    const res = await resolveEndUser(fake.db as never, opts)
    expect(res?.id).toBe('eu-1')
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].options).toMatchObject({ ignoreDuplicates: true })
    expect(fake.calls[0].values).toMatchObject({ display_name: 'Mallory' })
    expect(fake.calls[0].values.email_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  describe('for an existing person', () => {
    beforeEach(() => {
      fake = fakeDb(true)
    })

    it('an unverified call only refreshes activity fields', async () => {
      await resolveEndUser(fake.db as never, { ...opts, optedInToRewards: true })
      const update = fake.calls.find((c) => c.op === 'update')
      expect(update?.values).not.toHaveProperty('display_name')
      expect(update?.values).not.toHaveProperty('email_hash')
      expect(update?.values).toHaveProperty('last_seen_at')
      expect(update?.values).toMatchObject({ opted_in_to_rewards: true })
    })

    it('a verified call may update presentation fields', async () => {
      await resolveEndUser(fake.db as never, { ...opts, identityVerified: true })
      const update = fake.calls.find((c) => c.op === 'update')
      expect(update?.values).toMatchObject({ display_name: 'Mallory' })
      expect(update?.values).toHaveProperty('email_hash')
    })
  })
})
