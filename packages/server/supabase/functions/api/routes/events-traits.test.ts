import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { MAX_PERSON_TRAITS_BYTES, batchSchema, extractPersonTraits } from './events.ts'

Deno.test('identify() traits other than email and name become person traits', () => {
  // identify(id, { plan: 'pro' }) was parsed by the schema and then discarded,
  // so the People tab's trait filter never matched anyone.
  const parsed = batchSchema.parse({
    user_id: 'u_1',
    user_traits: { email: 'a@example.com', name: 'Ada', plan: 'pro', seats: 3, beta: true },
    events: [{ name: 'identify' }],
  })
  assertEquals(extractPersonTraits(parsed.user_traits), { plan: 'pro', seats: 3, beta: true })
})

Deno.test('person traits follow the event property contract', () => {
  assertEquals(
    extractPersonTraits({
      phone_number: '555', // PII-looking key
      $internal: 'x', // reserved prefix
      nested: { a: 1 }, // not a scalar
      list: ['a'],
      cleared: null,
      tier: 't'.repeat(400), // capped at the property value length
    }),
    { cleared: null, tier: 't'.repeat(256) },
  )
  assertEquals(extractPersonTraits(null), {})
  assertEquals(extractPersonTraits(undefined), {})
})

Deno.test('person traits stay under the byte budget the end_users CHECK allows', () => {
  const many: Record<string, string> = {}
  for (let i = 0; i < 30; i++) many[`k${i}`] = 'v'.repeat(200)
  const out = extractPersonTraits(many)
  assertEquals(JSON.stringify(out).length <= MAX_PERSON_TRAITS_BYTES, true)
  // Kept in input order, dropped from the end.
  assertEquals(Object.keys(out)[0], 'k0')
})
