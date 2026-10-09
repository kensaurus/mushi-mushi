import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  BYOK_PROBE_INTERVAL_MS,
  healthRowsFromOutcomes,
  probeByokRow,
  selectDueByokKeys,
  type ByokKeyRow,
} from '../_shared/byok-health.ts'

const NOW = '2026-10-02T12:00:00.000Z'

function key(over: Partial<ByokKeyRow> = {}): ByokKeyRow {
  return {
    id: 'k1',
    project_id: 'p1',
    provider_slug: 'anthropic',
    vault_secret_id: 'v1',
    base_url: null,
    label: 'Main key',
    key_hint: '…abcd',
    status: 'active',
    test_status: 'ok',
    last_tested_at: null,
    last_error: null,
    ...over,
  }
}

/** Fixture provider that answers every request with one status. */
function provider(status: number): typeof fetch {
  return (() => Promise.resolve(new Response('{}', { status }))) as typeof fetch
}

Deno.test('a revoked key (HTTP 401) is marked auth_failed and writes a down health row', async () => {
  const outcome = await probeByokRow(key(), 'sk-ant-revoked', NOW, provider(401))
  assertEquals(outcome.health, 'down')
  assertEquals(outcome.patch?.status, 'auth_failed')
  assertEquals(outcome.patch?.test_status, 'error_auth')
  assertEquals(outcome.patch?.last_tested_at, NOW)
  const [row] = healthRowsFromOutcomes([outcome])
  assertEquals(row.kind, 'anthropic')
  assertEquals(row.status, 'down')
  assertEquals(row.source, 'cron')
  assert(row.message.includes('rejected'))
})

Deno.test('a working key is marked active and ok', async () => {
  const outcome = await probeByokRow(key({ status: 'auth_failed', test_status: 'error_auth' }), 'sk-ant-good', NOW, provider(200))
  assertEquals(outcome.health, 'ok')
  assertEquals(outcome.patch?.status, 'active')
  assertEquals(outcome.patch?.test_status, 'ok')
})

Deno.test('a network failure never changes the key status', async () => {
  const down: typeof fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch
  const outcome = await probeByokRow(key(), 'sk-ant-good', NOW, down)
  assertEquals(outcome.health, 'degraded')
  assertEquals(outcome.patch, null)
})

Deno.test('a key Vault cannot return is reported, not skipped', async () => {
  const outcome = await probeByokRow(key(), null, NOW, provider(200))
  assertEquals(outcome.health, 'down')
  assertEquals(outcome.patch?.status, 'auth_failed')
})

Deno.test('one health row per provider, carrying the worst key', async () => {
  const good = await probeByokRow(key({ id: 'a', label: 'Good' }), 'x', NOW, provider(200))
  const bad = await probeByokRow(key({ id: 'b', label: 'Revoked' }), 'y', NOW, provider(403))
  const rows = healthRowsFromOutcomes([bad, good])
  assertEquals(rows.length, 1)
  assertEquals(rows[0].status, 'down')
  assert(rows[0].message.includes('Revoked'))
})

Deno.test('keys are probed at most once a day, and disabled keys never', () => {
  const now = new Date(NOW).getTime()
  const fresh = new Date(now - BYOK_PROBE_INTERVAL_MS + 60_000).toISOString()
  const old = new Date(now - BYOK_PROBE_INTERVAL_MS - 60_000).toISOString()
  const due = selectDueByokKeys(
    [
      key({ id: 'never' }),
      key({ id: 'fresh', last_tested_at: fresh }),
      key({ id: 'old', last_tested_at: old }),
      key({ id: 'off', status: 'disabled' }),
      key({ id: 'pat', provider_slug: 'supabase' }),
    ],
    now,
  )
  assertEquals(due.map((k) => k.id), ['never', 'old'])
})

Deno.test('a Supabase token is probed only once its project has a linked ref, and against that ref', async () => {
  const now = new Date(NOW).getTime()
  const REF = 'abcdefghijklmnopqrst'
  const due = selectDueByokKeys(
    [
      key({ id: 'linked', provider_slug: 'supabase', supabase_project_ref: REF }),
      key({ id: 'unlinked', provider_slug: 'supabase', supabase_project_ref: null }),
      key({ id: 'bad-ref', provider_slug: 'supabase', supabase_project_ref: 'NOT-A-REF' }),
    ],
    now,
  )
  assertEquals(due.map((k) => k.id), ['linked'])

  let calledUrl = ''
  const recorder = ((input: string | URL | Request) => {
    calledUrl = String(input)
    return Promise.resolve(new Response('[]', { status: 201 }))
  }) as typeof fetch
  const outcome = await probeByokRow(due[0], 'sbp_fixture', NOW, recorder)
  assertEquals(calledUrl, `https://api.supabase.com/v1/projects/${REF}/database/query/read-only`)
  assertEquals(outcome.health, 'ok')
  assertEquals(outcome.patch?.status, 'active')
})
