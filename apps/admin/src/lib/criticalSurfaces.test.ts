/**
 * FILE: apps/admin/src/lib/criticalSurfaces.test.ts
 * PURPOSE: Each critical number names its scope, and a control is selected
 *          only when the list is the query that number counted.
 */

import { describe, expect, it } from 'vitest'
import {
  criticalChipActive,
  criticalChipHint,
  criticalChipLabel,
  criticalChipParams,
  criticalFiled30dLabel,
  criticalTileActive,
  criticalTileLabel,
} from './criticalSurfaces'
import { kpiTileFilter } from './reportsListFilters'

describe('critical surfaces', () => {
  it('the Bugs tile opens the 14-day still-open list, and is selected only then', () => {
    expect(criticalTileLabel('Critical', 14)).toBe('Critical · 14d still open')
    expect(kpiTileFilter('critical', 14)).toEqual({ severity: 'critical', days: '14', status: 'unresolved' })
    const listed = { severity: 'critical', status: 'unresolved', days: '14' }
    expect(criticalTileActive(listed, 'critical', 14)).toBe(true)
    // The all-time chip's list is a different query, so the tile stays off.
    expect(criticalTileActive({ severity: 'critical', status: '', days: '' }, 'critical', 14)).toBe(false)
    expect(criticalChipActive(listed, 'critical')).toBe(false)
  })

  it('the Bugs chip is every critical report, and is selected only with no window or status', () => {
    expect(criticalChipLabel('Critical')).toBe('Critical · all time')
    expect(criticalChipHint('critical')).toMatch(/any age and any status/)
    expect(criticalChipHint('critical')).toMatch(/last 14 days/)
    const listed = { severity: 'critical', status: '', days: '' }
    expect(criticalChipActive(listed, 'critical')).toBe(true)
    expect(criticalChipActive({ severity: 'critical', status: 'open', days: '' }, 'critical')).toBe(false)
    expect(criticalChipActive({ severity: 'critical', status: '', days: '14' }, 'critical')).toBe(false)
    // The 14-day tile's list is not this count: choosing the chip drops that window.
    expect(criticalChipParams({ severity: 'critical', status: 'unresolved', days: '14' }, 'critical')).toEqual({
      severity: 'critical',
      days: '',
      status: '',
    })
    expect(criticalChipParams({ severity: 'critical', status: '', days: '' }, 'critical')).toEqual({
      severity: '',
      days: '',
      status: '',
    })
  })

  it('the sidebar names a 30-day filing total, which is not the still-open tile', () => {
    expect(criticalFiled30dLabel(10)).toBe('10 critical reports filed in 30 days')
    expect(criticalFiled30dLabel(1)).toBe('1 critical report filed in 30 days')
    expect(criticalFiled30dLabel(10)).not.toBe(criticalTileLabel('Critical', 14))
  })
})
