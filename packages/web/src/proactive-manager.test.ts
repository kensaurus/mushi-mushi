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

  // Cross-reload re-show guard: a proactive trigger persists a "last shown"
  // timestamp so a page reload / crash that interrupts the user before a clean
  // dismissal (which is the only thing that records the 24h cooldown) can't
  // re-pop the panel on every subsequent load. A reload starts a brand-new JS
  // context, i.e. a fresh manager whose in-memory session counter is 0.
  describe('cross-reload re-show guard', () => {
    it('suppresses a fresh-session prompt when one was shown recently in a prior session', () => {
      const beforeReload = createProactiveManager({ reshowCooldownMinutes: 30, dismissCooldownHours: 0 })
      expect(beforeReload.shouldShow('api_cascade')).toBe(true)

      // Simulate a page reload: a new manager, fresh in-memory session, same localStorage.
      const afterReload = createProactiveManager({ reshowCooldownMinutes: 30, dismissCooldownHours: 0 })
      expect(afterReload.shouldShow('api_cascade')).toBe(false)
      // Any trigger type is suppressed on the fresh session, not just the same one.
      expect(afterReload.shouldShow('rage_click')).toBe(false)
    })

    it('allows a fresh-session prompt once the reshow window has elapsed', () => {
      localStorage.setItem('mushi:lastShown', String(Date.now() - 31 * 60 * 1000))
      const mgr = createProactiveManager({ reshowCooldownMinutes: 30, dismissCooldownHours: 0 })
      expect(mgr.shouldShow('api_cascade')).toBe(true)
    })

    it('does not apply the reshow guard within the same session', () => {
      const mgr = createProactiveManager({
        reshowCooldownMinutes: 30,
        maxProactivePerSession: 2,
        dismissCooldownHours: 0,
      })
      expect(mgr.shouldShow('rage_click')).toBe(true)
      // A second, different trigger in the SAME session is still allowed even
      // though lastShown was just written — the guard only gates fresh sessions.
      expect(mgr.shouldShow('long_task')).toBe(true)
    })

    it('reshowCooldownMinutes=0 disables the guard (legacy behavior)', () => {
      const beforeReload = createProactiveManager({ reshowCooldownMinutes: 0, dismissCooldownHours: 0 })
      expect(beforeReload.shouldShow('api_cascade')).toBe(true)
      const afterReload = createProactiveManager({ reshowCooldownMinutes: 0, dismissCooldownHours: 0 })
      expect(afterReload.shouldShow('api_cascade')).toBe(true)
    })

    it('reset() clears the reshow timestamp (explicit teardown is a fresh start)', () => {
      const mgr = createProactiveManager({ reshowCooldownMinutes: 30, dismissCooldownHours: 0 })
      expect(mgr.shouldShow('api_cascade')).toBe(true)
      mgr.reset()
      // After an explicit reset (destroy/re-init), a fresh session may show again.
      const reinit = createProactiveManager({ reshowCooldownMinutes: 30, dismissCooldownHours: 0 })
      expect(reinit.shouldShow('api_cascade')).toBe(true)
    })
  })
})
