import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { claimIngestBudget, ipActorId } from './ingest-budget.ts'

const PROJECT = '1000000a-0000-4000-8000-000000000001'
const BUDGET = { scope: 'sdk_sessions', perProjectPerMinute: 3000, perIpPerMinute: 600 }

function fakeDb(errors: Array<{ message?: string; code?: string } | null>) {
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args)
      return { error: errors[calls.length - 1] ?? null }
    },
  }
}

Deno.test('a statement timeout on sdk_sessions_ip does not reject the session', async () => {
  const closed: string[] = []
  const contended: string[] = []
  const db = fakeDb([
    null,
    { code: '57014', message: 'canceling statement due to statement timeout' },
  ])
  const result = await claimIngestBudget(
    db as never,
    PROJECT,
    '203.0.113.9',
    BUDGET,
    (scope) => closed.push(scope),
    (scope) => contended.push(scope),
  )
  assertEquals(result, 'ok')
  assertEquals(closed, [])
  assertEquals(contended, ['sdk_sessions_ip'])
  assertEquals(db.calls[1]?.p_scope, 'sdk_sessions_ip')
  assertEquals(db.calls[1]?.p_user_id, await ipActorId('203.0.113.9', PROJECT))
})

Deno.test('rate_limit_busy on the counter does not reject the session', async () => {
  const db = fakeDb([
    null,
    { code: '55P03', message: 'rate_limit_busy: scope=sdk_sessions_ip' },
  ])
  const result = await claimIngestBudget(db as never, PROJECT, '203.0.113.9', BUDGET)
  assertEquals(result, 'ok')
})

Deno.test('a cap breach still rejects', async () => {
  const db = fakeDb([
    null,
    { code: 'P0001', message: 'rate_limit_exceeded: scope=sdk_sessions_ip count=601 cap=600' },
  ])
  const contended: string[] = []
  const result = await claimIngestBudget(
    db as never,
    PROJECT,
    '203.0.113.9',
    BUDGET,
    () => {},
    (scope) => contended.push(scope),
  )
  assertEquals(result, 'limited')
  assertEquals(contended, [])
})

Deno.test('a database outage still rejects', async () => {
  const closed: string[] = []
  const db = fakeDb([{ code: '53300', message: 'remaining connection slots are reserved' }])
  const result = await claimIngestBudget(
    db as never,
    PROJECT,
    '203.0.113.9',
    BUDGET,
    (scope) => closed.push(scope),
  )
  assertEquals(result, 'limited')
  assertEquals(closed, ['sdk_sessions'])
  assertEquals(db.calls.length, 1)
})
