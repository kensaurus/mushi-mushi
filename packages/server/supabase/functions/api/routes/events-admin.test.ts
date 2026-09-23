import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  FUNNEL_WINDOWS,
  funnelQuerySchema,
  pathsQuerySchema,
  peopleQuerySchema,
  resolveRange,
  retentionQuerySchema,
  summaryQuerySchema,
} from './events-admin.ts'

Deno.test('summary window defaults to 30 and is clamped to 1..365', () => {
  assertEquals(summaryQuerySchema.parse({}).window, 30)
  assertEquals(summaryQuerySchema.parse({ window: '7' }).window, 7)
  assertEquals(summaryQuerySchema.safeParse({ window: '0' }).success, false)
  assertEquals(summaryQuerySchema.safeParse({ window: '400' }).success, false)
  assertEquals(summaryQuerySchema.safeParse({ window: 'abc' }).success, false)
})

Deno.test('funnel steps parse from a comma list, 1..8 distinct snake_case names', () => {
  const ok = funnelQuerySchema.parse({ steps: 'landing_view, signup_click ,signup_completed' })
  assertEquals(ok.steps, ['landing_view', 'signup_click', 'signup_completed'])
  assertEquals(ok.window, '7d')
  assertEquals(ok.breakdown, undefined)
  assertEquals(funnelQuerySchema.safeParse({ steps: '' }).success, false)
  assertEquals(funnelQuerySchema.safeParse({ steps: 'a,a' }).success, false)
  assertEquals(funnelQuerySchema.safeParse({ steps: 'Bad Name' }).success, false)
  assertEquals(funnelQuerySchema.safeParse({ steps: 'a1,a2,a3,a4,a5,a6,a7,a8,a9' }).success, false)
  assertEquals(funnelQuerySchema.safeParse({ steps: 'ok_event', window: '2h' }).success, false)
  assertEquals(funnelQuerySchema.parse({ steps: 'ok_event', window: '1h' }).window, '1h')
  assertEquals(funnelQuerySchema.parse({ steps: 'ok_event', breakdown: '$utm_source' }).breakdown, '$utm_source')
  assertEquals(funnelQuerySchema.safeParse({ steps: 'ok_event', breakdown: 'drop table' }).success, false)
  assertEquals(funnelQuerySchema.safeParse({ steps: 'ok_event', from: 'not-a-date' }).success, false)
  assert(funnelQuerySchema.parse({ steps: 'ok_event', from: '2026-09-01T00:00:00Z' }).from instanceof Date)
})

Deno.test('funnel window shorthands map to Postgres intervals', () => {
  assertEquals(FUNNEL_WINDOWS['1h'], '1 hour')
  assertEquals(FUNNEL_WINDOWS['1d'], '1 day')
  assertEquals(FUNNEL_WINDOWS['7d'], '7 days')
  assertEquals(FUNNEL_WINDOWS['30d'], '30 days')
})

Deno.test('resolveRange defaults to the last 30 days and rejects inverted or huge ranges', () => {
  const now = new Date('2026-09-21T12:00:00Z')
  const r = resolveRange(undefined, undefined, now)
  assert(!('error' in r))
  if (!('error' in r)) {
    assertEquals(r.to.toISOString(), now.toISOString())
    assertEquals(r.from.toISOString(), '2026-08-22T12:00:00.000Z')
  }
  assert('error' in resolveRange(new Date('2026-09-22T00:00:00Z'), new Date('2026-09-21T00:00:00Z'), now))
  assert('error' in resolveRange(new Date('2024-01-01T00:00:00Z'), now, now))
  const explicit = resolveRange(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-02T00:00:00Z'), now)
  assert(!('error' in explicit))
})

Deno.test('paths requires from_event and clamps limit', () => {
  assertEquals(pathsQuerySchema.safeParse({}).success, false)
  assertEquals(pathsQuerySchema.parse({ from_event: 'landing_view' }).limit, 10)
  assertEquals(pathsQuerySchema.parse({ from_event: 'landing_view', limit: '50' }).limit, 50)
  assertEquals(pathsQuerySchema.safeParse({ from_event: 'landing_view', limit: '51' }).success, false)
})

Deno.test('people filter is URL-encoded flat JSON of scalars', () => {
  assertEquals(peopleQuerySchema.parse({}).filter, {})
  assertEquals(peopleQuerySchema.parse({ filter: '' }).filter, {})
  assertEquals(peopleQuerySchema.parse({ filter: JSON.stringify({ plan: 'pro', seats: 3, beta: true, x: null }) }).filter, {
    plan: 'pro',
    seats: 3,
    beta: true,
    x: null,
  })
  assertEquals(peopleQuerySchema.safeParse({ filter: '{bad json' }).success, false)
  assertEquals(peopleQuerySchema.safeParse({ filter: '[1,2]' }).success, false)
  assertEquals(peopleQuerySchema.safeParse({ filter: JSON.stringify({ nested: { a: 1 } }) }).success, false)
  assertEquals(peopleQuerySchema.safeParse({ filter: JSON.stringify({ 'bad key': 1 }) }).success, false)
  assertEquals(peopleQuerySchema.parse({ limit: '200' }).limit, 200)
  assertEquals(peopleQuerySchema.safeParse({ limit: '201' }).success, false)
  assert(peopleQuerySchema.parse({ before: '2026-09-01T00:00:00Z' }).before instanceof Date)
})

Deno.test('retention weeks default to 8, max 26, return_event validated', () => {
  assertEquals(retentionQuerySchema.parse({}).weeks, 8)
  assertEquals(retentionQuerySchema.parse({ weeks: '26' }).weeks, 26)
  assertEquals(retentionQuerySchema.safeParse({ weeks: '27' }).success, false)
  assertEquals(retentionQuerySchema.parse({ return_event: 'report_opened' }).return_event, 'report_opened')
  assertEquals(retentionQuerySchema.safeParse({ return_event: 'Report Opened' }).success, false)
})
