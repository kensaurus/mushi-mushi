import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { classifyIngestRateLimitError } from './ingest-rate-limit.ts'

Deno.test('classifyIngestRateLimitError passes when the RPC returns no error', () => {
  assertEquals(classifyIngestRateLimitError(null), 'ok')
})

Deno.test('classifyIngestRateLimitError maps a P0001 breach to 429 handling', () => {
  assertEquals(
    classifyIngestRateLimitError({ message: 'rate_limit_exceeded: report_ingest', code: 'P0001' }),
    'breach',
  )
})

Deno.test('classifyIngestRateLimitError fails OPEN only for a missing claim function (42883)', () => {
  assertEquals(
    classifyIngestRateLimitError({ message: 'function report_ingest_rate_limit_claim(uuid, integer) does not exist', code: '42883' }),
    'fail-open',
  )
  assertEquals(
    classifyIngestRateLimitError({ message: 'function report_ingest_rate_limit_claim does not exist' }),
    'fail-open',
  )
})

Deno.test('classifyIngestRateLimitError fails CLOSED on any other RPC error', () => {
  // A degraded database, exhausted connection pool, or induced RPC error must
  // NOT let a caller rotate straight past the throttle.
  assertEquals(
    classifyIngestRateLimitError({ message: 'remaining connection slots are reserved', code: '53300' }),
    'fail-closed',
  )
  assertEquals(classifyIngestRateLimitError({ message: 'network error' }), 'fail-closed')
  assertEquals(classifyIngestRateLimitError({}), 'fail-closed')
})
