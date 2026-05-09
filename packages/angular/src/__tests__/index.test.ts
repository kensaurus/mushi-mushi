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

import { MushiService, MushiErrorHandler, provideMushi } from '../index'

const testConfig = {
  projectId: 'proj_test',
  apiKey: 'key_test',
  endpoint: 'https://test.api',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInit.mockReturnValue(mockSdkInstance)
  mockGetInstance.mockReturnValue(mockSdkInstance)
})

describe('MushiService', () => {
  it('constructor delegates to Mushi.init with correct config', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    new MushiService(testConfig)

    expect(Mushi.init).toHaveBeenCalledWith({
      projectId: 'proj_test',
      apiKey: 'key_test',
      apiEndpoint: 'https://test.api',
    })
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
