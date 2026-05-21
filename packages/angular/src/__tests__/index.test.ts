/**
 * FILE: packages/angular/src/__tests__/index.test.ts
 * PURPOSE: Unit tests for the Angular Mushi SDK — MushiService, MushiErrorHandler, provideMushi.
 *
 * OVERVIEW:
 * - Verifies MushiService constructor delegates to Mushi.init() from @mushi-mushi/web
 * - Tests report() and submitReport() delegate to the SDK captureEvent
 * - Tests captureError delegates to captureException
 * - Tests MushiErrorHandler.handleError delegates to MushiService.captureError
 * - Tests provideMushi factory returns service + errorHandler pair
 * - After init, Mushi.getInstance() returns the SDK instance (parity check)
 *
 * DEPENDENCIES:
 * - vitest for test runner and mocking
 * - @mushi-mushi/web mocked entirely
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// `vi.mock` is hoisted ABOVE module-level `const` declarations, so the
// factory cannot reference closure variables defined below it (TDZ:
// "Cannot access 'mockInit' before initialization"). `vi.hoisted` lifts
// the mock state so the factory and the test body see the same `vi.fn`s.
const mocks = vi.hoisted(() => {
  const mockCaptureException = vi.fn().mockResolvedValue(null)
  const mockCaptureEvent = vi.fn().mockResolvedValue('report-id')
  const mockSdkInstance = {
    captureException: mockCaptureException,
    captureEvent: mockCaptureEvent,
    open: vi.fn(),
    close: vi.fn(),
  }
  return {
    mockCaptureException,
    mockCaptureEvent,
    mockSdkInstance,
    mockInit: vi.fn().mockReturnValue(mockSdkInstance),
    mockGetInstance: vi.fn().mockReturnValue(mockSdkInstance),
  }
})
const { mockCaptureException, mockCaptureEvent, mockSdkInstance, mockInit, mockGetInstance } = mocks

vi.mock('@mushi-mushi/web', () => ({
  Mushi: {
    init: mocks.mockInit,
    getInstance: mocks.mockGetInstance,
    destroy: vi.fn(),
  },
}))

import { MushiService, MushiErrorHandler, provideMushi, provideMushiAngular, MUSHI_CONFIG } from '../index'

const testConfig = {
  projectId: 'proj_test',
  apiKey: 'key_test',
  apiEndpoint: 'https://test.api',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInit.mockReturnValue(mockSdkInstance)
  mockGetInstance.mockReturnValue(mockSdkInstance)
})

describe('MushiService', () => {
  it('constructor delegates to Mushi.init with the canonical config (forwarded as-is)', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    new MushiService(testConfig)
    expect(Mushi.init).toHaveBeenCalledWith(testConfig)
  })

  it('forwards Round 7 fields (beforeSendFeedback, theme, …) to Mushi.init', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    const beforeSend = vi.fn(async (r: unknown) => r)
    new MushiService({
      ...testConfig,
      beforeSendFeedback: beforeSend,
      theme: 'dark',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const initArg = (Mushi.init as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    expect((initArg as Record<string, unknown>).beforeSendFeedback).toBe(beforeSend)
    expect((initArg as Record<string, unknown>).theme).toBe('dark')
  })

  it('after init, Mushi.getInstance() returns the instance (parity check)', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    new MushiService(testConfig)
    expect(Mushi.getInstance()).toBeDefined()
    expect(Mushi.getInstance()).toBe(mockSdkInstance)
  })

  it('defers to core default endpoint when not provided', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    new MushiService({ projectId: 'p', apiKey: 'k' })

    const call = (Mushi.init as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(call?.[0]).not.toHaveProperty('apiEndpoint')
  })

  it('skips Mushi.init on the server (Angular Universal SSR)', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    const originalWindow = globalThis.window
    const originalDocument = globalThis.document
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).document
    try {
      new MushiService(testConfig)
      expect(Mushi.init).not.toHaveBeenCalled()
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = originalWindow
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).document = originalDocument
    }
  })

  it('skips Mushi.init when no config is provided (DI optional path)', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    new MushiService(undefined)
    expect(Mushi.init).not.toHaveBeenCalled()
  })

  it('report() calls captureEvent on the SDK instance', async () => {
    const service = new MushiService(testConfig)
    await service.report({ description: 'test bug', category: 'bug' })

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'test bug',
        category: 'bug',
      }),
    )
  })

  it('submitReport() delegates to report() for backwards compatibility', async () => {
    const service = new MushiService(testConfig)
    await service.submitReport({ description: 'test bug', category: 'bug' })

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'test bug',
        category: 'bug',
      }),
    )
  })

  it('captureError calls captureException on the SDK instance', () => {
    const service = new MushiService(testConfig)
    service.captureError(new Error('something broke'))

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({}),
    )
  })

  it('captureError handles string errors', () => {
    const service = new MushiService(testConfig)
    service.captureError('string error')

    expect(mockCaptureException).toHaveBeenCalledWith(
      'string error',
      expect.objectContaining({}),
    )
  })
})

describe('MushiErrorHandler', () => {
  it('handleError delegates to service.captureError', () => {
    const service = new MushiService(testConfig)
    const spy = vi.spyOn(service, 'captureError')
    const handler = new MushiErrorHandler(service)

    const err = new Error('unhandled')
    handler.handleError(err)

    expect(spy).toHaveBeenCalledWith(err)
  })
})

describe('provideMushi', () => {
  it('returns service and errorHandler', () => {
    const result = provideMushi(testConfig)

    expect(result.service).toBeInstanceOf(MushiService)
    expect(result.errorHandler).toBeInstanceOf(MushiErrorHandler)
  })

  it('errorHandler is wired to the same service', () => {
    const result = provideMushi(testConfig)
    const spy = vi.spyOn(result.service, 'captureError')

    result.errorHandler.handleError(new Error('test'))
    expect(spy).toHaveBeenCalled()
  })
})

describe('provideMushiAngular (Angular 16+ DI providers)', () => {
  it('returns a Provider[] including MUSHI_CONFIG and MushiService', () => {
    const providers = provideMushiAngular(testConfig)
    // Three entries: MUSHI_CONFIG value, MushiService class, and MushiErrorHandler factory.
    expect(providers).toHaveLength(3)
    const configProvider = providers[0] as { provide: unknown; useValue: unknown }
    expect(configProvider.provide).toBe(MUSHI_CONFIG)
    expect(configProvider.useValue).toEqual(testConfig)
  })

  it('errorHandler factory wires through to the constructed service', () => {
    const providers = provideMushiAngular(testConfig)
    const errorHandlerProvider = providers[2] as {
      provide: typeof MushiErrorHandler
      useFactory: (s: MushiService) => MushiErrorHandler
      deps: unknown[]
    }
    expect(errorHandlerProvider.provide).toBe(MushiErrorHandler)
    expect(errorHandlerProvider.deps).toEqual([MushiService])
    const service = new MushiService(testConfig)
    const handler = errorHandlerProvider.useFactory(service)
    expect(handler).toBeInstanceOf(MushiErrorHandler)
  })
})
