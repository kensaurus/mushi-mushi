/**
 * FILE: packages/mcp/src/__tests__/inventory-poll.test.ts
 * PURPOSE: The inventory poll gives up on a key that cannot read inventory and
 *          keeps going through transient failures.
 *
 * Until 2026-09-22 a non-OK response was dropped silently and the poll retried
 * every minute forever: 1,038 refused requests in 17 hours from one
 * ingest-only key, with no hint why notifications never arrived.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startInventoryPoll, type InventoryPoll } from '../inventory-poll.js'

const INTERVAL = 60_000

function scriptedFetch(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  let i = 0
  const stub = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) })
    const next = responses[Math.min(i++, responses.length - 1)]
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status })
  }) as typeof fetch
  return { stub, calls }
}

const inventory = (updatedAt: string) => ({ status: 200, body: { ok: true, data: { updatedAt } } })

let poll: InventoryPoll | null = null
const log = { warn: vi.fn(), debug: vi.fn() }

beforeEach(() => {
  vi.useFakeTimers()
  log.warn.mockClear()
  log.debug.mockClear()
})

afterEach(() => {
  poll?.stop()
  poll = null
  vi.useRealTimers()
})

function start(stub: typeof fetch, onUpdated = vi.fn()) {
  poll = startInventoryPoll({
    apiEndpoint: 'https://api.test',
    apiKey: 'mushi_test',
    projectId: 'p1',
    clientVersion: '1.2.3',
    isShuttingDown: () => false,
    log,
    onUpdated,
    fetch: stub,
    intervalMs: INTERVAL,
  })
  return { onUpdated }
}

async function nextTick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(INTERVAL)
  await poll?.settled()
}

describe('startInventoryPoll', () => {
  it('stops after a 403 and says the key needs mcp:read, once', async () => {
    const { stub, calls } = scriptedFetch([{ status: 403 }])
    start(stub)
    await poll?.settled()
    await nextTick()
    await nextTick()

    expect(calls).toHaveLength(1)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][0]).toContain('mcp:read')
  })

  it('stops after a 401 as well', async () => {
    const { stub, calls } = scriptedFetch([{ status: 401 }])
    start(stub)
    await poll?.settled()
    await nextTick()

    expect(calls).toHaveLength(1)
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('keeps polling through a 500 and a network error', async () => {
    const { stub, calls } = scriptedFetch([{ status: 500 }, new Error('ECONNRESET'), inventory('t1')])
    start(stub)
    await poll?.settled()
    await nextTick()
    await nextTick()

    expect(calls).toHaveLength(3)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('reports a change only after the first read, and only when updatedAt moves', async () => {
    const { stub } = scriptedFetch([inventory('t1'), inventory('t1'), inventory('t2')])
    const { onUpdated } = start(stub)
    await poll?.settled()
    await nextTick()
    expect(onUpdated).not.toHaveBeenCalled()
    await nextTick()
    expect(onUpdated).toHaveBeenCalledTimes(1)
    expect(onUpdated).toHaveBeenCalledWith('t2')
  })

  it('identifies itself like every other stdio request', async () => {
    const { stub, calls } = scriptedFetch([inventory('t1')])
    start(stub)
    await poll?.settled()

    expect(calls[0].url).toBe('https://api.test/v1/admin/inventory/p1')
    expect(calls[0].headers['x-mushi-client']).toBe('mcp-stdio/1.2.3')
  })
})
