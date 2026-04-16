import { describe, it, expect, beforeEach } from 'vitest'
import { createProactiveManager } from './proactive-manager'

describe('ProactiveManager', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('allows first trigger', () => {
    const mgr = createProactiveManager()
    expect(mgr.shouldShow('rage_click')).toBe(true)
  })

  it('blocks duplicate trigger type in same session', () => {
    const mgr = createProactiveManager()
    mgr.shouldShow('rage_click')
    expect(mgr.shouldShow('rage_click')).toBe(false)
  })

  it('allows different trigger types up to session limit', () => {
    const mgr = createProactiveManager({ maxProactivePerSession: 2 })
    expect(mgr.shouldShow('rage_click')).toBe(true)
    expect(mgr.shouldShow('long_task')).toBe(true)
    expect(mgr.shouldShow('api_cascade')).toBe(false)
  })

  it('respects session limit', () => {
    const mgr = createProactiveManager({ maxProactivePerSession: 1 })
    expect(mgr.shouldShow('rage_click')).toBe(true)
    expect(mgr.shouldShow('long_task')).toBe(false)
  })

  it('suppresses after consecutive dismissals', () => {
    const mgr = createProactiveManager({ suppressAfterDismissals: 2, dismissCooldownHours: 0 })
    mgr.recordDismissal()
    mgr.recordDismissal()
    expect(mgr.shouldShow('rage_click')).toBe(false)
  })

  it('resets consecutive dismissals on submission', () => {
    const mgr = createProactiveManager({ suppressAfterDismissals: 2, dismissCooldownHours: 0 })
    mgr.recordDismissal()
    mgr.recordSubmission()
    expect(mgr.shouldShow('rage_click')).toBe(true)
  })

  it('enforces cooldown after dismissal', () => {
    const mgr = createProactiveManager({ dismissCooldownHours: 24 })
    mgr.recordDismissal()
    expect(mgr.shouldShow('rage_click')).toBe(false)
  })

  it('reset clears session state', () => {
    const mgr = createProactiveManager({ maxProactivePerSession: 1, dismissCooldownHours: 0 })
    mgr.shouldShow('rage_click')
    expect(mgr.shouldShow('long_task')).toBe(false)
    mgr.reset()
    expect(mgr.shouldShow('long_task')).toBe(true)
  })
})
