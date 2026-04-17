/**
 * FILE: packages/angular/src/__tests__/index.test.ts
 * PURPOSE: Unit tests for the Angular Mushi SDK — MushiService, MushiErrorHandler, provideMushi.
 *
 * OVERVIEW:
 * - Verifies MushiService constructor creates an API client
 * - Tests submitReport delegates to the underlying client
 * - Tests captureError handles both Error objects and strings
 * - Tests MushiErrorHandler.handleError delegates to MushiService
 * - Tests provideMushi factory returns service + errorHandler pair
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

import { MushiService, MushiErrorHandler, provideMushi } from '../index'

const testConfig = {
  projectId: 'proj_test',
  apiKey: 'key_test',
  endpoint: 'https://test.api',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MushiService', () => {
  it('constructor creates API client with correct config', async () => {
    new MushiService(testConfig)

    const { createApiClient } = await import('@mushi-mushi/core')
    expect(createApiClient).toHaveBeenCalledWith({
      projectId: 'proj_test',
      apiKey: 'key_test',
      apiEndpoint: 'https://test.api',
    })
  })

  it('defers to core default endpoint when not provided', async () => {
    new MushiService({ projectId: 'p', apiKey: 'k' })

    const { createApiClient } = await import('@mushi-mushi/core')
    // V5.3: angular no longer hardcodes the endpoint; it omits apiEndpoint so
    // @mushi-mushi/core's DEFAULT_API_ENDPOINT applies. Verify the call did
    // NOT include an apiEndpoint property at all.
    const call = (createApiClient as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(call?.[0]).not.toHaveProperty('apiEndpoint')
  })

  it('submitReport calls client.submitReport with built report', async () => {
    const service = new MushiService(testConfig)
    await service.submitReport({ description: 'test bug', category: 'bug' })

    expect(mockSubmitReport).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj_test',
        description: 'test bug',
        category: 'bug',
      }),
    )
  })

  it('captureError handles Error objects', () => {
    const service = new MushiService(testConfig)
    service.captureError(new Error('something broke'))

    expect(mockSubmitReport).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'something broke',
        category: 'bug',
      }),
    )
  })

  it('captureError handles string errors', () => {
    const service = new MushiService(testConfig)
    service.captureError('string error')

    expect(mockSubmitReport).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'string error',
        category: 'bug',
      }),
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
