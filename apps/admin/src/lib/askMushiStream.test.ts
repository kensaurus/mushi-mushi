/**
 * FILE: apps/admin/src/lib/askMushiStream.test.ts
 * PURPOSE: Pin the SSE consumer's terminal-callback contract. The
 *          server emits `event: done` *and then* closes the socket, so
 *          the consumer must call `handlers.onDone()` exactly once —
 *          not once for the event and once for the EOF, and not again
 *          if the underlying fetch later throws while unwinding.
 *
 *          Also covers:
 *            • Empty stream (server hangs up before any event) → onError
 *            • HTTP non-2xx → onError, no onDone
 *            • `event: error` mid-stream → single onError, no onDone
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: 'tkn' } } }),
    },
  },
}))

vi.mock('./env', () => ({
  RESOLVED_API_URL: 'http://test.local',
}))

vi.mock('./sseClient', () => ({
  openSseStream: () => ({ close: () => {} }),
}))

import { openAskMushiStream, type AskMushiStreamHandlers } from './askMushiStream'

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c))
      ctrl.close()
    },
  })
}

function fakeFetchOnce(body: ReadableStream<Uint8Array> | null, status = 200) {
  const fn = vi.fn(async () => {
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function makeHandlers(): AskMushiStreamHandlers & {
  doneCount: () => number
  errorCount: () => number
} {
  let doneCalls = 0
  let errorCalls = 0
  return {
    onStart: vi.fn(),
    onDelta: vi.fn(),
    onMeta: vi.fn(),
    onDone: vi.fn(() => {
      doneCalls += 1
    }),
    onError: vi.fn(() => {
      errorCalls += 1
    }),
    doneCount: () => doneCalls,
    errorCount: () => errorCalls,
  }
}

async function flush() {
  // Drain microtasks so the IIFE inside openAskMushiStream finishes
  // reading the (already-closed) ReadableStream before assertions run.
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

describe('openAskMushiStream', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls onDone exactly once when server emits `event: done` then closes', async () => {
    fakeFetchOnce(
      sseStream([
        'event: start\ndata: {"threadId":"t1","model":"sonnet"}\n\n',
        'event: delta\ndata: {"delta":"hi"}\n\n',
        'event: done\ndata: {"done":true}\n\n',
      ]),
    )
    const h = makeHandlers()
    await openAskMushiStream(
      // Body shape is intentionally minimal — server is stubbed via
      // fakeFetchOnce, so it never actually reads request fields.
      { messages: [] } as unknown as Parameters<typeof openAskMushiStream>[0],
      h,
    )
    await flush()

    expect(h.doneCount()).toBe(1)
    expect(h.errorCount()).toBe(0)
    expect(h.onDelta).toHaveBeenCalledWith('hi')
  })

  it('treats a clean close after at least one event as onDone (legacy server)', async () => {
    fakeFetchOnce(
      sseStream([
        'event: start\ndata: {"threadId":"t1","model":"sonnet"}\n\n',
        'event: delta\ndata: {"delta":"hi"}\n\n',
        // No explicit done event — server just closes.
      ]),
    )
    const h = makeHandlers()
    await openAskMushiStream(
      { messages: [] } as unknown as Parameters<typeof openAskMushiStream>[0],
      h,
    )
    await flush()

    expect(h.doneCount()).toBe(1)
    expect(h.errorCount()).toBe(0)
  })

  it('emits onError (not onDone) when the stream closes before any event', async () => {
    fakeFetchOnce(sseStream([]))
    const h = makeHandlers()
    await openAskMushiStream(
      { messages: [] } as unknown as Parameters<typeof openAskMushiStream>[0],
      h,
    )
    await flush()

    expect(h.doneCount()).toBe(0)
    expect(h.errorCount()).toBe(1)
  })

  it('emits onError on non-2xx HTTP, never onDone', async () => {
    fakeFetchOnce(null, 429)
    const h = makeHandlers()
    await openAskMushiStream(
      { messages: [] } as unknown as Parameters<typeof openAskMushiStream>[0],
      h,
    )
    await flush()

    expect(h.doneCount()).toBe(0)
    expect(h.errorCount()).toBe(1)
  })

  it('does not double-call when server sends `event: error` then closes', async () => {
    fakeFetchOnce(
      sseStream([
        'event: error\ndata: {"code":"LLM_UNAVAILABLE","message":"down"}\n\n',
      ]),
    )
    const h = makeHandlers()
    await openAskMushiStream(
      { messages: [] } as unknown as Parameters<typeof openAskMushiStream>[0],
      h,
    )
    await flush()

    expect(h.doneCount()).toBe(0)
    expect(h.errorCount()).toBe(1)
  })
})
