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
      content: { topPriority: 'healthy', needsAttentionCount: 4 },
    }), NOW)

    expect(views['/qa-coverage']).toMatchObject({ state: 'not_set_up', chip: 'Not set up', setupTo: '/qa-coverage' })
    expect(views['/health']).toMatchObject({ state: 'not_checked', chip: 'Not run yet' })
    expect(views['/fullstack-audit']).toMatchObject({ state: 'pass', chip: 'Pass', detail: 'Last run 12h ago' })
    expect(views['/content']).toMatchObject({ state: 'findings', chip: '4 findings', detail: null })

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

  it('a missing slice is Status unavailable, not Failed', () => {
    const views = buildCheckCardViews(input(), NOW)
    for (const path of ['/qa-coverage', '/health', '/fullstack-audit', '/inventory', '/content', '/judge', '/lessons', '/prompt-lab']) {
      expect(views[path], path).toMatchObject({ state: 'unavailable', chip: 'Status unavailable', tone: 'neutral' })
      expect(views[path]?.chip, path).not.toBe('Failed')
    }
  })

  it('an audit that could not be read is Status unavailable, even with a timestamp', () => {
    const view = buildCheckCardViews(input({
      audit: { topPriority: 'unknown', errorCount: 0, warnCount: 0, failedGateCount: 0, lastRunAt: RECENT },
    }), NOW)['/fullstack-audit']
    expect(view).toMatchObject({ state: 'unavailable', chip: 'Status unavailable', tone: 'neutral', detail: null })
  })

  it('Failed is only a real failed run', () => {
    const gate = buildCheckCardViews(input({
      audit: { topPriority: 'failures', failedGateCount: 2, lastRunAt: RECENT },
    }), NOW)['/fullstack-audit']
    expect(gate).toMatchObject({ state: 'failed', chip: 'Failed', detail: 'Last run 12h ago' })

    const cron = buildCheckCardViews(input({
      health: { topPriority: 'cron_error', cronErrorCount: 1, lastCronAt: RECENT, lastLlmCallAt: STALE },
    }), NOW)['/health']
    expect(cron).toMatchObject({ state: 'failed', chip: 'Failed', detail: 'Last run 6d ago' })

    const regen = buildCheckCardViews(input({
      content: { topPriority: 'regen_failed', failedRegenCount: 1 },
    }), NOW)['/content']
    expect(regen).toMatchObject({ state: 'failed', chip: 'Failed', detail: null })
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

  it('a recipe read error is Status unavailable and a load in flight draws nothing', () => {
    const unread = buildCheckCardViews(input({
      recipePhase: 'error',
      design: el({ state: 'error', lastCheckedAt: RECENT }),
    }), NOW)
    expect(unread['/ci']).toMatchObject({ state: 'unavailable', chip: 'Status unavailable', tone: 'neutral' })
    expect(unread['/design']?.chip).toBe('Status unavailable')
    expect(unread['/recipe']?.chip).toBe('Status unavailable')
    expect(buildCheckCardViews(input({ recipePhase: 'loading' }), NOW)['/recipe']).toBeNull()
  })

  it('content and lessons do not treat an edit or a reinforcement as a check run', () => {
    const quietContent = buildCheckCardViews(input({
      content: { topPriority: 'healthy', needsAttentionCount: 0, openCount: 0, failedRegenCount: 0 },
    }), NOW)['/content']
    expect(quietContent).toMatchObject({ state: 'not_checked', chip: 'Not run yet', detail: null })
    expect(quietContent?.chip).not.toBe('Pass')

    const openContent = buildCheckCardViews(input({
      content: { topPriority: 'open_issues', needsAttentionCount: 4 },
    }), NOW)['/content']
    expect(openContent).toMatchObject({ state: 'findings', chip: '4 findings', detail: null })
    expect(openContent?.detail ?? '').not.toMatch(/Last run/)

    const quietLessons = buildCheckCardViews(input({
      lessons: { topPriority: 'healthy', criticalLessons: 0, readyToPromote: 0 },
    }), NOW)['/lessons']
    expect(quietLessons).toMatchObject({ state: 'not_checked', chip: 'Not run yet', detail: null })
    expect(quietLessons?.chip).not.toBe('Pass')

    const criticalLessons = buildCheckCardViews(input({
      lessons: { topPriority: 'critical_lessons', criticalLessons: 2, readyToPromote: 1 },
    }), NOW)['/lessons']
    expect(criticalLessons).toMatchObject({ state: 'findings', chip: '3 findings', detail: null })
    expect(criticalLessons?.detail ?? '').not.toMatch(/Last run/)
  })

  it('an audit counts errors and warnings together, and a failed gate still wins', () => {
    const both = buildCheckCardViews(input({
      audit: { errorCount: 2, warnCount: 3, failedGateCount: 0, lastRunAt: RECENT, topPriority: 'warnings' },
    }), NOW)['/fullstack-audit']
    expect(both).toMatchObject({ state: 'findings', chip: '5 findings', detail: 'Last run 12h ago' })

    const failed = buildCheckCardViews(input({
      audit: { errorCount: 2, warnCount: 3, failedGateCount: 1, lastRunAt: RECENT, topPriority: 'failures' },
    }), NOW)['/fullstack-audit']
    expect(failed).toMatchObject({ state: 'failed', chip: 'Failed' })
  })

  it('a stale platform cron is Not run yet, and its start time is not this app\'s last run', () => {
    const stale = buildCheckCardViews(input({
      health: { topPriority: 'cron_stale', amberCount: 2, lastCronAt: RECENT, lastLlmCallAt: STALE },
    }), NOW)['/health']
    expect(stale).toMatchObject({ state: 'not_checked', chip: 'Not run yet', detail: 'Last run 6d ago' })
    expect(stale?.chip).not.toMatch(/finding/)

    const platformOnly = buildCheckCardViews(input({
      health: { topPriority: 'healthy', lastCronAt: RECENT, lastLlmCallAt: null, amberCount: 0 },
    }), NOW)['/health']
    expect(platformOnly).toMatchObject({ state: 'not_checked', chip: 'Not run yet', detail: null })
    expect(platformOnly?.chip).not.toBe('Pass')

    const projectCall = buildCheckCardViews(input({
      health: { topPriority: 'healthy', lastCronAt: STALE, lastLlmCallAt: RECENT },
    }), NOW)['/health']
    expect(projectCall).toMatchObject({ state: 'pass', chip: 'Pass', detail: 'Last run 12h ago' })
  })

  it('no selected app leaves CI, design and the blueprint as Not set up', () => {
    const views = buildCheckCardViews(input({ recipePhase: 'no_project' }), NOW)
    for (const path of ['/ci', '/design', '/recipe']) {
      expect(views[path], path).toMatchObject({ state: 'not_set_up', chip: 'Not set up', setupTo: '/projects' })
    }
  })
})
