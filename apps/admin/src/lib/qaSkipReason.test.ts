import { describe, expect, it } from 'vitest'
import { cliRunCommand, cloudCanRunScript, providerWords, qaPageStatus, skipReason, storyRunStatus, stripDayStatus, type QaCoverageRow } from './qaSkipReason'

const row = (over: Partial<QaCoverageRow> = {}): QaCoverageRow => ({
  story_id: 's1',
  name: 'Checkout',
  enabled: true,
  browser_provider: 'firecrawl_actions',
  last_run_status: 'passed',
  runs_24h: 24,
  passed_24h: 24,
  failed_24h: 0,
  error_24h: 0,
  pass_rate_pct: 100,
  ...over,
})

const skippedLocal = (id: string, name = id) =>
  row({ story_id: id, name, browser_provider: 'local', last_run_status: 'skipped', passed_24h: 0, pass_rate_pct: null })

describe('skipReason', () => {
  it('says a local story is skipped because it only runs on your computer, and the cloud fixes it', () => {
    const why = skipReason(skippedLocal('s1'))
    expect(why?.kind).toBe('local')
    expect(why?.text).toMatch(/your computer/)
    expect(why?.cloudFixes).toBe(true)
  })

  it('warns about a local story that has not run yet: its first run will be skipped', () => {
    expect(skipReason(row({ browser_provider: 'local', last_run_status: null, runs_24h: 0 }))?.kind).toBe('local')
  })

  it('explains Browserbase skips and offers the cloud runner', () => {
    const why = skipReason(row({ browser_provider: 'browserbase', last_run_status: 'skipped' }))
    expect(why?.kind).toBe('browserbase')
    expect(why?.cloudFixes).toBe(true)
  })

  it('reads a skipped cloud story as the per-app limit, which switching runners does not fix', () => {
    const why = skipReason(row({ last_run_status: 'skipped' }))
    expect(why?.kind).toBe('busy')
    expect(why?.cloudFixes).toBe(false)
  })

  it('gives no reason for a story that ran, or one that is turned off', () => {
    expect(skipReason(row())).toBeNull()
    expect(skipReason(row({ browser_provider: 'local', last_run_status: 'passed' }))).toBeNull()
    expect(skipReason({ ...skippedLocal('s1'), enabled: false })).toBeNull()
  })
})

describe('storyRunStatus / stripDayStatus / words', () => {
  it('maps run states to marks with plain labels', () => {
    expect(storyRunStatus({ enabled: true, last_run_status: 'skipped' })).toEqual({ status: 'cancelled', label: 'Skipped' })
    expect(storyRunStatus({ enabled: true, last_run_status: 'error' }).status).toBe('failed')
    expect(storyRunStatus({ enabled: true, last_run_status: null }).label).toBe('Never ran')
    expect(storyRunStatus({ enabled: false, last_run_status: 'passed' }).label).toBe('Turned off')
  })

  it('grades a day: failure beats pass beats skip; an older server without skipped reads as none', () => {
    expect(stripDayStatus({ day: 'd', passed: 1, failed: 1, skipped: 3 })).toBe('failed')
    expect(stripDayStatus({ day: 'd', passed: 1, failed: 0, skipped: 3 })).toBe('passed')
    expect(stripDayStatus({ day: 'd', passed: 0, failed: 0, skipped: 3 })).toBe('cancelled')
    expect(stripDayStatus({ day: 'd', passed: 0, failed: 0 })).toBe('idle')
  })

  it('names runners in plain words and builds the CLI command', () => {
    expect(providerWords('local')).toBe('On your computer')
    expect(providerWords('firecrawl_actions')).toBe('Cloud · Firecrawl')
    expect(providerWords('some_new')).toBe('some new')
    expect(cliRunCommand('abc')).toBe('mushi qa run abc')
  })
})

describe('qaPageStatus', () => {
  it('leads with tests that never ran and offers to run them all in the cloud', () => {
    const lead = qaPageStatus([skippedLocal('a'), skippedLocal('b'), skippedLocal('c')], { canEdit: true })
    expect(lead.tone).toBe('warn')
    expect(lead.sentence).toBe('3 tests never ran: they are set to run on your computer only.')
    expect(lead.neverRan).toBe(3)
    // One entry per test behind the number, for its mark (2026-11-19).
    expect(lead.neverRanTests.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(lead.neverRanTests[0]!.why).toBeTruthy()
    expect(lead.action).toEqual({ kind: 'run_in_cloud', storyIds: ['a', 'b', 'c'] })
  })

  it('gives a viewer the command instead of a button that writes', () => {
    const lead = qaPageStatus([skippedLocal('a')], { canEdit: false })
    expect(lead.sentence).toBe('1 test never ran: it is set to run on your computer only.')
    expect(lead.action).toEqual({ kind: 'copy_cli', storyId: 'a' })
  })

  it('puts failing tests first, naming the worst one', () => {
    const lead = qaPageStatus([
      skippedLocal('a'),
      row({ story_id: 'f1', name: 'Login', pass_rate_pct: 50, failed_24h: 12, passed_24h: 12 }),
      row({ story_id: 'f2', name: 'Signup', pass_rate_pct: 10, failed_24h: 20, passed_24h: 2 }),
    ])
    expect(lead.tone).toBe('danger')
    expect(lead.failing).toBe(2)
    expect(lead.action).toEqual({ kind: 'open_failing', storyId: 'f2', name: 'Signup' })
  })

  it('does not count a skipped story as never ran when something finished in the window', () => {
    const lead = qaPageStatus([row({ last_run_status: 'skipped', passed_24h: 3 })])
    expect(lead.neverRan).toBe(0)
    expect(lead.tone).toBe('ok')
  })

  it('says all clear only when every turned-on test passed, and says when all are off', () => {
    expect(qaPageStatus([row(), row({ story_id: 's2' })]).sentence).toBe('All 2 tests passed in the last 24 hours.')
    expect(qaPageStatus([row({ enabled: false })]).sentence).toMatch(/turned off/)
    expect(qaPageStatus([row()], { pendingRuns: 2 }).tone).toBe('info')
    expect(qaPageStatus([row({ runs_24h: 0, pass_rate_pct: null, passed_24h: 0, last_run_status: null })], { pendingRuns: 1 }).sentence).toBe('1 run in progress.')
  })
})

describe('cloudCanRunScript', () => {
  it('lets the cloud runner take prompts, URLs and JSON specs, never a Playwright script', () => {
    expect(cloudCanRunScript(null)).toBe(true)
    expect(cloudCanRunScript('')).toBe(true)
    expect(cloudCanRunScript('https://app.example.com/pricing')).toBe(true)
    expect(cloudCanRunScript('[{"type":"click","selector":"#buy"}]')).toBe(true)
    expect(cloudCanRunScript('{"assertContains":["Pricing"],"htmlOnly":true}')).toBe(true)
    expect(cloudCanRunScript("import { test, expect } from '@playwright/test'\ntest('buys', async ({ page }) => {})")).toBe(false)
  })
})
