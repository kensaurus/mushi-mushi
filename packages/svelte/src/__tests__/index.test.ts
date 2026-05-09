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
import type { initMushi as InitMushi, getMushi as GetMushi, createMushiErrorHandler as CreateMushiErrorHandler } from '../index'

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
  endpoint: 'https://test.api',
}

let initMushi: typeof InitMushi
let getMushi: typeof GetMushi
let createMushiErrorHandler: typeof CreateMushiErrorHandler

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
})

describe('initMushi', () => {
  it('calls Mushi.init with correct config', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    initMushi(testConfig)

    expect(Mushi.init).toHaveBeenCalledWith({
      projectId: 'proj_test',
      apiKey: 'key_test',
      apiEndpoint: 'https://test.api',
    })
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
    expect(() => getMushi()).toThrow('Call initMushi() first')
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
