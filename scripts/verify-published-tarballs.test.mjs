/**
 * FILE: scripts/verify-published-tarballs.test.mjs
 * PURPOSE: The post-publish verifier must ride out registry propagation 404s
 *          (release run 34745513175) without ever retrying a real leak.
 *          Offline: every network call is injected.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HttpError,
  RETRY_DEFAULTS,
  backoffDelay,
  collectLeaks,
  verifyPackages,
  withRetry,
} from './verify-published-tarballs.mjs'

const quiet = { log: () => {}, error: () => {} }
const noSleep = { sleep: async () => {} }

describe('withRetry', () => {
  it('retries a propagation 404 until the version appears', async () => {
    let calls = 0
    const delays = []
    const result = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw new HttpError(404, 'https://registry.npmjs.org/@mushi-mushi%2fweb/1.28.0')
        return 'ok'
      },
      { sleep: async (ms) => delays.push(ms) },
    )
    assert.equal(result, 'ok')
    assert.equal(calls, 3)
    assert.deepEqual(delays, [3_000, 6_000])
  })

  it('does not retry an error that is not marked retryable', async () => {
    let calls = 0
    await assert.rejects(
      withRetry(async () => {
        calls++
        throw new Error('tar exited 2')
      }, noSleep),
      /tar exited 2/,
    )
    assert.equal(calls, 1)
  })

  it('does not retry a 403', async () => {
    let calls = 0
    await assert.rejects(
      withRetry(async () => {
        calls++
        throw new HttpError(403, 'x')
      }, noSleep),
    )
    assert.equal(calls, 1)
  })

  it('gives up after the attempt budget with the last error', async () => {
    let calls = 0
    await assert.rejects(
      withRetry(
        async () => {
          calls++
          throw new HttpError(503, 'x')
        },
        { ...noSleep, attempts: 4 },
      ),
      /HTTP 503/,
    )
    assert.equal(calls, 4)
  })
})

describe('backoff budget', () => {
  it('caps each wait and stays within a few minutes overall', () => {
    const waits = Array.from({ length: RETRY_DEFAULTS.attempts - 1 }, (_, i) => backoffDelay(i + 1))
    assert.equal(Math.max(...waits), RETRY_DEFAULTS.maxDelayMs)
    const total = waits.reduce((a, b) => a + b, 0)
    assert.ok(total >= 4 * 60_000 && total <= 6 * 60_000, `total wait ${total}ms`)
  })
})

describe('verifyPackages', () => {
  it('passes once a lagging package propagates, and reports a leak without retrying it', async () => {
    const calls = new Map()
    const verify = async (name) => {
      calls.set(name, (calls.get(name) ?? 0) + 1)
      if (name === '@mushi-mushi/web' && calls.get(name) < 2) throw new HttpError(404, name)
      if (name === '@mushi-mushi/leaky') return [{ field: 'dependencies', name: '@mushi-mushi/core', spec: 'workspace:^' }]
      return []
    }
    const failures = await verifyPackages(
      [
        { name: '@mushi-mushi/web', version: '1.28.0' },
        { name: '@mushi-mushi/leaky', version: '0.1.0' },
      ],
      { verify, retry: noSleep, log: quiet },
    )
    assert.equal(calls.get('@mushi-mushi/web'), 2)
    assert.equal(calls.get('@mushi-mushi/leaky'), 1)
    assert.deepEqual(failures.map((f) => f.name), ['@mushi-mushi/leaky'])
  })

  it('fails a package that never appears', async () => {
    const failures = await verifyPackages([{ name: 'ghost', version: '1.0.0' }], {
      verify: async () => {
        throw new HttpError(404, 'ghost')
      },
      retry: { ...noSleep, attempts: 3 },
      log: quiet,
    })
    assert.equal(failures.length, 1)
    assert.match(failures[0].error, /HTTP 404/)
  })
})

describe('collectLeaks', () => {
  it('flags workspace-protocol specifiers in dependencies and peerDependencies', () => {
    const leaks = collectLeaks({
      dependencies: { a: 'workspace:*', b: '^1.0.0' },
      peerDependencies: { c: 'catalog:' },
      devDependencies: { d: 'workspace:*' },
    })
    assert.deepEqual(leaks.map((l) => l.name), ['a', 'c'])
  })
})
