/**
 * FILE: packages/svelte/src/__tests__/index.test.ts
 * PURPOSE: Unit tests for the Svelte Mushi SDK — init, getMushi, error handler.
 *
 * OVERVIEW:
 * - Verifies initMushi creates an instance with correct config
 * - Tests getMushi throws before init and returns instance after
 * - Tests createMushiErrorHandler returns a callable function
 * - Tests submitReport delegates to the API client
 *
 * DEPENDENCIES:
 * - vitest for test runner and mocking
 * - @mushi-mushi/core mocked entirely
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSubmitReport = vi.fn().mockResolvedValue(undefined)
const mockClient = { submitReport: mockSubmitReport }

vi.mock('@mushi-mushi/core', () => ({
  createApiClient: vi.fn(() => mockClient),
  captureEnvironment: vi.fn(() => ({ userAgent: 'test' })),
  getSessionId: vi.fn(() => 'session-123'),
  getReporterToken: vi.fn(() => 'token-abc'),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  })),
}))

const testConfig = {
  projectId: 'proj_test',
  apiKey: 'key_test',
  endpoint: 'https://test.api',
}

let initMushi: typeof import('../index').initMushi
let getMushi: typeof import('../index').getMushi
let createMushiErrorHandler: typeof import('../index').createMushiErrorHandler

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()

  vi.mock('@mushi-mushi/core', () => ({
    createApiClient: vi.fn(() => mockClient),
    captureEnvironment: vi.fn(() => ({ userAgent: 'test' })),
    getSessionId: vi.fn(() => 'session-123'),
    getReporterToken: vi.fn(() => 'token-abc'),
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    })),
  }))

  const mod = await import('../index')
  initMushi = mod.initMushi
  getMushi = mod.getMushi
  createMushiErrorHandler = mod.createMushiErrorHandler
})

describe('initMushi', () => {
  it('creates an instance with submitReport and captureError', () => {
    const instance = initMushi(testConfig)

    expect(instance).toBeDefined()
    expect(typeof instance.submitReport).toBe('function')
    expect(typeof instance.captureError).toBe('function')
  })

  it('calls createApiClient with correct config', async () => {
    initMushi(testConfig)

    const { createApiClient } = await import('@mushi-mushi/core')
    expect(createApiClient).toHaveBeenCalledWith({
      projectId: 'proj_test',
      apiKey: 'key_test',
      apiEndpoint: 'https://test.api',
    })
  })
})

describe('getMushi', () => {
  it('throws before initMushi is called', () => {
    expect(() => getMushi()).toThrow('Call initMushi() first')
  })

  it('returns the instance after initMushi', () => {
    const instance = initMushi(testConfig)
    expect(getMushi()).toBe(instance)
  })
})

describe('createMushiErrorHandler', () => {
  it('returns a function', () => {
    const handler = createMushiErrorHandler()
    expect(typeof handler).toBe('function')
  })

  it('calls captureError when instance exists', () => {
    const instance = initMushi(testConfig)
    const spy = vi.spyOn(instance, 'captureError')

    const handler = createMushiErrorHandler()
    handler({ error: new Error('test error'), event: { url: { pathname: '/test' } } })

    expect(spy).toHaveBeenCalledWith(expect.any(Error), { route: '/test' })
  })
})

describe('submitReport', () => {
  it('calls the API client submitReport', async () => {
    const instance = initMushi(testConfig)
    await instance.submitReport({ description: 'bug found', category: 'bug' })

    expect(mockSubmitReport).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj_test',
        description: 'bug found',
        category: 'bug',
      }),
    )
  })
})
