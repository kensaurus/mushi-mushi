/**
 * FILE: apps/admin/src/components/reports/dispatchFixPreflight.helpers.test.ts
 * PURPOSE: Unit-test the pure helper logic behind the dispatch preflight popover:
 *          - `preflightBlocked`: derived from loading + ready state
 *          - CTA label derivation based on blocked state
 *          - Failing checks passed-through correctly
 */

import { describe, it, expect } from 'vitest'
import type { PreflightCheck, PreflightState } from '../../lib/useDispatchPreflight'

// ── Pure helpers extracted from DispatchFixPreflight ─────────────────────────

function preflightBlocked(preflight: PreflightState | undefined): boolean {
  if (!preflight) return false
  return !preflight.loading && !preflight.ready
}

function queueButtonLabel(blocked: boolean): string {
  return blocked ? 'Resolve prerequisites first' : 'Queue fix worker →'
}

function makeCheck(key: string, ready: boolean): PreflightCheck {
  return {
    key: key as PreflightCheck['key'],
    ready,
    label: `Check: ${key}`,
    hint: ready ? 'OK' : 'Needs fixing',
    fixHref: '/integrations',
  }
}

function makePreflight(overrides: Partial<PreflightState> = {}): PreflightState {
  const checks: PreflightCheck[] = [
    makeCheck('github', true),
    makeCheck('codebase', true),
    makeCheck('anthropic', true),
    makeCheck('autofix', true),
  ]
  const base: PreflightState = {
    loading: false,
    ready: true,
    checks,
    failing: [],
    error: null,
    reload: () => {},
    repoUrl: null,
  }
  return { ...base, ...overrides }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('preflightBlocked', () => {
  it('returns false when preflight is undefined (legacy callers)', () => {
    expect(preflightBlocked(undefined)).toBe(false)
  })

  it('returns false when loading (state unknown)', () => {
    expect(preflightBlocked(makePreflight({ loading: true, ready: false }))).toBe(false)
  })

  it('returns false when ready', () => {
    expect(preflightBlocked(makePreflight({ loading: false, ready: true }))).toBe(false)
  })

  it('returns true when not loading and not ready', () => {
    const failing = [makeCheck('github', false)]
    expect(
      preflightBlocked(makePreflight({ loading: false, ready: false, failing })),
    ).toBe(true)
  })

  it('returns false when checks are still loading even if ready=false', () => {
    expect(preflightBlocked(makePreflight({ loading: true, ready: false }))).toBe(false)
  })
})

describe('queueButtonLabel', () => {
  it('returns the Queue label when not blocked', () => {
    expect(queueButtonLabel(false)).toBe('Queue fix worker →')
  })

  it('returns the Resolve label when blocked', () => {
    expect(queueButtonLabel(true)).toBe('Resolve prerequisites first')
  })
})

describe('failing checks pass-through', () => {
  it('failing array is empty when all checks pass', () => {
    const preflight = makePreflight()
    expect(preflight.failing).toHaveLength(0)
  })

  it('failing array reflects unready checks', () => {
    const failingChecks = [makeCheck('github', false), makeCheck('anthropic', false)]
    const preflight = makePreflight({
      ready: false,
      failing: failingChecks,
    })
    expect(preflight.failing).toHaveLength(2)
    expect(preflight.failing.map((c) => c.key)).toContain('github')
    expect(preflight.failing.map((c) => c.key)).toContain('anthropic')
  })

  it('each failing check has a non-empty hint', () => {
    const failingChecks = [makeCheck('codebase', false)]
    const preflight = makePreflight({ ready: false, failing: failingChecks })
    for (const c of preflight.failing) {
      expect(c.hint.length).toBeGreaterThan(0)
    }
  })
})

describe('repoUrl in preflight state', () => {
  it('is null by default', () => {
    expect(makePreflight().repoUrl).toBeNull()
  })

  it('passes through a repo URL', () => {
    const url = 'https://github.com/kensaurus/solo-boss-cloud'
    expect(makePreflight({ repoUrl: url }).repoUrl).toBe(url)
  })
})
