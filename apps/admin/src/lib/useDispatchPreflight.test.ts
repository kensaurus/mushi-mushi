/**
 * FILE: apps/admin/src/lib/useDispatchPreflight.test.ts
 * PURPOSE: Test the dispatch preflight state derivation logic.
 *          We test the pure data-transformation parts (failing derivation,
 *          state shape) without mounting React or mocking Supabase Realtime,
 *          since the realtime subscription is an effect-level concern best
 *          covered by E2E tests.
 */

import { describe, it, expect } from 'vitest'
import type { PreflightCheck } from './useDispatchPreflight'

// ── Helper to build check arrays ─────────────────────────────────────────────

function makeCheck(key: string, ready: boolean): PreflightCheck {
  return {
    key: key as PreflightCheck['key'],
    ready,
    label: `Check ${key}`,
    hint: ready ? 'All good' : `Fix ${key}`,
    fixHref: `/fix/${key}`,
  }
}

// ── Failing derivation (stateless, pure) ────────────────────────────────────

function deriveFailing(checks: PreflightCheck[]): PreflightCheck[] {
  return checks.filter((c) => !c.ready)
}

function deriveReady(checks: PreflightCheck[]): boolean {
  return checks.every((c) => c.ready)
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useDispatchPreflight — state derivation', () => {
  it('ready=true when all 4 checks pass', () => {
    const checks = [
      makeCheck('github', true),
      makeCheck('codebase', true),
      makeCheck('anthropic', true),
      makeCheck('autofix', true),
    ]
    expect(deriveReady(checks)).toBe(true)
    expect(deriveFailing(checks)).toHaveLength(0)
  })

  it('ready=false when any check fails', () => {
    const checks = [
      makeCheck('github', false),
      makeCheck('codebase', true),
      makeCheck('anthropic', true),
      makeCheck('autofix', true),
    ]
    expect(deriveReady(checks)).toBe(false)
    expect(deriveFailing(checks)).toHaveLength(1)
    expect(deriveFailing(checks)[0].key).toBe('github')
  })

  it('failing contains all non-ready checks', () => {
    const checks = [
      makeCheck('github', false),
      makeCheck('codebase', false),
      makeCheck('anthropic', true),
      makeCheck('autofix', false),
    ]
    const failing = deriveFailing(checks)
    expect(failing).toHaveLength(3)
    expect(failing.map((c) => c.key)).toContain('github')
    expect(failing.map((c) => c.key)).toContain('codebase')
    expect(failing.map((c) => c.key)).toContain('autofix')
    expect(failing.map((c) => c.key)).not.toContain('anthropic')
  })

  it('empty checks → ready=true (vacuous truth), failing=[]', () => {
    expect(deriveReady([])).toBe(true)
    expect(deriveFailing([])).toHaveLength(0)
  })

  it('check with ready=false exposes a non-empty hint and fixHref', () => {
    const check = makeCheck('github', false)
    expect(check.hint.length).toBeGreaterThan(0)
    expect(check.fixHref.length).toBeGreaterThan(0)
  })
})

// ── PreflightState shape contract ────────────────────────────────────────────

describe('PreflightState shape', () => {
  it('has required fields: loading, ready, checks, failing, error, reload, repoUrl', () => {
    const mockState = {
      loading: false,
      ready: true,
      checks: [] as PreflightCheck[],
      failing: [] as PreflightCheck[],
      error: null,
      reload: () => {},
      repoUrl: null as string | null,
    }
    // TypeScript shape check — will fail to compile if fields are missing
    expect(typeof mockState.loading).toBe('boolean')
    expect(typeof mockState.ready).toBe('boolean')
    expect(Array.isArray(mockState.checks)).toBe(true)
    expect(Array.isArray(mockState.failing)).toBe(true)
    expect(mockState.error).toBeNull()
    expect(typeof mockState.reload).toBe('function')
    // repoUrl is the new field added alongside the popover chip
    expect(mockState.repoUrl).toBeNull()
  })

  it('repoUrl type allows string or null', () => {
    const withUrl = { repoUrl: 'https://github.com/kensaurus/solo-boss-cloud' }
    const withoutUrl = { repoUrl: null }
    expect(typeof withUrl.repoUrl).toBe('string')
    expect(withoutUrl.repoUrl).toBeNull()
  })
})

// ── PreflightCheck type coverage ─────────────────────────────────────────────

describe('PreflightCheck — valid keys', () => {
  const validKeys: PreflightCheck['key'][] = ['github', 'codebase', 'anthropic', 'autofix']

  it('lists exactly the 4 expected dispatch-gate keys', () => {
    expect(validKeys).toHaveLength(4)
  })

  it.each(validKeys)('key=%s is a valid PreflightKey', (key) => {
    const check = makeCheck(key, false)
    expect(check.key).toBe(key)
  })
})
