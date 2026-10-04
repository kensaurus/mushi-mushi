/**
 * FILE: packages/server/src/__tests__/billing-usage-counts.test.ts
 * PURPOSE: /v1/admin/billing/stats counts this period's usage exactly.
 *
 * Why (2026-10-04): the route read every usage_events row for every project
 * with no bound (PostgREST returns at most 1000) and filtered shadow
 * diagnoses on a `metadata` column it never selected. It now uses head
 * counts, and shadow diagnoses are subtracted so rows with no `shadow` key
 * still count (on prod all 116 diagnoses rows have no key).
 */
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('Deno', { env: { get: () => undefined } })

const COUNTS: Record<string, number> = {
  reports_ingested: 1500,
  fixes_attempted: 12,
  fixes_succeeded: 9,
  diagnoses: 116,
}

function fakeDb(opts: { shadow: number; failEvent?: string; rpc?: { data: unknown; error: unknown } }) {
  return {
    rpc: vi.fn(async () => opts.rpc ?? { data: '2.5371', error: null }),
    from: () => ({
      select: () => {
        const eqs: Array<[string, unknown]> = []
        const builder = {
          eq: (c: string, v: unknown) => {
            eqs.push([c, v])
            return builder
          },
          gte: () => builder,
          not: () => builder,
          then: (resolve: (v: unknown) => void) => {
            const event = eqs.find(([c]) => c === 'event_name')?.[1] as string
            if (event === opts.failEvent) return resolve({ count: null, error: { message: 'boom' } })
            const shadow = eqs.some(([c]) => c === 'metadata->>shadow')
            resolve({ count: shadow ? opts.shadow : COUNTS[event] ?? 0, error: null, data: [] })
          },
        }
        return builder
      },
    }),
  }
}

describe('countPeriodUsage', () => {
  it('counts past 1000 rows and keeps diagnoses without a shadow key', async () => {
    const { countPeriodUsage } = await import('../../supabase/functions/_shared/billing-usage-counts.ts')
    const u = await countPeriodUsage(fakeDb({ shadow: 6 }) as never, 'p1', '2026-10-01T00:00:00Z')
    expect(u).toEqual({ reports: 1500, fixes: 12, fixesSucceeded: 9, diagnoses: 110 })
  })

  it('returns an Error rather than a zero when a count fails', async () => {
    const { countPeriodUsage } = await import('../../supabase/functions/_shared/billing-usage-counts.ts')
    const u = await countPeriodUsage(fakeDb({ shadow: 0, failEvent: 'fixes_attempted' }) as never, 'p1', '2026-10-01T00:00:00Z')
    expect(u).toBeInstanceOf(Error)
  })
})

describe('llmCostSince', () => {
  it('reads the SQL aggregate', async () => {
    const { llmCostSince } = await import('../../supabase/functions/_shared/billing-usage-counts.ts')
    expect(await llmCostSince(fakeDb({ shadow: 0 }) as never, 'p1', '2026-10-01T00:00:00Z')).toBeCloseTo(2.5371)
  })
})
