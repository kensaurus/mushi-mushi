/**
 * FILE: apps/admin/src/lib/routeTitleFallbacks.test.ts
 * PURPOSE: Lock-step tests for navRegistry-derived document title fallbacks.
 */

import { describe, expect, it } from 'vitest'
import { buildRouteTitleMatchers, routeFallbackTitle } from './navRegistry'

describe('routeFallbackTitle', () => {
  it('uses IA nav labels from the registry', () => {
    expect(routeFallbackTitle('/inbox')).toBe('Action Inbox')
    expect(routeFallbackTitle('/queue')).toBe('Failed events')
    expect(routeFallbackTitle('/notifications')).toBe('Alert routing')
    expect(routeFallbackTitle('/setup-copilot')).toBe('Setup copilot')
  })

  it('resolves dynamic App.tsx segments via extra matchers', () => {
    expect(routeFallbackTitle('/reports/abc-123')).toBe('Report')
    expect(routeFallbackTitle('/content/asset-1')).toBe('Content QA')
    expect(routeFallbackTitle('/integrations')).toBe('Integrations')
    expect(routeFallbackTitle('/integrations/config')).toBe('Integrations')
  })

  it('returns null for unknown paths', () => {
    expect(routeFallbackTitle('/totally-unknown-route')).toBeNull()
  })

  it('buildRouteTitleMatchers covers every registry base path', () => {
    const matchers = buildRouteTitleMatchers()
    expect(matchers.length).toBeGreaterThan(40)
    for (const [re] of matchers) {
      expect(re).toBeInstanceOf(RegExp)
    }
  })
})
