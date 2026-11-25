/**
 * FILE: packages/server/src/__tests__/llm-cost-reconcile.test.ts
 * PURPOSE: The daily check of the priced ledger against what OpenAI and
 *          Anthropic billed (cost catalog program, wave 3).
 */
import { describe, expect, it, vi } from 'vitest'
import { parseAnthropicCosts, parseOpenAiCosts } from '../../supabase/functions/_shared/connectors/llm-usage.ts'
import {
  GAP_ALERT_PCT,
  reconcileDay,
  reconcileLlmCosts,
  repriceTransientInvocations,
  yesterdayUtc,
} from '../../supabase/functions/_shared/llm-cost-reconcile.ts'
import { setLlmPriceSource } from '../../supabase/functions/_shared/llm-cost.ts'
import { makeFakeDb, type Row } from './__stubs__/fake-supabase.ts'
import { fixturePriceSource } from './fixtures/price-book.ts'

const NOW = new Date('2026-11-25T04:00:00Z')
const DAY = '2026-11-24'
const ORG = '00000000-0000-0000-0000-0000000000aa'
const APP = '00000000-0000-0000-0000-0000000000a1'
const INST = '00000000-0000-0000-0000-0000000000c1'

describe('vendor units', () => {
  it('Anthropic cost_report amounts are cents; OpenAI costs are dollars', () => {
    const a = parseAnthropicCosts({ data: [{ starting_at: `${DAY}T00:00:00Z`, results: [{ amount: '1234.5', currency: 'USD', workspace_id: 'wrk_1' }] }] })
    expect(a).toEqual([{ day: DAY, externalId: 'wrk_1', usd: 12.345 }])
    const o = parseOpenAiCosts({ data: [{ start_time: Date.parse(`${DAY}T00:00:00Z`) / 1000, results: [{ amount: { value: 12.345 }, project_id: 'proj_1' }] }] })
    expect(o).toEqual([{ day: DAY, externalId: 'proj_1', usd: 12.345 }])
  })
})

describe('yesterdayUtc', () => {
  it('is the previous UTC day with half-open bounds', () => {
    expect(yesterdayUtc(NOW)).toEqual({ day: DAY, start: `${DAY}T00:00:00.000Z`, end: '2026-11-25T00:00:00.000Z' })
  })
})

describe('reconcileDay', () => {
  const vendorRows = [
    { day: DAY, externalId: 'proj_1', usd: 10 },
    { day: DAY, externalId: 'proj_other', usd: 99 },
    { day: '2026-11-23', externalId: 'proj_1', usd: 50 },
  ]
  const base = { day: DAY, vendorRows, bound: new Set(['proj_1']), ledgerUnpricedCalls: 0, platformKeyCalls: 0 }

  it('compares only the bound provider projects, for that day', () => {
    const r = reconcileDay({ ...base, ledgerUsd: 10.2 })
    expect(r).toMatchObject({ status: 'ok', vendorUsd: 10, ledgerUsd: 10.2, gapPct: 2 })
    expect(r.detail.unattributedUsd).toBe(99)
  })

  it(`flags a gap above ${GAP_ALERT_PCT}% either way`, () => {
    expect(reconcileDay({ ...base, ledgerUsd: 10.31 }).status).toBe('gap')
    expect(reconcileDay({ ...base, ledgerUsd: 9.6 }).status).toBe('gap')
    expect(reconcileDay({ ...base, ledgerUsd: 9.7 }).status).toBe('ok')
  })

  it('nothing billed but priced ledger spend is a gap with no percentage', () => {
    const r = reconcileDay({ ...base, vendorRows: [], ledgerUsd: 0.5 })
    expect(r).toMatchObject({ status: 'gap', vendorUsd: 0, gapPct: null, gapUsd: 0.5 })
    expect(reconcileDay({ ...base, vendorRows: [], ledgerUsd: 0 }).status).toBe('ok')
  })

  it('says what it could not compare', () => {
    expect(reconcileDay({ ...base, ledgerUsd: 10 }).detail.notCompared).toEqual([expect.stringMatching(/kensaurus_ai_calls/)])
  })
})

function seed(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    connector_instances: [{ id: INST, organization_id: ORG, kind: 'llm_usage', read_credential_ref: 'vault:1', config: { provider: 'anthropic' } }],
    connector_bindings: [{ connector_instance_id: INST, project_id: APP, external_id: 'wrk_1' }],
    connector_snapshots: [{
      connector_instance_id: INST, is_current: true, ok: true, error: null, observed_at: '2026-11-25T03:35:00Z',
      snapshot: { facts: { rows: [{ day: DAY, externalId: 'wrk_1', usd: 2 }] } },
    }],
    llm_invocations: [
      { project_id: APP, used_model: 'claude-sonnet-5-5', cost_usd: 1.5, key_source: 'byok', created_at: `${DAY}T10:00:00Z` },
      { project_id: APP, used_model: 'claude-sonnet-5-5', cost_usd: null, key_source: 'byok', created_at: `${DAY}T11:00:00Z` },
      // Platform-key calls bill Mushi Mushi's account, not the customer's.
      { project_id: APP, used_model: 'claude-sonnet-5-5', cost_usd: 9, key_source: 'env', created_at: `${DAY}T12:00:00Z` },
      // Another provider, and another day: not compared.
      { project_id: APP, used_model: 'gpt-6-luna', cost_usd: 4, key_source: 'byok', created_at: `${DAY}T12:00:00Z` },
      { project_id: APP, used_model: 'claude-sonnet-5-5', cost_usd: 4, key_source: 'byok', created_at: '2026-11-23T12:00:00Z' },
    ],
    llm_cost_reconciliations: [],
    ...over,
  }
}

describe('reconcileLlmCosts', () => {
  it('stores one row per instance and day and alerts on a gap', async () => {
    const db = makeFakeDb(seed())
    const alert = vi.fn().mockResolvedValue('created')
    const out = await reconcileLlmCosts(db as never, { now: NOW, alert })
    expect(out).toEqual([{ instanceId: INST, status: 'gap', reason: undefined }])
    const [row] = db.tables.llm_cost_reconciliations!
    expect(row).toMatchObject({ provider: 'anthropic', day: DAY, status: 'gap', vendor_usd: 2, ledger_usd: 1.5, ledger_unpriced_calls: 1, gap_pct: -25 })
    expect((row!.detail as Record<string, unknown>).platformKeyCallsExcluded).toBe(1)
    expect(alert).toHaveBeenCalledWith(APP, expect.objectContaining({ provider: 'anthropic', day: DAY }))

    // A re-run the same day updates the row instead of adding one.
    await reconcileLlmCosts(db as never, { now: NOW, alert })
    expect(db.tables.llm_cost_reconciliations).toHaveLength(1)
  })

  it('skips an instance with no admin key and says so', async () => {
    const db = makeFakeDb(seed({ connector_instances: [{ id: INST, organization_id: ORG, kind: 'llm_usage', read_credential_ref: null, config: { provider: 'openai' } }] }))
    const out = await reconcileLlmCosts(db as never, { now: NOW })
    expect(out).toEqual([{ instanceId: INST, status: 'skipped', reason: 'no_admin_key' }])
  })

  it('skips when nothing is bound or the snapshot is older than the day', async () => {
    expect((await reconcileLlmCosts(makeFakeDb(seed({ connector_bindings: [] })) as never, { now: NOW }))[0]!.reason).toBe('nothing_bound')
    const stale = seed()
    ;(stale.connector_snapshots![0] as Row).observed_at = '2026-11-24T03:35:00Z'
    expect((await reconcileLlmCosts(makeFakeDb(stale) as never, { now: NOW }))[0]!.reason).toBe('snapshot_older_than_day')
  })

  it('a failed cost report is an error row, not ok', async () => {
    const failed = seed()
    Object.assign(failed.connector_snapshots![0]!, { ok: false, error: 'Anthropic answered 403' })
    const out = await reconcileLlmCosts(makeFakeDb(failed) as never, { now: NOW })
    expect(out[0]!.status).toBe('error')
  })
})

describe('repriceTransientInvocations', () => {
  it('prices rows that failed only because the book was unreachable, and leaves real gaps alone', async () => {
    setLlmPriceSource(fixturePriceSource())
    const db = makeFakeDb({
      llm_invocations: [
        { id: 'a', used_model: 'claude-sonnet-5-5', input_tokens: 1_000_000, output_tokens: 0, cost_usd: null, unpriced_reason: 'price lookup failed: price bridge 503', created_at: `${DAY}T10:00:00Z` },
        { id: 'b', used_model: 'claude-made-up-9', input_tokens: 10, output_tokens: 10, cost_usd: null, unpriced_reason: 'anthropic:claude-made-up-9: no price in force', created_at: `${DAY}T10:00:00Z` },
        { id: 'c', used_model: 'gpt-transcribe', input_tokens: 0, output_tokens: 0, cost_usd: null, unpriced_reason: 'price lookup failed: timeout', created_at: `${DAY}T10:00:00Z` },
      ],
    })
    const out = await repriceTransientInvocations(db as never, NOW)
    setLlmPriceSource(null)
    expect(out).toEqual({ checked: 2, priced: 1 })
    const [a, b, c] = db.tables.llm_invocations!
    expect(a).toMatchObject({ cost_usd: 2, price_source: 'pricing_page', unpriced_reason: null })
    expect(b).toMatchObject({ cost_usd: null })
    // An audio row keeps no seconds, so it is not re-priced from tokens.
    expect(c).toMatchObject({ cost_usd: null })
  })
})
