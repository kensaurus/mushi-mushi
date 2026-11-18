/**
 * providersView: the pure rules behind /providers, on small inline data.
 */

import { describe, expect, it } from 'vitest'
import type { AiRoute, ModelPrice, OpsMeta, OpsSnapshot, ProviderAccount, ProviderState } from './kensaurusOpsTypes'
import {
  actorLabel,
  ageLabel,
  applyOptimistic,
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

const NOW = Date.parse('2026-11-18T12:00:00Z')
const AT = '2026-11-18T10:00:00Z'

function acct(id: string, state: ProviderState | null, over: Partial<ProviderAccount> = {}, status: Partial<NonNullable<ProviderAccount['status']>> = {}): ProviderAccount {
  return {
    id,
    provider: id.split(':')[1]!,
    label: id,
    host_project: 'kenji',
    origin: 'pull',
    probe_kind: 'auth_only',
    secret_name: null,
    depends: [],
    thresholds: {},
    enabled: true,
    is_test: false,
    updated_at: AT,
    updated_by: 'migration',
    status: state && {
      state,
      state_since: '2026-11-18T09:00:00Z',
      pending_state: null,
      class: null,
      last_probe_at: AT,
      last_ok_at: AT,
      http_status: 200,
      balance_micro: null,
      usage: {},
      detail: null,
      ...status,
    },
    ...over,
  }
}

function rt(app: string, feature: string, priority: number, over: Partial<AiRoute> = {}): AiRoute {
  return { app, feature, priority, provider: 'openai', model: 'm', params: {}, enabled: true, note: null, updated_at: AT, updated_by: 'migration', provider_state: 'ok', ...over }
}

const price = (provider: string, model: string): ModelPrice => ({
  provider,
  model,
  unit_kind: 'tokens',
  input_per_mtok_micro: 1,
  output_per_mtok_micro: 1,
  cached_input_per_mtok_micro: null,
  per_unit_micro: null,
  effective_from: AT,
})

function snap(over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  const empty = { since: AT, rows: [], liability_micro: 0 }
  return {
    generated_at: '2026-11-18T12:00:00Z',
    providers: [],
    incidents: [],
    spend: { last_24h: empty, last_30d: empty },
    spend_hourly: [],
    routes: [],
    route_changes: [],
    provider_changes: [],
    prices: [],
    ...over,
  }
}

const META: OpsMeta = {
  version: 1,
  route_providers: ['openai', 'anthropic', 'together'],
  priority: { min: 1, max: 9 },
  route_params: { max_output_tokens: 'int', temperature: 'num', reasoning_effort: ['none', 'low'], thinking: { type: ['enabled'] }, secret_name: 'NAME' },
  threshold_keys: [],
  actions: [],
}

/** yen-yen: default #1 openai, #3 anthropic; chat #1 off. glot-it: one default. */
const ROUTES = [
  rt('yen-yen', '*', 1, { provider_state: 'down' }),
  rt('yen-yen', '*', 3, { provider: 'anthropic', model: 'claude-a' }),
  rt('yen-yen', 'chat', 1, { enabled: false }),
  rt('glot-it', '*', 1),
]

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

  it('sorts worst first, turned-off accounts last', () => {
    const list = [acct('k:a', 'ok'), acct('k:b', null), acct('k:c', 'down', { enabled: false }), acct('k:d', 'warn'), acct('k:e', 'down')]
    expect(sortProviders(list).map((p) => p.id)).toEqual(['k:e', 'k:d', 'k:b', 'k:a', 'k:c'])
  })

  it('draws a balance gauge in dollars, else a usage gauge, else none', () => {
    const bal = acct('k:openai', 'down', { thresholds: { warn_balance: 20, crit_balance: 5 } }, { balance_micro: 3_200_000 })
    const use = acct('k:eleven', 'warn', { thresholds: { warn_pct_used: 0.8, crit_pct_used: 0.95 } }, { usage: { character_count: 85_000, character_limit: 100_000 } })
    expect(providerGauge(bal)).toMatchObject({ kind: 'balance', value: 3.2, warn: 20, crit: 5, level: 'crit', label: '$3.20 left' })
    expect(providerGauge(use)).toMatchObject({ kind: 'usage', value: 0.85, max: 1, level: 'warn', label: '85% used' })
    expect(providerGauge(acct('k:x', 'ok'))).toBeNull()
    expect(providerGauge(acct('k:y', null))).toBeNull()
  })
})

describe('buildAlerts', () => {
  const incident = { id: 1, fingerprint: 'f', account_id: 'k:a', app: 'yen-yen', feature: null, provider: 'openai', model: null, class: 'payment', source: 'probe' as const, severity: 'crit' as const, count: 4, first_seen: AT, last_seen: AT, alerted_at: null }

  it('puts critical first and caps at three', () => {
    const s = snap({
      providers: [acct('k:w', 'warn'), acct('k:d', 'down'), acct('k:off', 'down', { enabled: false })],
      incidents: [incident],
      spend: { last_24h: { since: AT, liability_micro: 0, rows: [{ app: 'a', provider: 'p', calls: 1, errors: 0, cost_micro: 9, sell_micro: 6 }] }, last_30d: { since: AT, rows: [], liability_micro: 0 } },
    })
    const alerts = buildAlerts(s, NOW)
    expect(alerts.map((a) => a.id)).toEqual(['providers-down', 'incidents-crit', 'providers-warn'])
    expect(alerts[0]).toMatchObject({ title: 'k:d is down', metric: { value: '3h' } })
  })

  it('flags an app whose 24 h cost beats its sales', () => {
    const s = snap({ spend: { last_24h: { since: AT, liability_micro: 0, rows: [{ app: 'yen-yen', provider: 'anthropic', calls: 1, errors: 0, cost_micro: 9_000_000, sell_micro: 6_000_000 }] }, last_30d: { since: AT, rows: [], liability_micro: 0 } } })
    expect(buildAlerts(s, NOW)).toEqual([expect.objectContaining({ id: 'apps-loss', tab: 'spend', metric: { value: '$3.00', unit: 'lost' } })])
    expect(buildAlerts(snap(), NOW)).toEqual([])
  })
})

describe('buildSpendGrid', () => {
  it('marks a cell whose cost is over its sell as a loss and totals everything', () => {
    const grid = buildSpendGrid({
      since: AT,
      liability_micro: 0,
      rows: [
        { app: 'yen-yen', provider: 'anthropic', calls: 40, errors: 2, cost_micro: 9_000_000, sell_micro: 6_000_000 },
        { app: 'yen-yen', provider: 'openai', calls: 100, errors: 0, cost_micro: 2_000_000, sell_micro: 5_000_000 },
        { app: 'glot-it', provider: 'openai', calls: 10, errors: 1, cost_micro: 500_000, sell_micro: 1_000_000 },
      ],
    })
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
    const h = buildHourlyBars(
      [
        { hour: '2026-11-18T11:00:00Z', app: 'yen-yen', provider: 'openai', calls: 5, errors: 1, cost_micro: 2000, sell_micro: 5000 },
        { hour: '2026-11-18T10:00:00Z', app: 'yen-yen', provider: 'openai', calls: 3, errors: 0, cost_micro: 1500, sell_micro: 3000 },
        { hour: '2026-11-18T10:00:00Z', app: 'glot-it', provider: 'openai', calls: 2, errors: 0, cost_micro: 1000, sell_micro: 2000 },
        { hour: '2026-11-10T10:00:00Z', app: 'glot-it', provider: 'openai', calls: 2, errors: 0, cost_micro: 9999, sell_micro: 0 },
      ],
      '2026-11-18T12:00:00Z',
    )
    const bars = h.bars.get('openai')!
    expect(bars).toHaveLength(48)
    expect(bars[47]!.hour).toBe('2026-11-18T12:00:00.000Z')
    expect(bars[46]).toMatchObject({ cost: 2000, errors: 1 })
    expect(bars[45]!.segments).toEqual([
      { app: 'glot-it', cost: 1000 },
      { app: 'yen-yen', cost: 1500 },
    ])
    // A row outside the 48 hours is left out.
    expect(h.max).toBe(2500)
  })
})

describe('routes', () => {
  it('groups per app, default first, candidates by priority', () => {
    const groups = groupRoutes(ROUTES)
    expect(groups.map((g) => g.app)).toEqual(['glot-it', 'yen-yen'])
    expect(groups[1]!.features.map((f) => f.feature)).toEqual(['*', 'chat'])
    expect(groups[1]!.features[0]!.routes.map((r) => r.priority)).toEqual([1, 3])
  })

  it('guards the last enabled default route only', () => {
    expect(wouldDropLastDefault(ROUTES, { app: 'glot-it', feature: '*', priority: 1 })).toBe(true)
    expect(wouldDropLastDefault(ROUTES, { app: 'yen-yen', feature: '*', priority: 1 })).toBe(false)
    expect(wouldDropLastDefault(ROUTES, { app: 'yen-yen', feature: 'chat', priority: 1 })).toBe(false)
    const oneLeft = ROUTES.map((r) => (r.app === 'yen-yen' && r.priority === 3 ? { ...r, enabled: false } : r))
    expect(wouldDropLastDefault(oneLeft, { app: 'yen-yen', feature: '*', priority: 1 })).toBe(true)
    // An app with no enabled default has nothing to lose.
    const none = ROUTES.map((r) => (r.app === 'glot-it' ? { ...r, enabled: false } : r))
    expect(wouldDropLastDefault(none, { app: 'glot-it', feature: '*', priority: 1 })).toBe(false)
  })

  it('sends the full current order, with gaps, for a move', () => {
    const chain = groupRoutes(ROUTES)[1]!.features[0]!.routes
    expect(reorderPermutation(chain, 1, -1)).toEqual([3, 1])
    expect(reorderPermutation(chain, 0, 1)).toEqual([3, 1])
    expect(reorderPermutation(chain, 0, -1)).toBeNull()
    expect(reorderPermutation(chain, 1, 1)).toBeNull()
  })

  it('renumbers a reordered feature 1..n like upstream', () => {
    const chain = applyReorder(ROUTES, 'yen-yen', '*', [3, 1])
      .filter((r) => r.app === 'yen-yen' && r.feature === '*')
      .sort((a, b) => a.priority - b.priority)
    expect(chain.map((r) => [r.priority, r.model])).toEqual([
      [1, 'claude-a'],
      [2, 'm'],
    ])
  })

  it('applies optimistic patches, and leaves a reorder that no longer fits alone', () => {
    const s = snap({ routes: ROUTES, providers: [acct('k:a', 'ok')] })
    expect(applyOptimistic(s, { kind: 'provider-enabled', id: 'k:a', enabled: false })!.providers[0]!.enabled).toBe(false)
    expect(applyOptimistic(s, { kind: 'route-enabled', app: 'glot-it', feature: '*', priority: 1, enabled: false })!.routes[3]!.enabled).toBe(false)
    expect(applyOptimistic(s, { kind: 'reorder', app: 'yen-yen', feature: '*', order: [5, 1] })).toBe(s)
    expect(applyOptimistic(null, { kind: 'provider-enabled', id: 'k:a', enabled: false })).toBeNull()
  })

  it('offers only priced models of the provider', () => {
    const prices = [price('anthropic', 'claude-b'), price('anthropic', 'claude-a'), price('openai', 'gpt-x')]
    expect(pricedModels(prices, 'anthropic')).toEqual(['claude-a', 'claude-b'])
    expect(pricedModels(prices, 'together')).toEqual([])
  })

  it('finds the next free priority within meta bounds', () => {
    expect(nextFreePriority([rt('a', '*', 1), rt('a', '*', 3)], META)).toBe(2)
    expect(nextFreePriority([1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => rt('a', '*', p)), META)).toBeNull()
  })

  it('lists provider-only params only for their provider, effort included when meta has it', () => {
    expect(paramFieldsFor(META, 'openai')).toEqual(['max_output_tokens', 'temperature', 'reasoning_effort', 'secret_name'])
    expect(paramFieldsFor(META, 'anthropic')).toEqual(['max_output_tokens', 'temperature', 'thinking', 'secret_name'])
    const withEffort = { ...META, route_params: { ...META.route_params, effort: ['low', 'medium', 'high', 'xhigh', 'max'] } }
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
    const rows = buildHistory(
      [
        {
          id: 11,
          changed_at: '2026-11-18T10:00:00Z',
          changed_by: 'console:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          op: 'UPDATE',
          app: 'yen-yen',
          feature: '*',
          priority: 1,
          before: { model: 'gpt-6', enabled: true, updated_at: '2026-11-17T10:00:00Z' },
          after: { model: 'gpt-6-luna', enabled: true, updated_at: '2026-11-18T10:00:00Z' },
        },
      ],
      [{ id: 3, changed_at: '2026-11-18T11:00:00Z', changed_by: 'migration', op: 'UPDATE', account_id: 'kenji:eleven', before: { enabled: false }, after: { enabled: true } }],
    )
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
