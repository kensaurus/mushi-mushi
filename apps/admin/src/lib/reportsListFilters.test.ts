/**
 * FILE: apps/admin/src/lib/reportsListFilters.test.ts
 * PURPOSE: /reports chips, tiles and links ask the list for exactly what
 *          they count (2026-10-04 console audit, group B #16, #73, #74,
 *          item 229, item 230, item 231, item 233, #87).
 */

import { describe, expect, it } from 'vitest'
import {
  PLATFORM_FILTER_OPTIONS,
  SDK_FILTER_OPTIONS,
  SEVERITY_CHIPS,
  STATUS_CHIPS,
  bulkConfirmCopy,
  defaultSortDir,
  criticalDecideTile,
  kpiTileFilter,
  reporterReportsHref,
  severityTileSublabel,
  sanitizeListFilters,
  statusChipCount,
  statusFilterLabel,
} from './reportsListFilters'

const STORED_SEVERITIES = ['critical', 'high', 'medium', 'low']

describe('quick filter chips', () => {
  it('only offer severities a report can have (#73: "major" matched nothing)', () => {
    for (const chip of SEVERITY_CHIPS) expect(STORED_SEVERITIES).toContain(chip.value)
    // The chips are the only severity filter now that the select is gone.
    expect(SEVERITY_CHIPS.map((c) => c.value)).toEqual(STORED_SEVERITIES)
  })

  it('count New the way status=new lists it: new plus queued (item 230)', () => {
    const stats = { total: 9, openCount: 7, byStatus: { new: 3, queued: 2, classified: 2, dismissed: 2 } }
    expect(statusChipCount('new', stats)).toBe(5)
    expect(statusChipCount('', stats)).toBe(9)
    expect(statusChipCount('open', stats)).toBe(7)
    expect(statusChipCount('classified', stats)).toBe(2)
    expect(statusChipCount('verified', stats)).toBe(0)
  })
})

describe('Status chips (item 229)', () => {
  it('offer verified and reopened, with readable labels', () => {
    const values = STATUS_CHIPS.map((c) => c.value)
    expect(values).toContain('verified')
    expect(values).toContain('reopened')
    expect(statusFilterLabel('open')).toBe('Open (needs a decision)')
    expect(statusFilterLabel('active')).toBe('Not dismissed')
    expect(statusFilterLabel('reopened')).toBe('Reopened')
  })
})

describe('Platform and SDK selects (#16)', () => {
  it('offer only values the server filters on', () => {
    expect(PLATFORM_FILTER_OPTIONS.map((o) => o.value)).toEqual(['ios', 'android', 'web', 'macos', 'windows', 'linux'])
    // React / Capacitor never stamp sdk_package: they report as the web SDK.
    expect(SDK_FILTER_OPTIONS.map((o) => o.value)).toEqual(['@mushi-mushi/web', '@mushi-mushi/react-native'])
  })
})

describe('severity KPI tiles (item 231)', () => {
  it('opens the list the tile counted: severity, window, and still awaiting a decision', () => {
    expect(kpiTileFilter('high', 14)).toEqual({ severity: 'high', days: '14', status: 'open' })
  })

  it('clearing the tile removes only what the tile set', () => {
    expect(kpiTileFilter(null, 14, { status: 'open', days: '14' })).toEqual({ severity: '', days: '', status: '' })
    expect(kpiTileFilter(null, 14, { status: 'unresolved', days: '14' })).toEqual({ severity: '', days: '', status: '' })
    expect(kpiTileFilter(null, 14, { status: 'active', days: '14' })).toEqual({ severity: '', days: '', status: '' })
    expect(kpiTileFilter(null, 14, { status: 'fixed', days: '30' })).toEqual({ severity: '', days: '30', status: 'fixed' })
  })

  it('Home critical tile and the Bugs critical tile are one list, and the subtitle is not the triage backlog', () => {
    const tile = criticalDecideTile()
    expect(tile).toEqual({
      label: 'Critical · 14d',
      sublabel: 'awaiting a decision',
      to: '/reports?status=open&severity=critical&days=14',
    })
    const q = new URLSearchParams(tile.to.split('?')[1])
    const filter = kpiTileFilter('critical', 14)
    expect(q.get('status')).toBe(filter.status)
    expect(q.get('severity')).toBe(filter.severity)
    expect(q.get('days')).toBe(filter.days)
    // "0 new, not yet triaged" was a different count under the headline.
    expect(tile.sublabel).not.toMatch(/triag/i)
  })

  it('the line under the headline is the rest of that window', () => {
    expect(severityTileSublabel(10, 4, 14, false)).toBe('10 filed in 14d · 6 in a fix or closed')
    expect(severityTileSublabel(0, 0, 14, true)).toBe('none in 14d · filtering')
  })
})

describe('Severity sort (#74)', () => {
  it('starts worst first', () => {
    expect(defaultSortDir('severity')).toBe('desc')
    expect(defaultSortDir('created_at')).toBe('desc')
    expect(defaultSortDir('status')).toBe('asc')
  })
})

describe('reporter links (item 233)', () => {
  it('prefer the identified user, then the device token', () => {
    expect(reporterReportsHref({ end_user_id: 'eu 1', reporter_token_hash: 'rk1_abc' })).toBe('/reports?end_user=eu%201')
    expect(reporterReportsHref({ end_user_id: null, reporter_token_hash: 'rk1_abc' })).toBe('/reports?reporter=rk1_abc')
  })

  it('give no link for a report without a reporter (was ?reporter=null)', () => {
    expect(reporterReportsHref({ end_user_id: null, reporter_token_hash: null })).toBeNull()
  })
})

describe('bulk confirm copy (#87)', () => {
  it('says the reporter messages cannot be taken back', () => {
    const dismiss = bulkConfirmCopy({ action: 'dismiss' }, 3)
    expect(dismiss.title).toBe('Dismiss 3 reports?')
    expect(dismiss.body).toMatch(/cannot take those messages back/)
    const fixed = bulkConfirmCopy({ action: 'set_status', value: 'fixed' }, 1)
    expect(fixed.title).toBe('Mark 1 report fixed?')
    expect(fixed.confirmLabel).toBe('Mark fixed')
  })
})

describe('sanitizeListFilters (stale bookmarks)', () => {
  it('maps the old React and Capacitor SDK values to the web SDK', () => {
    expect(sanitizeListFilters({ platform: '', sdkPackage: '@mushi-mushi/react', days: '' }).sdkPackage).toBe('@mushi-mushi/web')
    expect(sanitizeListFilters({ platform: '', sdkPackage: '@mushi-mushi/capacitor', days: '' }).sdkPackage).toBe('@mushi-mushi/web')
  })

  it('drops values the list cannot apply instead of failing the page', () => {
    expect(sanitizeListFilters({ platform: 'playstation', sdkPackage: 'left-pad', days: '400', origin: 'moon' })).toEqual({
      platform: '',
      sdkPackage: '',
      days: '',
      origin: '',
    })
    expect(sanitizeListFilters({ platform: 'ios', sdkPackage: '@mushi-mushi/react-native', days: '14', origin: 'local' })).toEqual({
      platform: 'ios',
      sdkPackage: '@mushi-mushi/react-native',
      days: '14',
      origin: 'local',
    })
  })
})
