import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { classifyIngestRateLimitError, isScopedRateLimitContention } from './ingest-rate-limit.ts'

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

Deno.test('classifyIngestRateLimitError keeps a statement timeout fail-closed for report ingest', () => {
  // Report ingest uses this classifier alone. A timeout there still rejects.
  // Session ingest checks isScopedRateLimitContention and continues.
  const error = { message: 'canceling statement due to statement timeout', code: '57014' }
  assertEquals(classifyIngestRateLimitError(error), 'fail-closed')
  assertEquals(isScopedRateLimitContention(error), true)
})

Deno.test('isScopedRateLimitContention matches a busy counter and not a cap breach', () => {
  assertEquals(
    isScopedRateLimitContention({ code: '55P03', message: 'rate_limit_busy: scope=sdk_sessions_ip' }),
    true,
  )
  assertEquals(isScopedRateLimitContention({ message: 'canceling statement due to lock timeout' }), true)
  assertEquals(isScopedRateLimitContention({ code: '40P01', message: 'deadlock detected' }), true)
  assertEquals(
    isScopedRateLimitContention({ code: 'P0001', message: 'rate_limit_exceeded: scope=sdk_sessions_ip' }),
    false,
  )
  assertEquals(
    isScopedRateLimitContention({ code: '53300', message: 'remaining connection slots are reserved' }),
    false,
  )
  assertEquals(isScopedRateLimitContention(null), false)
})

Deno.test('classifyIngestRateLimitError fails CLOSED for unrelated "does not exist" errors', () => {
  // "does not exist" alone must not open the gate — only the claim function
  // being undeployed counts as the migration window.
  assertEquals(
    classifyIngestRateLimitError({ message: 'relation "reports" does not exist', code: '42P01' }),
    'fail-closed',
  )
  assertEquals(
    classifyIngestRateLimitError({ message: 'column "project_id" does not exist', code: '42703' }),
    'fail-closed',
  )
})
