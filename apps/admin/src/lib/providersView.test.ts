/**
 * providersView: the pure rules behind /providers.
 */

import { describe, expect, it } from 'vitest'
import { NOW, opsMeta, opsSnapshot } from './__fixtures__/opsSnapshot'
import {
  actorLabel,
  ageLabel,
  applyReorder,
  buildAlerts,
  buildHistory,
  buildHourlyBars,
  buildSpendGrid,
  cellKey,
  diffFields,
  formatMicroUsd,
  groupRoutes,
  marginOf,
  nextFreePriority,
  paramChips,
  paramFieldsFor,
  pricedModels,
  providerGauge,
  reorderPermutation,
  resolveProvidersTab,
  sortProviders,
  wouldDropLastDefault,
  writeErrorText,
} from './providersView'

describe('formatMicroUsd', () => {
  it('formats micro-USD at every scale', () => {
    expect(formatMicroUsd(null)).toBe('—')
    expect(formatMicroUsd(undefined)).toBe('—')
    expect(formatMicroUsd(0)).toBe('$0')
    expect(formatMicroUsd(2000)).toBe('<$0.01')
    expect(formatMicroUsd(10_000)).toBe('$0.01')
    expect(formatMicroUsd(4_270_000)).toBe('$4.27')
    expect(formatMicroUsd(1_234_000_000)).toBe('$1.2k')
    expect(formatMicroUsd(45_600_000_000)).toBe('$46k')
    expect(formatMicroUsd(2_500_000_000_000)).toBe('$2.5M')
    expect(formatMicroUsd(-3_100_000)).toBe('-$3.10')
  })

  it('computes margin over sell, null when nothing sold', () => {
    expect(marginOf(2, 5)).toBeCloseTo(0.6)
    expect(marginOf(9, 6)).toBeCloseTo(-0.5)
    expect(marginOf(1, 0)).toBeNull()
  })
})

describe('providers', () => {
  it('says how long a state has held', () => {
    expect(ageLabel('2026-11-18T09:00:00Z', NOW)).toBe('3h')
    expect(ageLabel('2026-11-18T11:58:00Z', NOW)).toBe('2m')
    expect(ageLabel('2026-11-15T12:00:00Z', NOW)).toBe('3d')
    expect(ageLabel(null, NOW)).toBeNull()
  })

  it('sorts worst first', () => {
    expect(sortProviders(opsSnapshot().providers).map((p) => p.id)).toEqual(['kenji:openai', 'kenji:elevenlabs', 'kenji:anthropic'])
  })

  it('draws a balance gauge in dollars, else a usage gauge, else none', () => {
    const [openai, eleven, anthropic] = opsSnapshot().providers
    expect(providerGauge(openai!)).toMatchObject({ kind: 'balance', value: 3.2, warn: 20, crit: 5, level: 'crit', label: '$3.20 left' })
    expect(providerGauge(eleven!)).toMatchObject({ kind: 'usage', value: 0.85, max: 1, level: 'warn', label: '85% used' })
    expect(providerGauge(anthropic!)).toBeNull()
  })
})

describe('buildAlerts', () => {
  it('puts critical first and caps at three', () => {
    const alerts = buildAlerts(opsSnapshot(), NOW)
    expect(alerts.map((a) => a.id)).toEqual(['providers-down', 'incidents-crit', 'providers-warn'])
  })

  it('flags an app whose 24 h cost beats its sales', () => {
    const s = opsSnapshot()
    s.providers = s.providers.map((p) => ({ ...p, status: p.status && { ...p.status, state: 'ok' as const } }))
    s.incidents = []
    s.spend.last_24h.rows = [{ app: 'yen-yen', provider: 'anthropic', calls: 1, errors: 0, cost_micro: 9_000_000, sell_micro: 6_000_000 }]
    const [loss] = buildAlerts(s, NOW)
    expect(loss).toMatchObject({ id: 'apps-loss', tab: 'spend', metric: { value: '$3.00', unit: 'lost' } })
  })
})

describe('buildSpendGrid', () => {
  it('marks a cell whose cost is over its sell as a loss and totals everything', () => {
    const grid = buildSpendGrid(opsSnapshot().spend.last_24h)
    expect(grid.apps).toEqual(['yen-yen', 'glot-it'])
    expect(grid.providers).toEqual(['anthropic', 'openai'])
    expect(grid.cells.get(cellKey('yen-yen', 'anthropic'))).toMatchObject({ loss: true })
    expect(grid.cells.get(cellKey('yen-yen', 'openai'))).toMatchObject({ loss: false, margin: 0.6 })
    expect(grid.totals).toMatchObject({ cost: 11_500_000, sell: 12_000_000, calls: 150, errors: 3 })
    expect(grid.maxCost).toBe(9_000_000)
  })

  it('treats null cost and sell as zero', () => {
    const grid = buildSpendGrid({ since: '', liability_micro: 0, rows: [{ app: 'a', provider: 'p', calls: 1, errors: 0, cost_micro: null, sell_micro: null }] })
    expect(grid.cells.get(cellKey('a', 'p'))).toMatchObject({ cost: 0, sell: 0, loss: false, margin: null })
  })
})

describe('buildHourlyBars', () => {
  it('lays 48 hourly bars per provider ending at the snapshot hour, stacked per app', () => {
    const s = opsSnapshot()
    const h = buildHourlyBars(s.spend_hourly, s.generated_at)
    const bars = h.bars.get('openai')!
    expect(bars).toHaveLength(48)
    expect(bars[47]!.hour).toBe('2026-11-18T12:00:00.000Z')
    expect(bars[46]).toMatchObject({ cost: 2000, errors: 1 })
    expect(bars[45]!.segments).toEqual([
      { app: 'glot-it', cost: 1000 },
      { app: 'yen-yen', cost: 1500 },
    ])
    expect(h.max).toBe(2500)
  })
})

describe('routes', () => {
  it('groups per app, default first, candidates by priority', () => {
    const groups = groupRoutes(opsSnapshot().routes)
    expect(groups.map((g) => g.app)).toEqual(['glot-it', 'yen-yen'])
    const yen = groups[1]!
    expect(yen.features.map((f) => f.feature)).toEqual(['*', 'chat'])
    expect(yen.features[0]!.routes.map((r) => r.priority)).toEqual([1, 3])
  })

  it('guards the last enabled default route only', () => {
    const routes = opsSnapshot().routes
    expect(wouldDropLastDefault(routes, { app: 'glot-it', feature: '*', priority: 1 })).toBe(true)
    expect(wouldDropLastDefault(routes, { app: 'yen-yen', feature: '*', priority: 1 })).toBe(false)
    expect(wouldDropLastDefault(routes, { app: 'yen-yen', feature: 'chat', priority: 1 })).toBe(false)
    const oneLeft = routes.map((r) => (r.app === 'yen-yen' && r.priority === 3 ? { ...r, enabled: false } : r))
    expect(wouldDropLastDefault(oneLeft, { app: 'yen-yen', feature: '*', priority: 1 })).toBe(true)
    // An app with no enabled default has nothing to lose.
    const none = routes.map((r) => (r.app === 'glot-it' ? { ...r, enabled: false } : r))
    expect(wouldDropLastDefault(none, { app: 'glot-it', feature: '*', priority: 1 })).toBe(false)
  })

  it('sends the full current order, with gaps, for a move', () => {
    const chain = groupRoutes(opsSnapshot().routes)[1]!.features[0]!.routes
    expect(reorderPermutation(chain, 1, -1)).toEqual([3, 1])
    expect(reorderPermutation(chain, 0, 1)).toEqual([3, 1])
    expect(reorderPermutation(chain, 0, -1)).toBeNull()
    expect(reorderPermutation(chain, 1, 1)).toBeNull()
  })

  it('renumbers a reordered feature 1..n like upstream', () => {
    const next = applyReorder(opsSnapshot().routes, 'yen-yen', '*', [3, 1])
    const chain = next.filter((r) => r.app === 'yen-yen' && r.feature === '*').sort((a, b) => a.priority - b.priority)
    expect(chain.map((r) => [r.priority, r.model])).toEqual([
      [1, 'claude-haiku-5-5'],
      [2, 'gpt-6-luna'],
    ])
  })

  it('offers only priced models of the provider', () => {
    expect(pricedModels(opsSnapshot().prices, 'anthropic')).toEqual(['claude-haiku-5-5', 'claude-opus-5-5'])
    expect(pricedModels(opsSnapshot().prices, 'together')).toEqual([])
  })

  it('finds the next free priority within meta bounds', () => {
    const chain = groupRoutes(opsSnapshot().routes)[1]!.features[0]!.routes
    expect(nextFreePriority(chain, opsMeta)).toBe(2)
  })

  it('lists provider-only params only for their provider, effort included when meta has it', () => {
    expect(paramFieldsFor(opsMeta, 'openai')).toEqual(['max_output_tokens', 'temperature', 'reasoning_effort', 'secret_name'])
    expect(paramFieldsFor(opsMeta, 'anthropic')).toEqual(['max_output_tokens', 'temperature', 'thinking', 'secret_name'])
    const withEffort = { ...opsMeta, route_params: { ...opsMeta.route_params, effort: ['low', 'medium', 'high', 'xhigh', 'max'] } }
    expect(paramFieldsFor(withEffort, 'anthropic')).toContain('effort')
    expect(paramFieldsFor(withEffort, 'openai')).not.toContain('effort')
    expect(paramFieldsFor(withEffort, 'together')).toEqual(['max_output_tokens', 'temperature', 'secret_name'])
  })

  it('renders params as short chips', () => {
    expect(paramChips({ effort: 'high', temperature: 0.2, thinking: { type: 'enabled', budget_tokens: 4096 } })).toEqual([
      'effort high',
      'temp 0.2',
      'thinking enabled 4096',
    ])
    expect(paramChips(null)).toEqual([])
  })
})

describe('history', () => {
  it('merges route and account changes newest first with only changed fields', () => {
    const s = opsSnapshot()
    const rows = buildHistory(s.route_changes, s.provider_changes)
    expect(rows.map((r) => r.id)).toEqual(['p3', 'r11'])
    expect(rows[1]).toMatchObject({ actor: 'console:aaaaaaaa', subject: 'yen-yen › default › #1', diff: [{ field: 'model', before: 'gpt-6', after: 'gpt-6-luna' }] })
    expect(rows[0]!.diff).toEqual([{ field: 'enabled', before: 'false', after: 'true' }])
  })

  it('diffs inserts and deletes against nothing', () => {
    expect(diffFields(null, { model: 'm' })).toEqual([{ field: 'model', before: '—', after: 'm' }])
    expect(actorLabel(null)).toBe('unknown')
    expect(actorLabel('migration')).toBe('migration')
  })
})

describe('tabs and errors', () => {
  it('defaults to Providers', () => {
    expect(resolveProvidersTab(null)).toBe('providers')
    expect(resolveProvidersTab('routes')).toBe('routes')
    expect(resolveProvidersTab('nope')).toBe('providers')
  })

  it('maps refused writes to one line', () => {
    expect(writeErrorText({ code: 'unpriced_model', message: 'x' })).toBe('No price for this model yet: add it in Kenji first')
    expect(writeErrorText({ code: 'validation_failed', message: 'validation_failed', issues: ['params.effort: unrecognized_keys'] })).toBe(
      'Not saved: params.effort: unrecognized_keys',
    )
    expect(writeErrorText({ code: 'last_default_route', message: '' })).toContain('Enable another default first')
    expect(writeErrorText(undefined)).toBe('Not saved.')
  })
})
