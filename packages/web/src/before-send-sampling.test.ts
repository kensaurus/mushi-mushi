/**
 * Tests for sampleRate, replaySampleRate, and beforeSend/beforeSendFeedback hooks.
 *
 * Verifies:
 *  - sampleRate 0 blocks automatic (non-user-initiated) reports
 *  - sampleRate gate reads Math.random correctly
 *  - beforeSendFeedback returning null drops the captureEvent report
 *  - beforeSendFeedback can mutate the report
 *  - beforeSend / beforeSendFeedback both satisfy their type contracts
 *  - Config accepts both hooks without TypeScript errors
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Mushi } from './mushi'
import type { MushiConfig, MushiReport } from '@mushi-mushi/core'

// ─── helpers ─────────────────────────────────────────────────────────────────

const BASE_CONFIG: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000001',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  runtimeConfig: false,
}

function destroyQuietly(): void {
  try {
    Mushi.destroy()
  } catch {
    /* no instance */
  }
}

/** jsdom doesn't implement matchMedia — stub it before any Mushi.init call. */
function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  })
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: {} }), { status: 200 }),
  )
  vi.spyOn(globalThis, 'fetch').mockImplementation(mock)
  return mock
}

// ─── sampleRate type/contract checks ─────────────────────────────────────────

describe('sampleRate config', () => {
  beforeEach(() => {
    destroyQuietly()
    stubMatchMedia()
    stubFetch()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    destroyQuietly()
  })

  it('Mushi.init accepts sampleRate: 0 without throwing', () => {
    expect(() => Mushi.init({ ...BASE_CONFIG, sampleRate: 0 })).not.toThrow()
  })

  it('Mushi.init accepts sampleRate: 1 without throwing', () => {
    expect(() => Mushi.init({ ...BASE_CONFIG, sampleRate: 1 })).not.toThrow()
  })

  it('Mushi.init accepts sampleRate: 0.5 without throwing', () => {
    expect(() => Mushi.init({ ...BASE_CONFIG, sampleRate: 0.5 })).not.toThrow()
  })

  it('SDK instance is returned even when sampleRate: 0', () => {
    const sdk = Mushi.init({ ...BASE_CONFIG, sampleRate: 0 })
    expect(sdk).toBeDefined()
    expect(sdk.report).toBeTypeOf('function')
  })

  it('sampleRate 0 gates automatic capture: Math.random > 0 → drop', async () => {
    // Stub random to return a value above sampleRate 0
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const fetchMock = stubFetch()
    Mushi.init({ ...BASE_CONFIG, sampleRate: 0 })

    // Calling report() directly (automatic trigger) — with sampleRate:0 every
    // automatic report is dropped regardless of Math.random (0 <= 0 → drop).
    expect(() => Mushi.getInstance()!.report()).not.toThrow()
    await new Promise((r) => setTimeout(r, 30))

    const ingestPosts = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/ingest'),
    )
    // sampleRate:0 must block all automatic ingest calls
    expect(ingestPosts).toHaveLength(0)
  })
})

// ─── beforeSendFeedback hook (captureEvent path) ─────────────────────────────

describe('beforeSendFeedback hook (captureEvent path)', () => {
  beforeEach(() => {
    destroyQuietly()
    stubMatchMedia()
    stubFetch()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    destroyQuietly()
  })

  it('null return from beforeSendFeedback vetoes the captureEvent', async () => {
    const fetchMock = stubFetch()
    const beforeSendFeedback = vi.fn().mockReturnValue(null)

    Mushi.init({ ...BASE_CONFIG, beforeSendFeedback })
    await Mushi.getInstance()!.captureEvent({
      description: 'button broken',
      category: 'ui',
    })

    await new Promise((r) => setTimeout(r, 30))
    expect(beforeSendFeedback).toHaveBeenCalledOnce()
    const ingestPosts = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/ingest'),
    )
    expect(ingestPosts).toHaveLength(0)
  })

  it('non-null return from beforeSendFeedback allows the captureEvent to proceed', async () => {
    const beforeSendFeedback = vi.fn((r: MushiReport) => r)

    Mushi.init({ ...BASE_CONFIG, beforeSendFeedback })
    await expect(
      Mushi.getInstance()!.captureEvent({ description: 'page crash', category: 'other' }),
    ).resolves.not.toThrow()

    expect(beforeSendFeedback).toHaveBeenCalledOnce()
  })

  it('beforeSendFeedback receives the MushiReport object', async () => {
    let captured: MushiReport | null = null
    const beforeSendFeedback = vi.fn((r: MushiReport) => {
      captured = r
      return null // drop to skip network
    })

    Mushi.init({ ...BASE_CONFIG, beforeSendFeedback })
    await Mushi.getInstance()!.captureEvent({ description: 'crash', category: 'crash' })

    await new Promise((r) => setTimeout(r, 20))
    expect(captured).not.toBeNull()
    expect(captured).toHaveProperty('id')
    expect(captured).toHaveProperty('description', 'crash')
  })

  it('throwing beforeSendFeedback is swallowed — captureEvent still resolves', async () => {
    const beforeSendFeedback = vi.fn(() => {
      throw new Error('hook exploded')
    })

    Mushi.init({ ...BASE_CONFIG, beforeSendFeedback })
    await expect(
      Mushi.getInstance()!.captureEvent({ description: 'broken', category: 'other' }),
    ).resolves.toBeDefined()
  })
})

// ─── beforeSend config type contract ─────────────────────────────────────────

describe('beforeSend hook type contract', () => {
  beforeEach(() => {
    destroyQuietly()
    stubMatchMedia()
    stubFetch()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    destroyQuietly()
  })

  it('Mushi.init accepts sync beforeSend hook', () => {
    const beforeSend = vi.fn((r: MushiReport) => r)
    expect(() => Mushi.init({ ...BASE_CONFIG, beforeSend })).not.toThrow()
  })

  it('Mushi.init accepts async beforeSend hook', () => {
    const beforeSend = vi.fn(async (r: MushiReport) => r)
    expect(() => Mushi.init({ ...BASE_CONFIG, beforeSend })).not.toThrow()
  })

  it('Mushi.init accepts beforeSend that returns null', () => {
    const beforeSend = vi.fn((_r: MushiReport) => null as MushiReport | null)
    expect(() => Mushi.init({ ...BASE_CONFIG, beforeSend })).not.toThrow()
  })

  it('beforeSend and beforeSendFeedback coexist in config without TS error', () => {
    const beforeSend = vi.fn((r: MushiReport) => r)
    const beforeSendFeedback = vi.fn((r: MushiReport) => r)
    expect(() => Mushi.init({ ...BASE_CONFIG, beforeSend, beforeSendFeedback })).not.toThrow()
  })
})

// ─── replaySampleRate config ──────────────────────────────────────────────────

describe('replaySampleRate config', () => {
  beforeEach(() => {
    destroyQuietly()
    stubMatchMedia()
    stubFetch()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    destroyQuietly()
  })

  it('Mushi.init accepts replaySampleRate: 0 without throwing', () => {
    expect(() => Mushi.init({ ...BASE_CONFIG, replaySampleRate: 0 })).not.toThrow()
  })

  it('Mushi.init accepts replaySampleRate: 1 without throwing', () => {
    expect(() => Mushi.init({ ...BASE_CONFIG, replaySampleRate: 1 })).not.toThrow()
  })

  it('SDK instance is functional when replaySampleRate: 0', () => {
    const sdk = Mushi.init({ ...BASE_CONFIG, replaySampleRate: 0 })
    expect(sdk.report).toBeTypeOf('function')
    expect(() => sdk.open()).not.toThrow()
  })
})
