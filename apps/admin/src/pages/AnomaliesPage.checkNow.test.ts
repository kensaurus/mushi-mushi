/**
 * Unusual spikes had "Check now" as a tab (an action, not a place), and its
 * Summary tab held only links when no numbers had arrived (console sweep,
 * 2026-10-28). Check now is a card on the Spikes tab, old ?tab=detect links
 * land there, and the empty Summary says what will appear. The page is too
 * heavy to render here, so this is pinned in source.
 */

import { describe, expect, it } from 'vitest'
import { checkNowBlocker } from './AnomaliesPage'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'AnomaliesPage.tsx'), 'utf8')

describe('Unusual spikes tabs', () => {
  it('has no Check now tab, and an old ?tab=detect link opens Spikes', () => {
    const tabs = src.slice(src.indexOf('const TABS'), src.indexOf('function resolveAnomaliesTab'))
    expect(tabs).not.toContain("'detect'")
    expect(src).toContain("if (value === 'detect') return 'anomalies'")
  })

  it('puts the Check now card on the Spikes tab', () => {
    const spikes = src.slice(src.indexOf("{activeTab === 'anomalies' && ("), src.indexOf("{activeTab === 'metrics' && ("))
    expect(spikes).toContain('<CheckNowCard')
    expect(spikes.indexOf('<CheckNowCard')).toBeLessThan(spikes.indexOf('<AnomaliesTab'))
  })

  // 2026-11-18: "No numbers yet" three times, two "Add metrics" buttons and an enabled Check now.
  it('disables Check now with its reason when there is nothing to check', () => {
    expect(checkNowBlocker('p1', false)).toBe('No numbers to check yet: add metrics first.')
    expect(checkNowBlocker('', true)).toBe('Pick an app in the header first.')
    expect(checkNowBlocker('p1', true)).toBeNull()
  })

  it('keeps one empty state: the Spikes list draws nothing more when no numbers arrived', () => {
    expect(src).toContain('if (!anomalies.length && noMetrics) return null')
    expect(src).not.toContain('No numbers yet. Send some on the Metrics tab first.')
  })

  // Round 3 (2026-11-19): with no metrics the empty state is said once; the tabs and a second
  // explainer line under it are gone until a number arrives.
  it('keeps one empty state on Summary: no tabs, no second explainer line, in plain words', () => {
    expect(src).not.toContain('Each number you send gets a chart here')
    expect(src).toContain("(stats.metricPointCount > 0 || activeTab !== 'overview')")
    expect(src).not.toMatch(/Page-Hinkley|Z-score|hourly cron|metric_series/)
  })
})
