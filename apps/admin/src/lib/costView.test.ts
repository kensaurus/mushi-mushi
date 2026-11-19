/**
 * Team → AI spend (round-2 review 2026-11-18): one 4-decimal money format,
 * and a key-source tile that reads the calls that ran. "12 BYOK" was amber
 * with "Add BYOK in Settings" while BYOK was in use.
 */

import { describe, expect, it } from 'vitest'
import { costTileDetails, formatSpendUsd, keySourceView, usesPlatformKeysOnly } from './costView'
import { EMPTY_COST_STATS, type CostStats } from '../components/cost/types'

function stats(over: Partial<CostStats> = {}): CostStats {
  return { ...EMPTY_COST_STATS, ...over }
}

describe('formatSpendUsd', () => {
  it('uses 4 decimals below a dollar, never 6', () => {
    expect(formatSpendUsd(0.0025)).toBe('$0.0025')
    expect(formatSpendUsd(0.00608)).toBe('$0.0061')
    expect(formatSpendUsd(0.0203)).toBe('$0.0203')
    expect(formatSpendUsd(12.4)).toBe('$12.40')
  })

  it('says <$0.0001 for dust and $0 for nothing', () => {
    expect(formatSpendUsd(0.00002)).toBe('<$0.0001')
    expect(formatSpendUsd(0)).toBe('$0')
    expect(formatSpendUsd(Number.NaN)).toBe('$0')
  })
})

describe('keySourceView', () => {
  it('BYOK calls are not a warning, whatever the legacy flag says', () => {
    const v = keySourceView(stats({ byokCalls24h: 12, platformKeyCalls24h: 0, byokAnthropicConfigured: false }))
    expect(v).toEqual({ value: '12 BYOK', tone: 'neutral', detail: 'All on your own key' })
    expect(v.detail).not.toMatch(/Add BYOK/)
  })

  it('warns only when every call ran on platform keys', () => {
    expect(keySourceView(stats({ byokCalls24h: 0, platformKeyCalls24h: 4 }))).toMatchObject({ tone: 'warn', value: '4 platform' })
    expect(usesPlatformKeysOnly(stats({ byokCalls24h: 2, platformKeyCalls24h: 4 }))).toBe(false)
    expect(keySourceView(stats({ byokCalls24h: 2, platformKeyCalls24h: 4 })).detail).toBe('4 on platform keys')
  })

  it('no calls is grey, not "0 platform"', () => {
    expect(keySourceView(stats())).toMatchObject({ tone: 'muted', value: 'No calls' })
  })
})

describe('costTileDetails', () => {
  it('keeps every detail short enough for a 390px tile', () => {
    const d = costTileDetails(
      stats({ calls24h: 12, avgCostPerCall24h: 0.0002, spend7dUsd: 0.0144, spend30dUsd: 0.0203, topOperation: 'webhooks-github-indexer', topOperationUsd: 0.0089, topModel: 'gpt-6.1-terra' }),
    )
    expect(d.spend24h).toBe('12 calls · avg $0.0002')
    expect(d.month).toBe('Last 7 days $0.0144')
    for (const line of Object.values(d)) expect(line.length).toBeLessThanOrEqual(24)
  })
})
