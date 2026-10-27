/**
 * FILE: lifecycle-hooks.test.ts
 * PURPOSE: Contract tests for `beforeSendFeedback` and `onCrashedLastRun`.
 *
 * OVERVIEW:
 * - Drop (null), modify, throw, and the 2s timeout all run on `captureEvent`.
 * - A timeout or a throw sends the unmodified report.
 * - `onCrashedLastRun` reads the `mushi:last-run` localStorage sentinel.
 *
 * DEPENDENCIES: vitest, ./mushi, @mushi-mushi/core
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MushiConfig } from '@mushi-mushi/core'
import { Mushi } from './mushi'

const BASE_CONFIG: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000001',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  runtimeConfig: false,
}

const SENTINEL = 'mushi:last-run'
const ORIGINAL = 'original feedback text'

function destroyQuietly(): void {
  try { Mushi.destroy() } catch { /* no instance */ }
}

function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => new Response(
    JSON.stringify({ ok: true, data: { reportId: 'r-1' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ))
  vi.stubGlobal('fetch', mock)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  return mock
}

function reportPosts(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url, init]) => {
      const method = (init as RequestInit | undefined)?.method
      return typeof url === 'string' && url.includes('/v1/reports') && method === 'POST'
    })
    .map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>)
}

describe('beforeSendFeedback', () => {
  beforeEach(() => {
    destroyQuietly()
    stubMatchMedia()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    destroyQuietly()
  })

  it('drops the report when the hook returns null', async () => {
    const fetchMock = stubFetch()
    Mushi.init({ ...BASE_CONFIG, beforeSendFeedback: () => null })
    await expect(
      Mushi.getInstance()!.captureEvent({ description: ORIGINAL, category: 'bug' }),
    ).resolves.toBeNull()
    expect(reportPosts(fetchMock)).toHaveLength(0)
  })

  it('sends the report the hook returns', async () => {
    const fetchMock = stubFetch()
    Mushi.init({
      ...BASE_CONFIG,
      beforeSendFeedback: (report) => ({ ...report, description: 'rewritten by the hook' }),
    })
    await expect(
      Mushi.getInstance()!.captureEvent({ description: ORIGINAL, category: 'bug' }),
    ).resolves.toBe('r-1')
    expect(reportPosts(fetchMock)[0]?.description).toBe('rewritten by the hook')
  })

  it('sends an async hook result that settles within 2s', async () => {
    const fetchMock = stubFetch()
    Mushi.init({
      ...BASE_CONFIG,
      beforeSendFeedback: (report) => new Promise((resolve) => {
        setTimeout(() => resolve({ ...report, description: 'rewritten async' }), 50)
      }),
    })
    vi.useFakeTimers()
    const pending = Mushi.getInstance()!.captureEvent({ description: ORIGINAL, category: 'bug' })
    await vi.advanceTimersByTimeAsync(50)
    await pending
    expect(reportPosts(fetchMock)[0]?.description).toBe('rewritten async')
  })

  it('sends the unmodified report when the hook rejects', async () => {
    const fetchMock = stubFetch()
    Mushi.init({
      ...BASE_CONFIG,
      beforeSendFeedback: () => Promise.reject(new Error('hook rejected')),
    })
    await expect(
      Mushi.getInstance()!.captureEvent({ description: ORIGINAL, category: 'bug' }),
    ).resolves.toBe('r-1')
    expect(reportPosts(fetchMock)[0]?.description).toBe(ORIGINAL)
  })

  it('sends the unmodified report when the hook throws', async () => {
    const fetchMock = stubFetch()
    Mushi.init({
      ...BASE_CONFIG,
      beforeSendFeedback: () => { throw new Error('hook exploded') },
    })
    await expect(
      Mushi.getInstance()!.captureEvent({ description: ORIGINAL, category: 'bug' }),
    ).resolves.toBe('r-1')
    expect(reportPosts(fetchMock)[0]?.description).toBe(ORIGINAL)
  })

  it('sends the unmodified report when the hook exceeds 2s', async () => {
    const fetchMock = stubFetch()
    Mushi.init({
      ...BASE_CONFIG,
      beforeSendFeedback: (report) => new Promise((resolve) => {
        setTimeout(() => resolve({ ...report, description: 'too late' }), 10_000)
      }),
    })
    vi.useFakeTimers()
    let settled = false
    const pending = Mushi.getInstance()!.captureEvent({ description: ORIGINAL, category: 'bug' })
      .then((id) => { settled = true; return id })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(reportPosts(fetchMock)[0]?.description).toBe(ORIGINAL)
  })
})

describe('onCrashedLastRun', () => {
  beforeEach(() => {
    destroyQuietly()
    localStorage.removeItem(SENTINEL)
    stubMatchMedia()
    stubFetch()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    destroyQuietly()
    localStorage.removeItem(SENTINEL)
  })

  it('passes null, then true after an unclean exit, then false after pagehide', () => {
    const first = vi.fn()
    Mushi.init({ ...BASE_CONFIG, onCrashedLastRun: first })
    expect(first).toHaveBeenCalledExactlyOnceWith(null)
    expect(localStorage.getItem(SENTINEL)).toBe('unfinished')
    destroyQuietly()

    const crashed = vi.fn()
    Mushi.init({ ...BASE_CONFIG, onCrashedLastRun: crashed })
    expect(crashed).toHaveBeenCalledExactlyOnceWith(true)
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem(SENTINEL)).toBe('clean')
    destroyQuietly()

    const clean = vi.fn()
    Mushi.init({ ...BASE_CONFIG, onCrashedLastRun: clean })
    expect(clean).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('a throwing hook does not break init', () => {
    expect(() => Mushi.init({
      ...BASE_CONFIG,
      onCrashedLastRun: () => { throw new Error('host broke') },
    })).not.toThrow()
    expect(Mushi.getInstance()).not.toBeNull()
    expect(localStorage.getItem(SENTINEL)).toBe('unfinished')
  })
})
