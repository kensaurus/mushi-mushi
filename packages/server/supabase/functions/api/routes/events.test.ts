import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { batchSchema, sanitizeProperties } from './events.ts'
import { EVENT_PROPERTY_LIMITS, MUSHI_EVENT_NAMES, isValidEventName } from '../../_shared/analytics-taxonomy.generated.ts'

Deno.test('generated taxonomy mirror agrees with the SDK vocabulary shape', () => {
  // Every dogfooded event name must pass the same regex the route enforces.
  for (const name of MUSHI_EVENT_NAMES) assertEquals(isValidEventName(name), true, name)
  assertEquals(isValidEventName('Bad Name'), false)
  assertEquals(EVENT_PROPERTY_LIMITS.maxServerBatch, 50)
})

Deno.test('batchSchema accepts a minimal Mushi.track() batch', () => {
  const parsed = batchSchema.safeParse({
    anon_id: 'rt_abc',
    surface: 'docs',
    events: [{ name: 'landing_view', properties: { $utm_source: 'hn' } }],
  })
  assertEquals(parsed.success, true)
})

Deno.test('batchSchema rejects bad names, nested properties and oversize batches', () => {
  assertEquals(batchSchema.safeParse({ events: [{ name: 'Bad Name' }] }).success, false)
  assertEquals(batchSchema.safeParse({ events: [{ name: 'ok_event', properties: { nested: { a: 1 } } }] }).success, false)
  assertEquals(batchSchema.safeParse({ events: [] }).success, false)
  const tooMany = Array.from({ length: EVENT_PROPERTY_LIMITS.maxServerBatch + 1 }, () => ({ name: 'ok_event' }))
  assertEquals(batchSchema.safeParse({ events: tooMany }).success, false)
  assertEquals(batchSchema.safeParse({ surface: 'martian', events: [{ name: 'ok_event' }] }).success, false)
})

Deno.test('sanitizeProperties drops PII-looking keys, unknown reserved keys and truncates values', () => {
  const { properties, dropped } = sanitizeProperties({
    plan: 'pro',
    email: 'a@b.c',
    user_token: 'x',
    $utm_source: 'hn',
    $evil: 'nope',
    long: 'x'.repeat(1000),
    nan: Number.NaN,
    flag: true,
    none: null,
  })
  assertEquals(properties.plan, 'pro')
  assertEquals(properties.email, undefined)
  assertEquals(properties.user_token, undefined)
  assertEquals(properties.$utm_source, 'hn')
  assertEquals(properties.$evil, undefined)
  assertEquals((properties.long as string).length, EVENT_PROPERTY_LIMITS.maxValueLength)
  assertEquals(properties.nan, null)
  assertEquals(properties.flag, true)
  assertEquals(properties.none, null)
  assertEquals(dropped, 3)
})

Deno.test('sanitizeProperties caps the number of keys', () => {
  const input: Record<string, string> = {}
  for (let i = 0; i < EVENT_PROPERTY_LIMITS.maxKeys + 5; i += 1) input['k' + i] = 'v'
  const { properties, dropped } = sanitizeProperties(input)
  assertEquals(Object.keys(properties).length, EVENT_PROPERTY_LIMITS.maxKeys)
  assertEquals(dropped, 5)
})
