/**
 * FILE: apps/admin/src/lib/web-vitals.test.ts
 * PURPOSE: Lock the web-vitals v6 registration contract for the admin console.
 *
 * OVERVIEW:
 * - Each Core Web Vital is registered once, with soft-nav reporting off.
 * - The Sentry payload is name, value, id, and rating only.
 *
 * DEPENDENCIES: vitest mocks for `web-vitals` and `@sentry/react`.
 *
 * USAGE: `pnpm --filter @mushi-mushi/admin exec vitest run src/lib/web-vitals.test.ts`
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const vitals = vi.hoisted(() => ({
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
  onTTFB: vi.fn(),
}))

const sentrySetAttribute = vi.fn()
const sentrySetExtra = vi.fn()

vi.mock('web-vitals', () => vitals)
vi.mock('@sentry/react', () => ({
  getActiveSpan: () => ({ setAttribute: sentrySetAttribute }),
  getCurrentScope: () => ({ setExtra: sentrySetExtra }),
}))

import { reportWebVitals } from './web-vitals'

const observers = [vitals.onCLS, vitals.onFCP, vitals.onINP, vitals.onLCP, vitals.onTTFB]

describe('reportWebVitals', () => {
  beforeEach(() => {
    for (const observer of observers) observer.mockClear()
    sentrySetAttribute.mockClear()
    sentrySetExtra.mockClear()
  })

  it('registers each vital once with soft-nav reporting off', () => {
    reportWebVitals()
    const callbacks = observers.map((observer) => {
      expect(observer).toHaveBeenCalledTimes(1)
      const [callback, opts] = observer.mock.calls[0]
      expect(opts).toEqual({ reportSoftNavs: false })
      expect(opts).not.toHaveProperty('includeProcessedEventEntries')
      return callback
    })
    expect(new Set(callbacks).size).toBe(1)
  })

  it('forwards the vital to the active span and the current scope', () => {
    reportWebVitals()
    const send = vitals.onLCP.mock.calls[0][0] as (metric: {
      name: string
      value: number
      id: string
      rating?: string
    }) => void
    send({ name: 'LCP', value: 123.4, id: 'v-lcp', rating: 'good' })
    expect(sentrySetAttribute).toHaveBeenCalledWith('measurements.lcp', 123.4)
    expect(sentrySetExtra).toHaveBeenCalledWith('webvitals.LCP', {
      value: 123,
      unit: 'millisecond',
      rating: 'good',
    })
  })

  it('scales CLS into the same millisecond-labelled unit', () => {
    reportWebVitals()
    const send = vitals.onCLS.mock.calls[0][0] as (metric: {
      name: string
      value: number
      id: string
      rating?: string
    }) => void
    send({ name: 'CLS', value: 0.0123, id: 'v-cls', rating: 'good' })
    expect(sentrySetExtra).toHaveBeenCalledWith('webvitals.CLS', {
      value: 12,
      unit: 'millisecond',
      rating: 'good',
    })
  })

  it('leaves metric.entries and attribution unread', () => {
    reportWebVitals()
    const send = vitals.onINP.mock.calls[0][0] as (metric: {
      name: string
      value: number
      id: string
      rating?: string
    }) => void
    const metric = {
      name: 'INP',
      value: 280,
      id: 'v-inp',
      rating: 'needs-improvement',
      get entries(): never {
        throw new Error('entries unread')
      },
      get attribution(): never {
        throw new Error('attribution unread')
      },
    }
    expect(() => send(metric)).not.toThrow()
    expect(sentrySetAttribute).toHaveBeenCalledWith('measurements.inp', 280)
    expect(sentrySetExtra).toHaveBeenCalledWith('webvitals.INP', {
      value: 280,
      unit: 'millisecond',
      rating: 'needs-improvement',
    })
  })
})
