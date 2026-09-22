import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  CLIENT_TS_MAX_FUTURE_MS,
  CLIENT_TS_MAX_PAST_MS,
  PUBLIC_SURFACES,
  SERVER_OWNED_EVENTS,
  admitEventNames,
  batchSchema,
  clampEventTs,
  readBodyCapped,
} from './events.ts'
import { clientIp, ipActorId } from './ingest-budget.ts'
import { reporterKey, reporterKeyOrNull } from '../../_shared/reporter-token.ts'

const NOW = Date.parse('2026-09-21T12:00:00.000Z')

Deno.test('a plausible client timestamp is kept', () => {
  const ts = new Date(NOW - 60_000).toISOString()
  assertEquals(clampEventTs(ts, NOW), { ts, clamped: false })
})

Deno.test('future and ancient timestamps fall back to the receive time', () => {
  const future = new Date(NOW + CLIENT_TS_MAX_FUTURE_MS + 1).toISOString()
  const ancient = new Date(NOW - CLIENT_TS_MAX_PAST_MS - 1).toISOString()
  assertEquals(clampEventTs(future, NOW), { ts: new Date(NOW).toISOString(), clamped: true })
  assertEquals(clampEventTs(ancient, NOW), { ts: new Date(NOW).toISOString(), clamped: true })
  assertEquals(clampEventTs(undefined, NOW), { ts: new Date(NOW).toISOString(), clamped: false })
})

Deno.test('the body cap counts streamed bytes, not the Content-Length header', async () => {
  const chunked = (bytes: number) =>
    new Request('https://x/v1/sdk/events', {
      method: 'POST',
      // A ReadableStream body is sent without Content-Length (chunked).
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('a'.repeat(bytes)))
          controller.close()
        },
      }),
    })
  assertEquals(await readBodyCapped(chunked(100), 64), null)
  assertEquals(await readBodyCapped(chunked(64), 64), 'a'.repeat(64))
})

Deno.test('server milestones cannot be sent with a public key', () => {
  for (const name of ['first_report_received', 'project_created', 'key_minted']) {
    assertEquals(SERVER_OWNED_EVENTS.has(name), true, name)
  }
  // Console-surface events the browser legitimately sends stay open.
  assertEquals(SERVER_OWNED_EVENTS.has('report_opened'), false)
  assertEquals(PUBLIC_SURFACES.has('server'), false)
  assertEquals(PUBLIC_SURFACES.has('console'), true)
  // MCP usage is recorded server-side (mcp-stdio-usage.ts, hosted MCP); a
  // browser key claiming it would forge Fix pulled / Habit.
  assertEquals(PUBLIC_SURFACES.has('mcp'), false)
  // Multi-surface events (console + mcp) are not server-owned.
  assertEquals(SERVER_OWNED_EVENTS.has('fix_context_pulled'), false)
})

Deno.test('the event-name cap admits known names and new ones only while under the cap', () => {
  const known = new Set(['a_one', 'b_two'])
  const events = [{ name: 'a_one' }, { name: 'c_new' }, { name: 'd_new' }, { name: 'b_two' }, { name: 'c_new' }]
  const { admitted, overCap } = admitEventNames(events, known, 3)
  assertEquals(admitted.map((e) => e.name), ['a_one', 'c_new', 'b_two', 'c_new'])
  assertEquals(overCap, 1)
  assertEquals(known.has('c_new'), true, 'admitted names join the cached set')
  assertEquals(known.has('d_new'), false)
})

Deno.test('an event with more properties than the SDK ever sends is refused', () => {
  const props = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, i]))
  const res = batchSchema.safeParse({ events: [{ name: 'cta_click', properties: props }] })
  assertEquals(res.success, false)
  const ok = batchSchema.safeParse({ events: [{ name: 'cta_click', properties: { cta_id: 'x' } }] })
  assertEquals(ok.success, true)
})

Deno.test('the per-IP budget key is a stable UUID that does not contain the IP', async () => {
  const a = await ipActorId('203.0.113.7')
  assertEquals(a, await ipActorId('203.0.113.7'))
  assertNotEquals(a, await ipActorId('203.0.113.8'))
  assertEquals(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a), true)
  assertEquals(a.includes('203'), false)
  const headers: Record<string, string> = { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }
  assertEquals(clientIp((n) => headers[n]), '198.51.100.1')
  assertEquals(clientIp(() => undefined), null)
})

Deno.test('reporter credentials are stored as the one-way key the SQL backfill writes', async () => {
  const raw = 'mushi_rt_sample_é_テスト'
  const digest = 'f795dd18f54c10ffd14db9abfa22bfd021659d37820bc476b327794fbbc17158'
  // Pinned against Postgres public.mushi_reporter_key(raw) — the
  // 20260922000019 backfill must produce the same key.
  const key = 'rk1_7d3a51b170c46c3051da354b21341b0190a9c6d0544aac23ce2fd51966595e83' // gitleaks:allow
  assertEquals(await reporterKey(raw), key)
  // The report path gets the raw token, the signed thread path gets its
  // digest: both must land on the same row.
  assertEquals(await reporterKey(digest), key)
  assertEquals(await reporterKey(digest.toUpperCase()), key)
  assertEquals(/^rk1_[0-9a-f]{64}$/.test(key), true)
  // A stored key replayed as a credential must not find the reporter.
  assertNotEquals(await reporterKey(key), key)
  assertEquals(await reporterKeyOrNull(null), null)
})
