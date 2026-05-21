/**
 * FILE: packages/svelte/src/__tests__/index.test.ts
 * PURPOSE: Unit tests for the Svelte Mushi SDK — init, getMushi, error handler.
 *
 * OVERVIEW:
 * - Verifies initMushi delegates to Mushi.init() from @mushi-mushi/web
 * - Tests getMushi throws before init and delegates to Mushi.getInstance()
 * - Tests createMushiErrorHandler calls captureException on the SDK instance
 * - After init, Mushi.getInstance() returns the SDK instance (parity check)
 *
 * DEPENDENCIES:
 * - vitest for test runner and mocking
 * - @mushi-mushi/web mocked entirely
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  initMushi as InitMushi,
  getMushi as GetMushi,
  createMushiErrorHandler as CreateMushiErrorHandler,
  mushiHandleError as MushiHandleError,
} from '../index'

const mockCaptureException = vi.fn().mockResolvedValue(null)
const mockCaptureEvent = vi.fn().mockResolvedValue('report-id')

const mockSdkInstance = {
  captureException: mockCaptureException,
  captureEvent: mockCaptureEvent,
  open: vi.fn(),
  close: vi.fn(),
  isOpen: vi.fn().mockReturnValue(false),
}

let _sdkInstance: typeof mockSdkInstance | null = null

vi.mock('@mushi-mushi/web', () => ({
  Mushi: {
    init: vi.fn((_config: unknown) => { _sdkInstance = mockSdkInstance; return mockSdkInstance }),
    getInstance: vi.fn(() => _sdkInstance),
    destroy: vi.fn(() => { _sdkInstance = null }),
  },
}))

const testConfig = {
  projectId: 'proj_test',
  apiKey: 'key_test',
  apiEndpoint: 'https://test.api',
}

let initMushi: typeof InitMushi
let getMushi: typeof GetMushi
let createMushiErrorHandler: typeof CreateMushiErrorHandler
let mushiHandleError: typeof MushiHandleError

beforeEach(async () => {
  vi.clearAllMocks()
  _sdkInstance = null
  vi.resetModules()

  vi.mock('@mushi-mushi/web', () => ({
    Mushi: {
      init: vi.fn((_config: unknown) => { _sdkInstance = mockSdkInstance; return mockSdkInstance }),
      getInstance: vi.fn(() => _sdkInstance),
      destroy: vi.fn(() => { _sdkInstance = null }),
    },
  }))

  const mod = await import('../index')
  initMushi = mod.initMushi
  getMushi = mod.getMushi
  createMushiErrorHandler = mod.createMushiErrorHandler
  mushiHandleError = mod.mushiHandleError
})

describe('initMushi', () => {
  it('calls Mushi.init with the canonical config (forwarded as-is)', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    initMushi(testConfig)

    expect(Mushi.init).toHaveBeenCalledWith(testConfig)
  })

  it('forwards Round 7 fields (beforeSendFeedback, theme, …) to Mushi.init', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    const beforeSend = vi.fn(async (r: unknown) => r)
    initMushi({
      ...testConfig,
      beforeSendFeedback: beforeSend,
      theme: 'dark',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const initArg = (Mushi.init as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    expect((initArg as Record<string, unknown>).beforeSendFeedback).toBe(beforeSend)
    expect((initArg as Record<string, unknown>).theme).toBe('dark')
  })

  it('returns null on the server (SSR safety)', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    const originalWindow = globalThis.window
    const originalDocument = globalThis.document
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).document
    try {
      const result = initMushi(testConfig)
      expect(result).toBeNull()
      expect(Mushi.init).not.toHaveBeenCalled()
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = originalWindow
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).document = originalDocument
    }
  })

  it('returns the SDK instance from Mushi.init()', () => {
    const instance = initMushi(testConfig)
    expect(instance).toBeDefined()
    expect(instance).toBe(mockSdkInstance)
  })

  it('after init, Mushi.getInstance() returns the instance (parity check)', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    initMushi(testConfig)
    expect(Mushi.getInstance()).toBe(mockSdkInstance)
  })
})

describe('getMushi', () => {
  it('throws before initMushi is called', () => {
    expect(() => getMushi()).toThrow(/Mushi not initialised/)
  })

  it('returns the instance after initMushi', () => {
    initMushi(testConfig)
    expect(getMushi()).toBe(mockSdkInstance)
  })
})

describe('createMushiErrorHandler', () => {
  it('returns a function', () => {
    const handler = createMushiErrorHandler()
    expect(typeof handler).toBe('function')
  })

  it('calls captureException when instance is available', () => {
    initMushi(testConfig)
    const handler = createMushiErrorHandler()
    handler({ error: new Error('test error'), event: { url: { pathname: '/test' } } })

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ metadata: { route: '/test' } }),
    )
  })

  it('does not throw when no instance is available', () => {
    const handler = createMushiErrorHandler()
    expect(() => handler({ error: new Error('test') })).not.toThrow()
  })
})

describe('mushiHandleError (SvelteKit handleError shape)', () => {
  it('captures the error and forwards SvelteKit metadata', () => {
    initMushi(testConfig)
    const hook = mushiHandleError()
    hook({
      error: new Error('boom'),
      event: { url: { pathname: '/api/x' }, request: { method: 'POST' } },
      status: 500,
      message: 'Internal Server Error',
    })
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        source: 'sveltekit-handle-error',
        metadata: expect.objectContaining({
          route: '/api/x',
          method: 'POST',
          status: 500,
          message: 'Internal Server Error',
        }),
      }),
    )
  })

  it('returns the result of the formatter so SvelteKit pages get App.Error', () => {
    initMushi(testConfig)
    const hook = mushiHandleError({
      format: () => ({ message: 'Internal error', code: 'E_INTERNAL' }),
    })
    const result = hook({ error: new Error('boom') })
    expect(result).toEqual({ message: 'Internal error', code: 'E_INTERNAL' })
  })

  it('returns void when no formatter is provided', () => {
    initMushi(testConfig)
    const hook = mushiHandleError()
    expect(hook({ error: new Error('boom') })).toBeUndefined()
  })

  it('does not crash if the SDK was never initialised (server-only context)', () => {
    const hook = mushiHandleError()
    expect(() => hook({ error: new Error('boom') })).not.toThrow()
    expect(mockCaptureException).not.toHaveBeenCalled()
  })
})
