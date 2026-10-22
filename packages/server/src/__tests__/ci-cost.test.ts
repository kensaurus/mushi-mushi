/**
 * FILE: ci-cost.test.ts
 * PURPOSE: `_shared/ci-cost.ts`, the money and time arithmetic behind
 *          GET /v1/admin/ci/compare (Plan 022 Phase 7):
 *            - busy time is the union of job intervals (parallel jobs once);
 *            - included minutes are per GitHub account and worth the Linux
 *              rate; nothing is billed until they run out;
 *            - electricity counts only the extra draw under load;
 *            - settings fall back to the example figures, reject values out
 *              of bounds, and clean the machine list.
 */

import { describe, expect, it } from 'vitest'
import {
  accountMonthCost,
  allocate,
  cleanMachines,
  costSettingsRow,
  DEFAULT_COST_SETTINGS,
  machineCost,
  machineFromSettings,
  mergeIntervals,
  money,
  normalizeCostSettings,
  toMonth,
  unionSeconds,
} from '../../supabase/functions/_shared/ci-cost.ts'

const ORG = '0000000a-0000-4000-8000-000000000000'
const T = (min: number) => Date.parse('2026-10-20T00:00:00Z') + min * 60_000

describe('busy time', () => {
  it('counts two parallel 10-minute jobs as 10 busy minutes, not 20', () => {
    expect(unionSeconds([[T(0), T(10)], [T(0), T(10)]])).toBe(600)
    expect(unionSeconds([[T(0), T(10)], [T(5), T(15)]])).toBe(900)
  })

  it('adds separate jobs, joins touching ones, and drops empty or inverted intervals', () => {
    expect(unionSeconds([[T(0), T(1)], [T(10), T(11)]])).toBe(120)
    expect(mergeIntervals([[T(0), T(5)], [T(5), T(6)]])).toEqual([[T(0), T(6)]])
    expect(unionSeconds([[T(5), T(5)], [T(9), T(1)], [NaN, T(3)]])).toBe(0)
    expect(unionSeconds([])).toBe(0)
  })

  it('merges out-of-order input', () => {
    expect(mergeIntervals([[T(20), T(30)], [T(0), T(10)], [T(8), T(22)]])).toEqual([[T(0), T(30)]])
  })

  it('projects a window to 30 days, never from less than a day of data', () => {
    expect(toMonth(10, 30)).toBe(10)
    expect(toMonth(10, 7)).toBeCloseTo(42.857, 3)
    expect(toMonth(10, 0.1)).toBe(300)
  })
})

describe('included minutes', () => {
  it('bills nothing while the included minutes last', () => {
    // 1,000 Linux minutes = $6 list; Free includes 2,000.
    expect(accountMonthCost(6, 2000)).toEqual({ costUsd: 0, includedUsedMinutes: 1000, includedLeftMinutes: 1000 })
  })

  it('bills only the minutes past the allowance', () => {
    // 23,352 Linux minutes ≈ $140.11 list; 2,000 included are worth $12.
    const m = accountMonthCost(23352 * 0.006, 2000)
    expect(m.costUsd).toBeCloseTo(128.112, 3)
    expect(m.includedLeftMinutes).toBe(0)
  })

  it('draws the allowance at the price ratio: 100 macOS minutes use 1,033 Linux-equivalent minutes', () => {
    const m = accountMonthCost(100 * 0.062, 2000)
    expect(m.includedUsedMinutes).toBe(1033)
    expect(m.costUsd).toBe(0)
  })

  it('handles zero use and zero included minutes', () => {
    expect(accountMonthCost(0, 3000)).toEqual({ costUsd: 0, includedUsedMinutes: 0, includedLeftMinutes: 3000 })
    expect(accountMonthCost(1.2, 0).costUsd).toBeCloseTo(1.2, 6)
  })
})

describe('allocate', () => {
  it('splits in proportion and gives nothing to zero weights', () => {
    expect(allocate(10, [1, 3])).toEqual([2.5, 7.5])
    expect(allocate(10, [0, 0])).toEqual([0, 0])
    expect(allocate(10, [-5, 5])).toEqual([0, 10])
  })
})

describe('machine cost', () => {
  it('counts only the extra draw under load, plus wear and the platform fee', () => {
    // The plan's example: 880 job-minutes, 150 W marginal, $0.20/kWh → at most about $0.45.
    const c = machineCost({ busyHours: 880 / 60, billedMinutes: 880, wattsIdle: 30, wattsLoad: 180, pricePerKwh: 0.2, wearPerHour: 0, feePerMinuteUsd: 0, fxPerUsd: 1 })
    expect(money(c.energy)).toBe(0.44)
    expect(c.wear).toBe(0)
    expect(c.platformFee).toBe(0)
  })

  it('applies wear per busy hour and the fee in the settings currency', () => {
    const c = machineCost({ busyHours: 10, billedMinutes: 600, wattsIdle: 50, wattsLoad: 50, pricePerKwh: 0.3, wearPerHour: 0.05, feePerMinuteUsd: 0.002, fxPerUsd: 150 })
    expect(c.energy).toBe(0)
    expect(c.wear).toBeCloseTo(0.5, 6)
    expect(c.platformFee).toBeCloseTo(180, 6)
  })

  it('never goes negative when load is below idle', () => {
    expect(machineCost({ busyHours: 5, billedMinutes: 0, wattsIdle: 200, wattsLoad: 100, pricePerKwh: 1, wearPerHour: 0, feePerMinuteUsd: 0, fxPerUsd: 1 }).energy).toBe(0)
  })
})

describe('settings', () => {
  it('shows the example figures, marked default, until saved', () => {
    const s = normalizeCostSettings(ORG, null)
    expect(s).toMatchObject({ organizationId: ORG, source: 'default', currency: 'USD', wattsLoad: DEFAULT_COST_SETTINGS.wattsLoad, includedMinutes: 2000, selfHostedFeePerMinuteUsd: 0, updatedAt: null })
  })

  it('reads a saved row (numeric strings too), with included minutes from the plan', () => {
    const s = normalizeCostSettings(ORG, { organization_id: ORG, currency: 'JPY', fx_per_usd: '150', watts_idle: '40', watts_load: 220, price_per_kwh: 31, plan: 'pro', included_minutes: null, updated_at: '2026-10-22T00:00:00Z' })
    expect(s).toMatchObject({ source: 'yours', currency: 'JPY', fxPerUsd: 150, wattsIdle: 40, wattsLoad: 220, pricePerKwh: 31, plan: 'pro', includedMinutes: 3000 })
  })

  it('falls back field by field on values out of bounds or of the wrong type', () => {
    const s = normalizeCostSettings(ORG, { organization_id: ORG, currency: 'dollars', watts_idle: -1, watts_load: 99999, price_per_kwh: 1001, plan: 'gold', included_minutes: 50 })
    expect(s).toMatchObject({ currency: 'USD', fxPerUsd: 1, wattsIdle: 30, wattsLoad: 180, pricePerKwh: 0.2, plan: 'free', includedMinutes: 50 })
  })

  it('keeps load at or above idle', () => {
    expect(normalizeCostSettings(ORG, { organization_id: ORG, watts_idle: 100, watts_load: 60 }).wattsLoad).toBe(100)
  })

  it('cleans the machine list: names, runner prefixes, duplicates, empties, bad watts', () => {
    expect(
      cleanMachines([
        { name: ' Alienware ', runners: ['aw-', ' alienware-', 'aw-', ''], wattsLoad: 250, wattsIdle: 'x' },
        { name: 'alienware', runners: ['dup'] },
        { name: 'NUC', runners: [] },
        { name: '', runners: ['x'] },
        'nope',
      ]),
    ).toEqual([{ name: 'Alienware', runners: ['aw-', 'alienware-'], wattsIdle: null, wattsLoad: 250 }])
    expect(cleanMachines(null)).toEqual([])
  })

  it('finds a runner\'s machine by exact name or prefix, case-insensitive', () => {
    const machines = cleanMachines([{ name: 'Alienware', runners: ['aw-', 'alienware-'] }, { name: 'NUC', runners: ['kensaurus-local-glot-1'] }])
    expect(machineFromSettings('aw-tsumagoi', machines)?.name).toBe('Alienware')
    expect(machineFromSettings('Alienware-yen-yen-1', machines)?.name).toBe('Alienware')
    expect(machineFromSettings('kensaurus-local-glot-1', machines)?.name).toBe('NUC')
    expect(machineFromSettings('other', machines)).toBeNull()
  })

  it('stores USD with an exchange rate of 1 whatever was sent', () => {
    const row = costSettingsRow(ORG, { ...DEFAULT_COST_SETTINGS, fxPerUsd: 7 }, 'u1', new Date('2026-10-22T00:00:00Z'))
    expect(row).toMatchObject({ organization_id: ORG, currency: 'USD', fx_per_usd: 1, updated_by: 'u1', updated_at: '2026-10-22T00:00:00.000Z' })
  })
})
