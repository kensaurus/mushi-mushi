/**
 * FILE: packages/vue/src/__tests__/index.test.ts
 * PURPOSE: Unit tests for the Vue 3 Mushi plugin, composables, and error handler.
 *
 * OVERVIEW:
 * - Verifies MushiPlugin installs correctly on a Vue app
 * - Tests useMushi, useMushiReport, and useMushiWidget composables
 * - Validates the global error handler delegates to captureError
 *
 * DEPENDENCIES:
 * - vitest for test runner and mocking
 * - vue for createApp / ref reactivity
 * - @mushi-mushi/core mocked entirely
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

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

import { MushiPlugin, useMushi, useMushiReport, useMushiWidget } from '../index'

const testConfig = {
  projectId: 'proj_test',
  apiKey: 'key_test',
  endpoint: 'https://test.api',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MushiPlugin', () => {
  it('installs on a Vue app and calls createApiClient', async () => {
    const { createApiClient } = await import('@mushi-mushi/core')
    const app = createApp(defineComponent({ render: () => h('div') }))
    app.use(MushiPlugin, testConfig)

    expect(createApiClient).toHaveBeenCalledWith({
      projectId: 'proj_test',
      apiKey: 'key_test',
      apiEndpoint: 'https://test.api',
    })
  })

  it('sets app.config.errorHandler', () => {
    const app = createApp(defineComponent({ render: () => h('div') }))
    app.use(MushiPlugin, testConfig)

    expect(app.config.errorHandler).toBeDefined()
    expect(typeof app.config.errorHandler).toBe('function')
  })

  it('errorHandler calls submitReport on error', async () => {
    const app = createApp(defineComponent({ render: () => h('div') }))
    app.use(MushiPlugin, testConfig)

    const handler = app.config.errorHandler!
    handler(new Error('boom'), null as any, 'mounted hook')

    await vi.waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalled()
    })
  })
})

describe('useMushi', () => {
  it('returns undefined when plugin is not installed', () => {
    let result: ReturnType<typeof useMushi> | undefined
    const app = createApp(
      defineComponent({
        setup() {
          result = useMushi()
          return () => h('div')
        },
      }),
    )
    const root = document.createElement('div')
    app.mount(root)

    expect(result).toBeUndefined()
    app.unmount()
  })
})

describe('useMushiReport', () => {
  it('throws when plugin is not installed', async () => {
    let submitFn: ((data: any) => Promise<void>) | undefined
    const app = createApp(
      defineComponent({
        setup() {
          const { submitReport } = useMushiReport()
          submitFn = submitReport
          return () => h('div')
        },
      }),
    )
    const root = document.createElement('div')
    app.mount(root)

    await expect(submitFn!({ description: 'test', category: 'bug' }))
      .rejects.toThrow('MushiPlugin not installed')

    app.unmount()
  })
})

describe('useMushiWidget', () => {
  it('returns reactive isOpen state that toggles', () => {
    let widget: ReturnType<typeof useMushiWidget> | undefined
    const app = createApp(
      defineComponent({
        setup() {
          widget = useMushiWidget()
          return () => h('div')
        },
      }),
    )
    const root = document.createElement('div')
    app.mount(root)

    expect(widget!.isOpen.value).toBe(false)
    widget!.open()
    expect(widget!.isOpen.value).toBe(true)
    widget!.close()
    expect(widget!.isOpen.value).toBe(false)

    app.unmount()
  })
})
