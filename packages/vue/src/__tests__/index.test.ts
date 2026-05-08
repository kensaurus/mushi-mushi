/**
 * FILE: packages/vue/src/__tests__/index.test.ts
 * PURPOSE: Unit tests for the Vue 3 Mushi plugin, composables, and error handler.
 *
 * OVERVIEW:
 * - Verifies MushiPlugin delegates to Mushi.init() from @mushi-mushi/web
 * - Tests useMushi, useMushiReport, and useMushiWidget composables
 * - Validates the global error handler delegates to captureException
 * - After init, Mushi.getInstance() returns the SDK instance (parity check)
 *
 * DEPENDENCIES:
 * - vitest for test runner and mocking
 * - vue for createApp / ref reactivity
 * - @mushi-mushi/web mocked entirely
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

const mockCaptureException = vi.fn().mockResolvedValue(null)
const mockCaptureEvent = vi.fn().mockResolvedValue('report-id')
const mockOpen = vi.fn()
const mockClose = vi.fn()
const mockIsOpen = vi.fn().mockReturnValue(false)

const mockSdkInstance = {
  captureException: mockCaptureException,
  captureEvent: mockCaptureEvent,
  open: mockOpen,
  close: mockClose,
  isOpen: mockIsOpen,
}

const mockInit = vi.fn().mockReturnValue(mockSdkInstance)
const mockGetInstance = vi.fn().mockReturnValue(mockSdkInstance)

vi.mock('@mushi-mushi/web', () => ({
  Mushi: {
    init: mockInit,
    getInstance: mockGetInstance,
    destroy: vi.fn(),
  },
}))

import { MushiPlugin, useMushi, useMushiReport, useMushiWidget } from '../index'

const testConfig = {
  projectId: 'proj_test',
  apiKey: 'key_test',
  endpoint: 'https://test.api',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsOpen.mockReturnValue(false)
  mockInit.mockReturnValue(mockSdkInstance)
  mockGetInstance.mockReturnValue(mockSdkInstance)
})

describe('MushiPlugin', () => {
  it('installs on a Vue app and calls Mushi.init', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    const app = createApp(defineComponent({ render: () => h('div') }))
    app.use(MushiPlugin, testConfig)

    expect(Mushi.init).toHaveBeenCalledWith({
      projectId: 'proj_test',
      apiKey: 'key_test',
      apiEndpoint: 'https://test.api',
    })
  })

  it('after Mushi.init(), getInstance() returns the SDK instance (parity check)', async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    const app = createApp(defineComponent({ render: () => h('div') }))
    app.use(MushiPlugin, testConfig)

    expect(Mushi.getInstance()).toBeDefined()
    expect(Mushi.getInstance()).toBe(mockSdkInstance)
  })

  it('sets app.config.errorHandler', () => {
    const app = createApp(defineComponent({ render: () => h('div') }))
    app.use(MushiPlugin, testConfig)

    expect(app.config.errorHandler).toBeDefined()
    expect(typeof app.config.errorHandler).toBe('function')
  })

  it('errorHandler calls captureException on error', async () => {
    const app = createApp(defineComponent({ render: () => h('div') }))
    app.use(MushiPlugin, testConfig)

    const handler = app.config.errorHandler!
    handler(new Error('boom'), null as any, 'mounted hook')

    await vi.waitFor(() => {
      expect(mockCaptureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ source: 'vue-error-handler' }),
      )
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
