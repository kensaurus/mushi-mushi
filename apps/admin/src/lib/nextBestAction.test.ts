/**
 * FILE: apps/admin/src/lib/nextBestAction.test.ts
 * PURPOSE: The strip names real work before setup, and never says "all clear"
 *          over failing fixes or before the counts load.
 *
 * Why (2026-10-04 console audit): on glot.it it said "IDLE — You're green
 * across the loop" next to failed fixes, and "Watch the demo" linked to "/".
 */

import { describe, expect, it } from 'vitest'
import { computeNextAction, type NbaSetup, type NbaWork } from './nextBestAction'

const SETUP_DONE: NbaSetup = {
  hasAnyProject: true,
  activeProject: { report_count: 7, fix_count: 16 },
  isStepIncomplete: () => false,
}
const QUIET: NbaWork = { ready: true, urgentOpenReports: 0, fixesFailed: 0, fixesRetryable: 0, prsOpen: 0 }

describe('computeNextAction', () => {
  it('puts unfixed critical/high reports first', () => {
    const a = computeNextAction(SETUP_DONE, { ...QUIET, urgentOpenReports: 2, fixesFailed: 3, prsOpen: 1 }, '/reports')
    expect(a?.title).toBe('2 critical or high reports are still unfixed')
    expect(a?.cta).toMatchObject({ kind: 'link', to: '/reports?status=open' })
  })

  it('then stopped fixes, then open PRs', () => {
    expect(computeNextAction(SETUP_DONE, { ...QUIET, fixesFailed: 1, fixesRetryable: 1, prsOpen: 2 }, '/reports')?.title).toBe(
      'Auto-fix stopped on 1 report',
    )
    expect(computeNextAction(SETUP_DONE, { ...QUIET, prsOpen: 2 }, '/reports')?.title).toBe('2 fix PRs are waiting for your review')
  })

  it('puts real work ahead of a setup gap', () => {
    const setup = { ...SETUP_DONE, isStepIncomplete: (s: string) => s === 'sentry_connected' }
    expect(computeNextAction(setup, { ...QUIET, fixesFailed: 1 }, '/reports')?.tone).toBe('do')
    expect(computeNextAction(setup, QUIET, '/reports')?.title).toBe('Wire merged fixes back to Sentry / Slack')
  })

  it('says all clear only when the work counts are loaded and empty, with no demo link', () => {
    const clear = computeNextAction(SETUP_DONE, QUIET, '/reports')
    expect(clear?.tone).toBe('idle')
    expect(clear?.cta).toMatchObject({ kind: 'link', to: '/inbox?tab=activity' })
    expect(JSON.stringify(clear)).not.toMatch(/demo/i)
    expect(computeNextAction(SETUP_DONE, { ...QUIET, ready: false }, '/reports')).toBeNull()
  })

  it('still guides a brand-new workspace while counts load', () => {
    expect(computeNextAction({ hasAnyProject: false, activeProject: null, isStepIncomplete: () => true }, { ...QUIET, ready: false }, '/reports')?.title).toBe(
      'Create your first project',
    )
  })
})

describe('computeNextAction with the setup checklist open', () => {
  const NEEDS_SDK: NbaSetup = {
    hasAnyProject: true,
    activeProject: { report_count: 0, fix_count: 0 },
    isStepIncomplete: (step) => step === 'sdk_installed',
  }

  it('leaves setup steps to the checklist instead of repeating them', () => {
    expect(computeNextAction(NEEDS_SDK, QUIET, '/reports')?.title).toBe('Install the Mushi widget in your app')
    expect(computeNextAction(NEEDS_SDK, QUIET, '/reports', { setupGuideOpen: true })).toBeNull()
  })

  it('still names real work while the checklist is open', () => {
    const urgent = { ...QUIET, urgentOpenReports: 2 }
    expect(computeNextAction(NEEDS_SDK, urgent, '/reports', { setupGuideOpen: true })?.title).toBe(
      '2 critical or high reports are still unfixed',
    )
  })
})
