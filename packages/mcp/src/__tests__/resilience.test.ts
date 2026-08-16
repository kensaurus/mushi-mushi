/**
 * FILE: packages/mcp/src/__tests__/resilience.test.ts
 * PURPOSE: Regression tests for the stdio-resilience fixes:
 *          - every apiCall is bounded by a timeout, and a timeout is reported
 *            differently from "the host is unreachable" (C6)
 *          - submit_fix_result derives a STABLE Idempotency-Key so a retry
 *            dedupes instead of double-writing, and a half-applied two-step
 *            write says so out loud (C7)
 *          - the stdout purity guard covers every stdout-bound console method
 *            and is reachable from the ./server export path (C8)
 *          - project resolution distinguishes network / auth / config failure
 *            and is memoised (H + M)
 *
 *          These assert behaviour through the real MCP protocol wherever
 *          possible, so a refactor that keeps the helper but stops wiring it
 *          into tool calls still fails the suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer, resolveTimeoutMsFromEnv } from '../server.js'
import {
  installStdoutGuard,
  isStdoutGuardInstalled,
  GUARDED_CONSOLE_METHODS,
} from '../stdout-guard.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const API_KEY = 'mushi_test_key_0123456789'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  hasSignal: boolean
}

/** Recording stub fetch with a queue of canned envelope responses. */
function createStubFetch() {
  const calls: FetchCall[] = []
  const queue: Array<{ status: number; body: unknown }> = []

  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v
      }
    }
    let body: unknown = undefined
    if (typeof init?.body === 'string' && init.body.length > 0) {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    calls.push({ url, method: init?.method ?? 'GET', headers, body, hasSignal: !!init?.signal })
    const next = queue.shift()
    if (!next) throw new Error(`No queued response for ${init?.method ?? 'GET'} ${url}`)
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch

  return {
    stub,
    calls,
    enqueue(body: unknown, status = 200) {
      queue.push({ status, body })
    },
  }
}

/**
 * A fetch that never answers — it only settles when the caller's abort signal
 * fires, rejecting with the signal's reason exactly like undici does. This is
 * the shape of the failure the timeout exists for (connection accepted, no
 * response), and it also proves the signal is actually threaded into fetch.
 */
function createHangingFetch() {
  const seen: Array<{ url: string; signal: AbortSignal | null | undefined }> = []
  const stub = vi.fn(
    (url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        seen.push({ url, signal: init?.signal })
        const signal = init?.signal
        if (!signal) return // hangs forever — the test times out, as it should
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
      }),
  ) as unknown as typeof fetch
  return { stub, seen }
}

async function connect(
  overrides: Partial<Parameters<typeof createMushiServer>[0]> & { fetch: typeof fetch },
) {
  const server = createMushiServer({
    version: '0.0.0-test',
    apiEndpoint: API_ENDPOINT,
    apiKey: API_KEY,
    projectId: PROJECT_ID,
    ...overrides,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'mushi-resilience-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

/** Text of the first content block of a tool result. */
function firstText(res: Awaited<ReturnType<Client['callTool']>>): string {
  const content = res.content as Array<{ type: string; text: string }>
  return content[0]?.text ?? ''
}

// ─── C6: request timeouts ───────────────────────────────────────────────────

describe('apiCall timeout (C6)', () => {
  let client: Client | undefined
  afterEach(async () => {
    await client?.close()
    client = undefined
  })

  it('passes an abort signal into every fetch so no call can hang forever', async () => {
    const hanging = createHangingFetch()
    client = await connect({ fetch: hanging.stub, timeoutMs: 60 })
    await client.callTool({ name: 'get_recent_reports', arguments: {} })
    expect(hanging.seen).toHaveLength(1)
    expect(hanging.seen[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('surfaces a hung request as MUSHI_TIMEOUT with the budget and the override knob', async () => {
    const hanging = createHangingFetch()
    client = await connect({ fetch: hanging.stub, timeoutMs: 60 })
    const res = await client.callTool({ name: 'get_recent_reports', arguments: {} })
    expect(res.isError).toBe(true)
    const text = firstText(res)
    expect(text).toContain('MUSHI_TIMEOUT')
    expect(text).toContain('60ms')
    expect(text).toContain('MUSHI_MCP_TIMEOUT_MS')
  })

  it('bounds the body read too — headers sent, body stalled', async () => {
    // undici keeps the abort signal attached to the response body, so a
    // server that answers with headers and then stalls the stream errors the
    // body read. Before this, the timeout only covered the fetch promise and
    // `res.text()` could hang the tool call for ever.
    const stalling = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal
      const stream = new ReadableStream({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(signal.reason as Error), {
            once: true,
          })
        },
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch

    client = await connect({ fetch: stalling, timeoutMs: 60 })
    const res = await client.callTool({ name: 'get_recent_reports', arguments: {} })
    expect(res.isError).toBe(true)
    expect(firstText(res)).toContain('MUSHI_TIMEOUT')
  })

  it('distinguishes an unreachable host (NETWORK_ERROR) from a timeout', async () => {
    const dead = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    client = await connect({ fetch: dead, timeoutMs: 5_000 })
    const res = await client.callTool({ name: 'get_recent_reports', arguments: {} })
    expect(res.isError).toBe(true)
    const text = firstText(res)
    expect(text).toContain('NETWORK_ERROR')
    expect(text).toContain('connectivity failure')
    expect(text).toContain('MUSHI_API_ENDPOINT')
    // Must NOT be misreported as a timeout — that sends operators to the wrong knob.
    expect(text).not.toContain('MUSHI_TIMEOUT')
  })

  it('honours MUSHI_MCP_TIMEOUT_MS when no explicit timeout is configured', async () => {
    const prev = process.env.MUSHI_MCP_TIMEOUT_MS
    process.env.MUSHI_MCP_TIMEOUT_MS = '250'
    try {
      const hanging = createHangingFetch()
      client = await connect({ fetch: hanging.stub })
      const res = await client.callTool({ name: 'get_recent_reports', arguments: {} })
      expect(firstText(res)).toContain('250ms')
    } finally {
      if (prev === undefined) delete process.env.MUSHI_MCP_TIMEOUT_MS
      else process.env.MUSHI_MCP_TIMEOUT_MS = prev
    }
  })

  it('clamps a nonsense MUSHI_MCP_TIMEOUT_MS instead of bricking every tool call', () => {
    const prev = process.env.MUSHI_MCP_TIMEOUT_MS
    try {
      delete process.env.MUSHI_MCP_TIMEOUT_MS
      expect(resolveTimeoutMsFromEnv()).toBe(15_000)
      process.env.MUSHI_MCP_TIMEOUT_MS = '30000'
      expect(resolveTimeoutMsFromEnv()).toBe(30_000)
      // "5" almost certainly meant 5 seconds — clamp to the floor, don't make
      // every request fail before it leaves the machine.
      process.env.MUSHI_MCP_TIMEOUT_MS = '5'
      expect(resolveTimeoutMsFromEnv()).toBe(250)
      process.env.MUSHI_MCP_TIMEOUT_MS = '99999999'
      expect(resolveTimeoutMsFromEnv()).toBe(300_000)
      process.env.MUSHI_MCP_TIMEOUT_MS = 'soon'
      expect(resolveTimeoutMsFromEnv()).toBe(15_000)
      process.env.MUSHI_MCP_TIMEOUT_MS = '-1'
      expect(resolveTimeoutMsFromEnv()).toBe(15_000)
    } finally {
      if (prev === undefined) delete process.env.MUSHI_MCP_TIMEOUT_MS
      else process.env.MUSHI_MCP_TIMEOUT_MS = prev
    }
  })
})

// ─── C7: submit_fix_result idempotency + two-step write ─────────────────────

describe('submit_fix_result idempotency (C7)', () => {
  let fetchStub: ReturnType<typeof createStubFetch>
  let client: Client

  const ARGS = {
    reportId: '22222222-2222-4222-8222-222222222222',
    branch: 'fix/centre-button',
    prUrl: 'https://github.com/x/y/pull/42',
    filesChanged: ['src/Button.tsx'],
    linesChanged: 7,
    summary: 'centre the button',
  }

  beforeEach(async () => {
    fetchStub = createStubFetch()
    client = await connect({ fetch: fetchStub.stub })
  })
  afterEach(async () => {
    await client.close()
  })

  const enqueueHappyPath = () => {
    fetchStub.enqueue({ ok: true, data: { fixId: 'fix_99' } })
    fetchStub.enqueue({ ok: true, data: { updated: true } })
  }

  it('derives the same Idempotency-Key for a retried submission', async () => {
    enqueueHappyPath()
    await client.callTool({ name: 'submit_fix_result', arguments: ARGS })
    enqueueHappyPath()
    await client.callTool({ name: 'submit_fix_result', arguments: ARGS })

    const posts = fetchStub.calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(2)
    const [first, second] = posts.map((c) => c.headers['idempotency-key'])
    expect(first).toBeTruthy()
    // The whole point: a retry must reuse the key so the server replays the
    // stored response instead of creating a second fix_attempt row.
    expect(second).toBe(first)
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('derives a different key for a different fix on the same report', async () => {
    enqueueHappyPath()
    await client.callTool({ name: 'submit_fix_result', arguments: ARGS })
    enqueueHappyPath()
    await client.callTool({
      name: 'submit_fix_result',
      arguments: { ...ARGS, branch: 'fix/other-branch' },
    })
    const posts = fetchStub.calls.filter((c) => c.method === 'POST')
    expect(posts[0].headers['idempotency-key']).not.toBe(posts[1].headers['idempotency-key'])
  })

  it('still honours a caller-supplied idempotencyKey', async () => {
    const explicit = '33333333-3333-4333-8333-333333333333'
    enqueueHappyPath()
    await client.callTool({
      name: 'submit_fix_result',
      arguments: { ...ARGS, idempotencyKey: explicit },
    })
    expect(fetchStub.calls[0].headers['idempotency-key']).toBe(explicit)
  })

  it('reports a failed step 2 as a half-applied write that is safe to retry', async () => {
    fetchStub.enqueue({ ok: true, data: { fixId: 'fix_77' } })
    fetchStub.enqueue({ ok: false, error: { code: 'DB_ERROR', message: 'row lock timeout' } }, 500)

    const res = await client.callTool({ name: 'submit_fix_result', arguments: ARGS })
    expect(res.isError).toBe(true)
    const text = firstText(res)
    expect(text).toContain('FIX_PATCH_FAILED')
    expect(text).toContain('fix_77') // which row is half-applied
    expect(text).toContain('was created') // the create DID happen
    expect(text).toContain('pending') // …and is recoverable, not lost
    expect(text).toContain('PATCH /v1/admin/fixes/fix_77') // the exact repair
    expect(text).toContain('row lock timeout') // the underlying cause survives
  })
})

// ─── C8: stdout purity guard ────────────────────────────────────────────────

describe('stdout purity guard (C8)', () => {
  it('is installed as a side effect of importing the ./server entrypoint', () => {
    // server.js is imported at the top of this file; the guard must already be
    // active without index.ts having run.
    expect(isStdoutGuardInstalled()).toBe(true)
    // Idempotent: a second install is a no-op, not a double-patch.
    expect(installStdoutGuard()).toBe(false)
  })

  it('keeps every stdout-bound console method off stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      // The methods that used to escape the old log/warn-only patch.
      /* eslint-disable no-console -- calling them IS the assertion */
      console.log('log')
      console.info('info')
      console.debug('debug')
      console.dir({ a: 1 })
      console.table([{ a: 1 }])
      console.group('group')
      console.count('counter')
      console.groupEnd()
      console.time('t')
      console.timeEnd('t')
      console.trace('trace')
      console.warn('warn')
      console.error('error')
      /* eslint-enable no-console */

      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(stderrSpy).toHaveBeenCalled()
    } finally {
      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
    }
  })

  it('guards the full documented method set', () => {
    for (const method of GUARDED_CONSOLE_METHODS) {
      expect(typeof (console as unknown as Record<string, unknown>)[method]).toBe('function')
    }
    // The old inline patch covered only these two.
    expect(GUARDED_CONSOLE_METHODS).toContain('log')
    expect(GUARDED_CONSOLE_METHODS).toContain('warn')
    for (const leaked of ['info', 'debug', 'dir', 'table', 'group', 'count', 'timeEnd', 'trace']) {
      expect(GUARDED_CONSOLE_METHODS).toContain(leaked)
    }
  })
})

// ─── H/M: project resolution diagnosis + memoisation ────────────────────────

describe('resolveProjectId diagnosis and memoisation (H, M)', () => {
  let client: Client | undefined
  afterEach(async () => {
    await client?.close()
    client = undefined
  })

  it('memoises the account-mode probe instead of re-resolving on every call', async () => {
    const fetchStub = createStubFetch()
    fetchStub.enqueue({ ok: true, data: { projects: [{ id: PROJECT_ID, name: 'Solo' }], total: 1 } })
    fetchStub.enqueue({ ok: true, data: { reports: [], total: 0 } })
    fetchStub.enqueue({ ok: true, data: { reports: [], total: 0 } })

    client = await connect({ fetch: fetchStub.stub, projectId: undefined })
    await client.callTool({ name: 'get_recent_reports', arguments: {} })
    const second = await client.callTool({ name: 'get_recent_reports', arguments: {} })
    expect(second.isError).toBeFalsy()

    const probes = fetchStub.calls.filter((c) => c.url.includes('/mcp/account-overview'))
    expect(probes).toHaveLength(1)
    // The memoised id is still applied to the scoped call.
    expect(fetchStub.calls[2].headers['x-mushi-project-id']).toBe(PROJECT_ID)
  })

  it('reports an unreachable API as a connectivity problem, not a missing project id', async () => {
    const dead = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    client = await connect({ fetch: dead, projectId: undefined, timeoutMs: 5_000 })
    const res = await client.callTool({ name: 'get_recent_reports', arguments: {} })
    expect(res.isError).toBe(true)
    const text = firstText(res)
    expect(text).toContain('NETWORK_ERROR')
    expect(text).toContain('unreachable')
    // The old message told everyone to set MUSHI_PROJECT_ID, which fixes nothing here.
    expect(text).not.toContain('MISSING_PROJECT_ID')
  })

  it('reports a rejected key as an auth problem, not a missing project id', async () => {
    const fetchStub = createStubFetch()
    fetchStub.enqueue(
      { ok: false, error: { code: 'INVALID_API_KEY', message: 'API key not found or revoked' } },
      401,
    )
    client = await connect({ fetch: fetchStub.stub, projectId: undefined })
    const res = await client.callTool({ name: 'get_recent_reports', arguments: {} })
    expect(res.isError).toBe(true)
    const text = firstText(res)
    expect(text).toContain('INVALID_API_KEY')
    expect(text).toContain('rejected')
    expect(text).toContain('authentication problem')
    expect(text).not.toContain('MISSING_PROJECT_ID')
  })
})
