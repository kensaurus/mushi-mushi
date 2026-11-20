/**
 * /health summary tone (2026-11-18): never green while a background job is overdue.
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_HEALTH_STATS, type HealthStats } from './HealthStatsTypes'
import { healthLead, healthTone } from './HealthSnapshotStrip'

const stats = (over: Partial<HealthStats>): HealthStats => ({ ...EMPTY_HEALTH_STATS, totalCalls: 14, cronJobCount: 3, cronHealthyCount: 3, ...over })

describe('healthTone', () => {
  it('is ok only when every job ran on time and no call failed', () => {
    expect(healthTone(stats({}))).toBe('ok')
  })

  it('is not ok while a job is overdue: warn or stale in the stats, or by the overdue count the page shows', () => {
    expect(healthTone(stats({ cronHealthyCount: 2, cronWarnCount: 1 }))).toBe('warn')
    expect(healthTone(stats({ cronHealthyCount: 2, cronStaleCount: 1 }))).toBe('warn')
    // The stats can lag the per-job staleness the overdue card reads: the same count drives both.
    expect(healthTone(stats({ cronHealthyCount: 2 }), 1)).toBe('warn')
  })

  it('does not turn an empty page amber just because no job has run yet', () => {
    expect(healthTone(EMPTY_HEALTH_STATS)).toBe('ok')
  })

  it('is danger when a job failed or calls fail over 5%', () => {
    expect(healthTone(stats({ cronHealthyCount: 2, cronErrorCount: 1 }))).toBe('danger')
    expect(healthTone(stats({ errorRatePct: 6 }))).toBe('danger')
  })

  // Round 3: with the page's job rows, the strip reads their count (cronJobState), not the stats'.
  it('reads the page rows when given: a failed row is danger, an overdue row is warn, all on time is ok', () => {
    const lagging = stats({ cronHealthyCount: 2, cronStaleCount: 1 })
    expect(healthTone(lagging, 0, { ok: 3, total: 3, failed: 0 })).toBe('ok')
    expect(healthTone(lagging, 1, { ok: 2, total: 3, failed: 0 })).toBe('warn')
    expect(healthTone(stats({}), 0, { ok: 2, total: 3, failed: 1 })).toBe('danger')
  })
})

describe('healthLead (2026-11-19: what is wrong, then one button)', () => {
  const calm = { errorRatePct: 0, fallbackRatePct: 0, totalCalls: 14 }

  it('names an overdue job by what it does and offers Run now when the console can run it', () => {
    expect(healthLead({ stats: calm, failing: [], overdue: ['intelligence-report'], window: '24h' })).toEqual({
      sentence: '1 scheduled job is overdue: Weekly summary.',
      tone: 'warn',
      action: { kind: 'run', job: 'intelligence-report', label: 'Run now' },
    })
  })

  it('opens the jobs tab for a job it cannot run, or several jobs', () => {
    expect(healthLead({ stats: calm, failing: [], overdue: ['data-retention'], window: '24h' }).action).toEqual({ kind: 'tab', tab: 'cron', label: 'Open jobs' })
    expect(healthLead({ stats: calm, failing: [], overdue: ['judge-batch', 'intelligence-report'], window: '24h' }).action).toEqual({ kind: 'tab', tab: 'cron', label: 'Open jobs' })
  })

  it('puts a failed job first, then a high failed-call share, then an overdue job', () => {
    const lead = healthLead({ stats: { ...calm, errorRatePct: 9 }, failing: ['judge-batch'], overdue: ['intelligence-report'], window: '24h' })
    expect(lead.sentence).toBe('1 scheduled job failed on its last run: Triage grading.')
    expect(lead.tone).toBe('danger')
    const calls = healthLead({ stats: { ...calm, errorRatePct: 9 }, failing: [], overdue: ['intelligence-report'], window: '1h' })
    expect(calls.sentence).toBe('9% of AI calls failed in the last 1h, usually a provider outage or an expired key.')
    expect(calls.action).toEqual({ kind: 'tab', tab: 'llm', label: 'See failed calls' })
  })

  it('has no sentence and no button when all is well', () => {
    expect(healthLead({ stats: calm, failing: [], overdue: [], window: '24h' })).toEqual({ sentence: null, tone: 'ok', action: null })
  })
})
