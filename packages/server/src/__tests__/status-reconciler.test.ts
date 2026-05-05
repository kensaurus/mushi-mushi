/**
 * Status Reconciler — derivation rule unit tests.
 *
 * The reconciler exposes a pure `deriveStatus(actionId, hasApiEdge, ctx)`
 * function so we can pin the whitepaper §3.3 truth table here without
 * spinning up a full Supabase client.
 */

import { describe, expect, it } from 'vitest'
import { deriveStatus } from '../../supabase/functions/status-reconciler/index.ts'
import type { Status } from '../../supabase/functions/_shared/inventory.ts'

interface Ctx {
  findingsByRule: Map<string, Set<string>>
  latestSynthetic: Map<string, { action_node_id: string; status: 'passed' | 'failed' | 'error' | 'skipped'; ran_at: string }>
  sentinelByTest: Map<string, 'approved' | 'rejected' | 'unknown'>
  testsByAction: Map<string, string[]>
  previousStatus: Map<string, Status>
}

function emptyCtx(): Ctx {
  return {
    findingsByRule: new Map(),
    latestSynthetic: new Map(),
    sentinelByTest: new Map(),
    testsByAction: new Map(),
    previousStatus: new Map(),
  }
}

function withFinding(ctx: Ctx, rule: string, actionId: string): Ctx {
  const set = ctx.findingsByRule.get(rule) ?? new Set<string>()
  set.add(actionId)
  ctx.findingsByRule.set(rule, set)
  return ctx
}

describe('deriveStatus (whitepaper §3.3)', () => {
  it('flags dead-handler hits as 🔴 stub regardless of other signals', () => {
    const ctx = withFinding(emptyCtx(), 'no-dead-handler', 'a1')
    expect(deriveStatus('a1', true, ctx)).toBe('stub')
  })

  it('marks an action with no api edge + no tests + no signals as ⚪ unknown', () => {
    expect(deriveStatus('a1', false, emptyCtx())).toBe('unknown')
  })

  it('marks an action that hits real backend without verified_by as 🟡 wired', () => {
    expect(deriveStatus('a1', true, emptyCtx())).toBe('wired')
  })

  it('treats a Sentinel-rejected verified_by as 🟡 wired (not 🟢 verified)', () => {
    const ctx = emptyCtx()
    ctx.testsByAction.set('a1', ['t1'])
    ctx.sentinelByTest.set('t1', 'rejected')
    expect(deriveStatus('a1', true, ctx)).toBe('wired')
  })

  it('promotes to 🟢 verified when ALL tests are Sentinel-approved + no synth fail', () => {
    const ctx = emptyCtx()
    ctx.testsByAction.set('a1', ['t1', 't2'])
    ctx.sentinelByTest.set('t1', 'approved')
    ctx.sentinelByTest.set('t2', 'approved')
    expect(deriveStatus('a1', true, ctx)).toBe('verified')
  })

  it('demotes a verified action to ⚫ regressed when synthetic fails', () => {
    const ctx = emptyCtx()
    ctx.testsByAction.set('a1', ['t1'])
    ctx.sentinelByTest.set('t1', 'approved')
    ctx.latestSynthetic.set('a1', { action_node_id: 'a1', status: 'failed', ran_at: new Date().toISOString() })
    ctx.previousStatus.set('a1', 'verified')
    expect(deriveStatus('a1', true, ctx)).toBe('regressed')
  })

  it('flags mock-leak hits as 🟠 mocked when tests are not approved', () => {
    const ctx = withFinding(emptyCtx(), 'no-mock-leak', 'a1')
    expect(deriveStatus('a1', false, ctx)).toBe('mocked')
  })

  it('flags status-claim violations as 🟡 wired (claim disagrees with reality)', () => {
    const ctx = withFinding(emptyCtx(), 'status-claim-violation', 'a1')
    expect(deriveStatus('a1', false, ctx)).toBe('wired')
  })

  it('flags api-contract mismatches as 🟡 wired even when the action has tests in flight', () => {
    const ctx = withFinding(emptyCtx(), 'api-contract-mismatch', 'a1')
    ctx.testsByAction.set('a1', ['t1'])
    ctx.sentinelByTest.set('t1', 'unknown')
    expect(deriveStatus('a1', true, ctx)).toBe('wired')
  })

  it('keeps regressed sticky once a verified action drops a synthetic run', () => {
    const ctx = emptyCtx()
    ctx.previousStatus.set('a1', 'verified')
    ctx.testsByAction.set('a1', ['t1'])
    ctx.sentinelByTest.set('t1', 'approved')
    ctx.latestSynthetic.set('a1', {
      action_node_id: 'a1',
      status: 'error',
      ran_at: new Date().toISOString(),
    })
    expect(deriveStatus('a1', true, ctx)).toBe('regressed')
  })
})
