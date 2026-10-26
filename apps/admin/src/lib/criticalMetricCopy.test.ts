/**
 * FILE: apps/admin/src/lib/criticalMetricCopy.test.ts
 * PURPOSE: Home, Bugs, the Critical chip, and the 30-day switcher must not
 *          share one unlabeled "critical" word (report 7972eaee).
 */
import { describe, expect, it } from 'vitest'
import {
  badgeWindowNote,
  bugsSeverityTileLabel,
  critical30dChipLabel,
  critical30dInlineLabel,
  criticalAllTimeChipLabel,
  criticalChipHint,
  homeCriticalPageSummary,
  homeCriticalTileCopy,
  homeOpenPrSublabel,
} from './criticalMetricCopy'

describe('home critical tile', () => {
  it('describes the 14-day decision count, not the untriaged backlog', () => {
    const tile = homeCriticalTileCopy()
    expect(tile.label).toBe('Critical · 14d')
    expect(tile.sublabel).toBe('to decide, not in a fix')
    expect(tile.sublabel).not.toMatch(/triag/i)
    expect(tile.sublabel).not.toMatch(/\d/)
    expect(homeCriticalPageSummary(4)).toBe('4 critical to decide in the last 14 days')
  })
})

describe('critical scopes stay distinct', () => {
  it('names a different window or status on each surface', () => {
    const home = homeCriticalTileCopy().label
    const bugs = bugsSeverityTileLabel('Critical', 14, true)
    const chip = criticalAllTimeChipLabel()
    const switcher = critical30dChipLabel(10)
    const folder = critical30dInlineLabel(10)

    expect(new Set([home, bugs, chip, switcher, folder]).size).toBe(5)
    expect(home).toContain('14d')
    expect(bugs).toBe('Critical · open · 14d')
    expect(bugsSeverityTileLabel('High', 14, false)).toBe('High · 14d')
    expect(chip).toContain('all')
    expect(criticalChipHint()).toMatch(/All-time/)
    expect(switcher).toContain('30d')
    expect(folder).toContain('30d')
    expect(home).not.toContain('30d')
    expect(switcher).not.toContain('14d')
  })

  it('prints the window on a sidebar badge whose name already states it', () => {
    expect(badgeWindowNote('2 critical reports (30d)')).toBe('30d')
    expect(badgeWindowNote('8 untriaged reports')).toBeNull()
  })
})

describe('home open PRs', () => {
  it('names the 30-day report count, apart from the stopped count', () => {
    expect(homeOpenPrSublabel(1, 0)).toBe('1 open PR · last 30 days · 0 stopped')
    expect(homeOpenPrSublabel(3, 2)).toBe('3 open PRs · last 30 days · 2 stopped')
  })
})
