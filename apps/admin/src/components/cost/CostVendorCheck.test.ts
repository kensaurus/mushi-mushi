import { describe, expect, it } from 'vitest'
import { vendorCheckLines } from './vendorCheck'
import { upgradeHintText } from '../../lib/billingView'
import type { ReconcileRow } from './types'

const row = (over: Partial<ReconcileRow>): ReconcileRow => ({
  connector_instance_id: 'i1',
  provider: 'openai',
  day: '2026-11-24',
  status: 'ok',
  vendor_usd: 2,
  ledger_usd: 2.02,
  ledger_unpriced_calls: 0,
  gap_usd: 0.02,
  gap_pct: 1,
  detail: {},
  updated_at: '2026-11-25T03:40:00Z',
  ...over,
})

describe('vendorCheckLines', () => {
  it('says a provider without an admin key is not checked', () => {
    const lines = vendorCheckLines({ providers: [{ provider: 'anthropic', connected: false, hasAdminKey: false }], rows: [] })
    expect(lines).toEqual([{ provider: 'anthropic', status: 'idle', text: 'Anthropic: not checked, no admin key.' }])
  })

  it('shows the latest day billed against recorded, with the gap and unpriced calls', () => {
    const lines = vendorCheckLines({
      providers: [{ provider: 'openai', connected: true, hasAdminKey: true }],
      rows: [row({ status: 'gap', ledger_usd: 1.5, vendor_usd: 2, gap_pct: -25, ledger_unpriced_calls: 3 })],
    })
    expect(lines[0]!.status).toBe('failed')
    expect(lines[0]!.text).toMatch(/OpenAI 2026-11-24: billed .*2.*recorded .*1\.5.*\(-25\.0%\), 3 unpriced\./)
  })

  it('explains a skipped day in words', () => {
    const lines = vendorCheckLines({
      providers: [{ provider: 'openai', connected: true, hasAdminKey: true }],
      rows: [row({ status: 'skipped', detail: { reason: 'nothing_bound' } })],
    })
    expect(lines[0]!.text).toBe('OpenAI 2026-11-24: not checked, no app is bound to a provider project or workspace.')
  })
})

describe('upgradeHintText', () => {
  it('is built from the plan row, not a literal', () => {
    expect(upgradeHintText({
      display_name: 'Builder',
      monthly_price_usd: 29,
      included_diagnoses_per_month: 1000,
      retention_days: 90,
      feature_flags: { audit_log: true, email_support: true },
    })).toBe('Get 1,000 diagnoses a month, 90 days of history, an audit log and email support on')
    expect(upgradeHintText({ display_name: 'X', monthly_price_usd: 5, retention_days: 30, feature_flags: {} })).toBe('Get 30 days of history on')
  })
})
