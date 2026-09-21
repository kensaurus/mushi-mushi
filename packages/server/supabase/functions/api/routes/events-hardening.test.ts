import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  CLIENT_TS_MAX_FUTURE_MS,
  CLIENT_TS_MAX_PAST_MS,
  PUBLIC_SURFACES,
  SERVER_OWNED_EVENTS,
  clampEventTs,
  readBodyCapped,
} from './events.ts'
import { hashReporterToken, hashReporterTokenOrNull } from '../../_shared/reporter-token.ts'

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
})

Deno.test('reporter tokens are stored as the same sha256 the report path stores', async () => {
  const raw = 'mushi_rt_sample_é_テスト'
  const hashed = await hashReporterToken(raw)
  // Pinned against Postgres encode(sha256(convert_to(raw,'UTF8')),'hex') — the
  // 20260921000007 backfill must produce the same digest.
  assertEquals(hashed, 'f795dd18f54c10ffd14db9abfa22bfd021659d37820bc476b327794fbbc17158')
  assertNotEquals(hashed, raw)
  assertEquals(await hashReporterToken(hashed), hashed, 'idempotent on an existing digest')
  assertEquals(await hashReporterTokenOrNull(null), null)
})
