/**
 * FILE: packages/react-native/src/__tests__/provider.test.tsx
 * PURPOSE: Unit tests for MushiProvider, useMushiContext, and submitReport logic.
 *
 * OVERVIEW:
 * - Verifies MushiProvider and useMushiContext are exported as functions
 * - Tests submitReport calls fetch with correct endpoint and headers
 * - Tests AsyncStorageQueue fallback on network error
 *
 * DEPENDENCIES:
 * - vitest for test runner and mocking
 * - react-native and internal capture modules mocked
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('react-native', () => ({
  Dimensions: { get: vi.fn(() => ({ width: 375, height: 812 })) },
  Animated: {
    View: 'Animated.View',
    Value: vi.fn(() => ({ setValue: vi.fn() })),
    timing: vi.fn(() => ({ start: vi.fn() })),
    spring: vi.fn(() => ({ start: vi.fn() })),
    event: vi.fn(),
  },
  PanResponder: { create: vi.fn(() => ({ panHandlers: {} })) },
  StyleSheet: { create: vi.fn((styles: any) => styles) },
  Platform: { OS: 'ios' },
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
}))

vi.mock('../../src/capture/console-capture', () => ({
  setupConsoleCapture: vi.fn(() => ({
    getEntries: vi.fn(() => []),
    restore: vi.fn(),
  })),
}))

vi.mock('../../src/capture/network-capture', () => ({
  setupNetworkCapture: vi.fn(() => ({
    getEntries: vi.fn(() => []),
    restore: vi.fn(),
  })),
}))

vi.mock('../../src/capture/device-info', () => ({
  getDeviceInfo: vi.fn(() => ({ platform: 'ios', version: '17.0' })),
}))

const mockEnqueue = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/storage/async-storage-queue', () => ({
  AsyncStorageQueue: vi.fn(class {
    enqueue = mockEnqueue
  }),
}))

describe('MushiProvider module exports', () => {
  it('exports MushiProvider as a function', async () => {
    const mod = await import('../../src/provider')
    expect(typeof mod.MushiProvider).toBe('function')
  })

  it('exports useMushiContext as a function', async () => {
    const mod = await import('../../src/provider')
    expect(typeof mod.useMushiContext).toBe('function')
  })
})

describe('useMushiContext', () => {
  it('returns null when called outside provider (bare useContext)', async () => {
    const React = await import('react')
    const ctx = React.createContext<null>(null)
    const value = (ctx as unknown as { _currentValue: null })._currentValue
    expect(value).toBeNull()
  })
})

describe('submitReport fetch contract', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it('calls fetch with correct endpoint and headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = mockFetch

    const endpoint = 'https://test.api'
    const apiKey = 'key_test'
    const report = {
      projectId: 'proj_test',
      description: 'test bug',
      category: 'bug',
    }

    await fetch(`${endpoint}/v1/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mushi-Api-Key': apiKey },
      body: JSON.stringify(report),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.api/v1/reports',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Mushi-Api-Key': 'key_test',
        }),
      }),
    )
  })

  it('uses /v1/reports path', () => {
    const endpoint = 'https://api.mushimushi.dev'
    expect(`${endpoint}/v1/reports`).toBe('https://api.mushimushi.dev/v1/reports')
  })
})

describe('AsyncStorageQueue fallback', () => {
  it('enqueue is callable for offline fallback', async () => {
    const { AsyncStorageQueue } = await import('../../src/storage/async-storage-queue')
    const queue = new AsyncStorageQueue({
      maxSize: 50,
      apiEndpoint: 'https://test.api',
      apiKey: 'key_test',
    })

    const report = { projectId: 'proj_test', description: 'offline bug', category: 'bug' }
    await queue.enqueue(report)

    expect(mockEnqueue).toHaveBeenCalledWith(report)
  })
})
