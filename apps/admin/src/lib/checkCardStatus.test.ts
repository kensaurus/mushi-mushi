/**
 * FILE: apps/admin/src/lib/checkCardStatus.test.ts
 * PURPOSE: /checks card states. Pass requires a finished run. A zero count
 *          is not "All clear". Not set up carries a setup link.
 */

import { describe, expect, it } from 'vitest'
import { buildCheckCardViews, type CheckCardsInput, type ObservedElement } from './checkCardStatus'

const NOW = Date.parse('2026-10-26T00:00:00Z')
const RECENT = '2026-10-25T12:00:00Z'
const STALE = '2026-10-20T00:00:00Z'

function input(over: Partial<CheckCardsInput> = {}): CheckCardsInput {
  return {
    navReady: true,
    qa: null,
    health: null,
    audit: null,
    inventory: null,
    content: null,
    lessons: null,
    prompts: null,
    judge: null,
    recipePhase: 'loading',
    recipeElements: [],
    design: null,
    ci: null,
    ...over,
  }
}

function el(over: Partial<ObservedElement> = {}): ObservedElement {
  return { state: 'ok', lastCheckedAt: RECENT, findingsCount: 0, setupTo: '/recipe', ...over }
}

describe('buildCheckCardViews', () => {
  it('covers the four states and never says All clear without a run', () => {
    const views = buildCheckCardViews(input({
      qa: { totalStories: 0, failingStories: 0, topPriority: 'no_stories' },
      health: { topPriority: 'idle' },
      audit: { topPriority: 'healthy', errorCount: 0, warnCount: 0, failedGateCount: 0, lastRunAt: RECENT },
      content: { topPriority: 'healthy', needsAttentionCount: 4, latestAt: RECENT },
    }), NOW)

    expect(views['/qa-coverage']).toMatchObject({ state: 'not_set_up', chip: 'Not set up', setupTo: '/qa-coverage' })
    expect(views['/health']).toMatchObject({ state: 'not_checked', chip: 'Not checked yet' })
    expect(views['/fullstack-audit']).toMatchObject({ state: 'pass', chip: 'Pass', detail: 'Last run 12h ago' })
    expect(views['/content']).toMatchObject({ state: 'findings', chip: '4 findings', detail: 'Last run 12h ago' })

    const chips = Object.values(views).map((v) => v?.chip ?? '')
    expect(chips).not.toContain('All clear')
  })

  it('does not call a zero-finding audit a pass when it never ran', () => {
    const view = buildCheckCardViews(input({
      audit: { topPriority: 'healthy', errorCount: 0, warnCount: 0, failedGateCount: 0, lastRunAt: null },
    }), NOW)['/fullstack-audit']
    expect(view?.state).toBe('not_checked')
    expect(view?.chip).not.toBe('Pass')
    expect(view?.chip).not.toBe('All clear')
  })

  it('a missing slice is Failed, not a pass', () => {
    const view = buildCheckCardViews(input({ qa: null }), NOW)['/qa-coverage']
    expect(view).toMatchObject({ state: 'failed', chip: 'Failed' })
  })

  it('hides slice cards until nav-meta has answered', () => {
    const view = buildCheckCardViews(input({ navReady: false, qa: { totalStories: 3, topPriority: 'healthy', lastRunAt: RECENT } }), NOW)['/qa-coverage']
    expect(view).toBeNull()
  })

  it('scheduled tests: failing stories are findings with the last run', () => {
    const view = buildCheckCardViews(input({
      qa: { totalStories: 4, failingStories: 2, pendingRuns: 0, lastRunAt: RECENT, topPriority: 'failing' },
    }), NOW)['/qa-coverage']
    expect(view).toMatchObject({ state: 'findings', chip: '2 findings', detail: 'Last run 12h ago' })
  })

  it('scheduled tests that are turned off are Not set up', () => {
    const view = buildCheckCardViews(input({
      qa: { totalStories: 3, topPriority: 'disabled_all', lastRunAt: RECENT },
    }), NOW)['/qa-coverage']
    expect(view?.state).toBe('not_set_up')
    expect(view?.setupTo).toBe('/qa-coverage')
  })

  it('a fresh judge run with no disagreements is Pass; a stale one is not', () => {
    const fresh = buildCheckCardViews(input({
      judge: { totalEvaluations: 10, disagreementCount: 0, lastEvalAt: RECENT, topPriority: 'healthy' },
    }), NOW)['/judge']
    expect(fresh).toMatchObject({ state: 'pass', chip: 'Pass' })

    const stale = buildCheckCardViews(input({
      judge: { totalEvaluations: 10, disagreementCount: 0, lastEvalAt: STALE, topPriority: 'stale' },
    }), NOW)['/judge']
    expect(stale?.state).not.toBe('pass')
    expect(stale?.chip).not.toBe('All clear')
    expect(stale?.detail).toBe('Last run 6d ago')
  })

  it('judge disagreements are findings, and no evaluations is Not set up', () => {
    const none = buildCheckCardViews(input({
      judge: { totalEvaluations: 0, disagreementCount: 0, lastEvalAt: null, topPriority: 'no_evals' },
    }), NOW)['/judge']
    expect(none).toMatchObject({ state: 'not_set_up', setupTo: '/judge' })

    const disagree = buildCheckCardViews(input({
      judge: { totalEvaluations: 8, disagreementCount: 3, lastEvalAt: RECENT, topPriority: 'disagreements' },
    }), NOW)['/judge']
    expect(disagree).toMatchObject({ chip: '3 findings' })
  })

  it('inventory without a snapshot is Not set up; a clear gate run is Pass', () => {
    const missing = buildCheckCardViews(input({
      inventory: { hasInventory: false, openFindings: 0, regressed: 0, topPriority: 'no_inventory' },
    }), NOW)['/inventory']
    expect(missing).toMatchObject({ state: 'not_set_up', setupTo: '/inventory' })

    const clear = buildCheckCardViews(input({
      inventory: { hasInventory: true, openFindings: 0, regressed: 0, lastGateRunAt: RECENT, topPriority: 'clear' },
    }), NOW)['/inventory']
    expect(clear).toMatchObject({ state: 'pass', detail: 'Last run 12h ago' })
  })

  it('prompt lab never says Pass: it has no run time', () => {
    const view = buildCheckCardViews(input({
      prompts: { topPriority: 'healthy', untestedAbCount: 0, promoteReadyCount: 0 },
    }), NOW)['/prompt-lab']
    expect(view?.state).toBe('not_checked')
  })

  it('CI, design and the blueprint use the recipe element, including Set up', () => {
    const views = buildCheckCardViews(input({
      recipePhase: 'ready',
      ci: el({ state: 'not_connected', lastCheckedAt: null, setupTo: '/integrations/config' }),
      design: el({ state: 'error', lastCheckedAt: RECENT, setupTo: '/design' }),
      recipeElements: [el({ state: 'drift', findingsCount: 2 })],
    }), NOW)
    expect(views['/ci']).toMatchObject({ state: 'not_set_up', chip: 'Not set up', setupTo: '/integrations/config' })
    expect(views['/design']).toMatchObject({ state: 'failed', chip: 'Failed', detail: 'Last run 12h ago' })
    expect(views['/recipe']).toMatchObject({ state: 'findings', chip: '2 findings' })
  })

  it('an ok recipe element with no check time is not a pass', () => {
    const view = buildCheckCardViews(input({
      recipePhase: 'ready',
      ci: el({ state: 'ok', lastCheckedAt: null }),
    }), NOW)['/ci']
    expect(view?.state).toBe('not_checked')
  })

  it('a recipe read error is Failed and a load in flight draws nothing', () => {
    expect(buildCheckCardViews(input({ recipePhase: 'error' }), NOW)['/ci']?.chip).toBe('Failed')
    expect(buildCheckCardViews(input({ recipePhase: 'loading' }), NOW)['/recipe']).toBeNull()
  })
})
