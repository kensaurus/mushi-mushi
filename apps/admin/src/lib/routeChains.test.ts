/**
 * routeChains: the Routes tab's pure rules on small inline data shaped like kenji's routes on
 * 2026-11-21 (glot.it: 42 features in 6 orders; yen-yen's drill puts Anthropic first).
 */

import { describe, expect, it } from 'vitest'
import type { AiRoute, ModelPrice, OpsAction, OpsMeta, OpsSnapshot, ProviderAccount } from './kensaurusOpsTypes'
import {
  batchFits,
  buildOverview,
  chainBatch,
  featureExpect,
  paramsForModel,
  paramsProblem,
  draftChanges,
  draftFrom,
  draftProblem,
  driftedFeatures,
  findChain,
  groupChains,
  incidentsByAppProvider,
  killImpact,
  modelTier,
  moveStep,
  planChainSave,
  planFeature,
  priceBook,
  priceLabel,
  providerHealth,
  routedProviders,
  routesStatusLine,
  routeUsers,
  runChainSave,
  saveReportText,
  scoutSuggestions,
  stableJson,
  type DraftStep,
  type ProviderHealth,
} from './routeChains'

const AT = '2026-11-21T00:00:00Z'
const NOW = Date.parse('2026-11-21T12:00:00Z')

const META: OpsMeta = {
  version: 1,
  route_providers: ['openai', 'anthropic', 'together', 'openrouter'],
  priority: { min: 1, max: 9 },
  route_params: {},
  threshold_keys: [],
  actions: [],
}

function rt(app: string, feature: string, priority: number, provider: string, model: string, over: Partial<AiRoute> = {}): AiRoute {
  return { app, feature, priority, provider, model, params: {}, enabled: true, note: null, updated_at: AT, updated_by: 'migration', provider_state: 'ok', ...over }
}

const LUNA = { reasoning_effort: 'none' }
const HAIKU = { effort: 'low', thinking: { type: 'disabled' } }

/** glot-it's small chain on n features: OpenAI → OpenRouter → Anthropic. */
function small(app: string, feature: string, base = 1): AiRoute[] {
  return [
    rt(app, feature, base, 'openai', 'gpt-6-luna', { params: LUNA }),
    rt(app, feature, base + 1, 'openrouter', 'openai/gpt-6-luna', { params: LUNA }),
    rt(app, feature, base + 2, 'anthropic', 'claude-haiku-5-5', { params: HAIKU }),
  ]
}

function acct(provider: string, enabled = true, state: 'ok' | 'down' | 'warn' = 'ok'): ProviderAccount {
  return {
    id: `kenji:${provider}`,
    provider,
    label: provider,
    host_project: 'kenji',
    origin: 'pull',
    probe_kind: 'auth_only',
    secret_name: null,
    depends: [],
    thresholds: {},
    enabled,
    is_test: false,
    updated_at: AT,
    updated_by: 'migration',
    status: { state, state_since: AT, pending_state: null, class: null, last_probe_at: AT, last_ok_at: AT, http_status: 200, balance_micro: null, usage: null, detail: null },
  }
}

function snapshot(routes: AiRoute[], providers: ProviderAccount[], over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  const empty = { since: AT, rows: [], liability_micro: 0 }
  return { generated_at: AT, providers, incidents: [], spend: { last_24h: empty, last_30d: empty }, spend_hourly: [], routes, route_changes: [], provider_changes: [], prices: [], ...over }
}

const healthMap = (providers: string[], accounts: ProviderAccount[]) => new Map<string, ProviderHealth>(providers.map((p) => [p, providerHealth(p, accounts)]))

describe('groupChains', () => {
  it('folds features with identical steps into one chain, default first, per app', () => {
    const routes = [
      ...small('glot-it', '*'),
      ...small('glot-it', 'story'),
      ...small('glot-it', 'translate', 4), // same steps at other priorities
      rt('glot-it', 'chat', 1, 'openai', 'gpt-6-luna', { params: { reasoning_effort: 'low' } }),
      rt('glot-it', 'chat', 2, 'openrouter', 'openai/gpt-6-luna', { params: { reasoning_effort: 'low' } }),
      ...small('yen-yen', '*'),
    ]
    const apps = groupChains(routes)
    expect(apps.map((a) => a.app)).toEqual(['glot-it', 'yen-yen'])
    const glot = apps[0]!
    expect(glot.features).toBe(4)
    expect(glot.chains).toHaveLength(2)
    expect(glot.chains[0]!.isDefault).toBe(true)
    expect(glot.chains[0]!.members.map((m) => m.feature)).toEqual(['*', 'story', 'translate'])
    expect(glot.chains[0]!.members[2]!.rows.map((r) => r.priority)).toEqual([4, 5, 6])
    expect(glot.chains[1]!.members.map((m) => m.feature)).toEqual(['chat'])
    // Never across apps: yen-yen's identical default is its own chain.
    expect(apps[1]!.chains[0]!.id).not.toBe(glot.chains[0]!.id)
  })

  it('treats params with the same values in another key order as the same, and on/off as different', () => {
    const a = [rt('x', '*', 1, 'anthropic', 'h', { params: { effort: 'low', thinking: { type: 'disabled' } } })]
    const b = [rt('x', 'f', 1, 'anthropic', 'h', { params: { thinking: { type: 'disabled' }, effort: 'low' } })]
    const c = [rt('x', 'g', 1, 'anthropic', 'h', { params: { effort: 'low', thinking: { type: 'disabled' } }, enabled: false })]
    const chains = groupChains([...a, ...b, ...c])[0]!.chains
    expect(chains).toHaveLength(2)
    expect(chains[0]!.members.map((m) => m.feature)).toEqual(['*', 'f'])
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('collapses 42 features to a handful of lines', () => {
    const features = Array.from({ length: 42 }, (_, i) => (i === 0 ? '*' : `f${i}`))
    const routes = features.flatMap((f, i) => (i % 7 === 0 ? [rt('glot-it', f, 1, 'openai', 'gpt-6.2-sol')] : small('glot-it', f)))
    const chains = groupChains(routes)[0]!.chains
    expect(chains).toHaveLength(2)
    expect(chains.reduce((n, c) => n + c.members.length, 0)).toBe(42)
  })
})

describe('overview', () => {
  const providers = ['openai', 'anthropic', 'together', 'openrouter']

  it('gives each provider its role in the default order only, with 24 h usage', () => {
    const routes = [
      ...small('yen-yen', '*'),
      // The drill tries Anthropic first; the default decides the role.
      rt('yen-yen', 'provider-drill', 1, 'anthropic', 'claude-haiku-5-5'),
      rt('yen-yen', 'provider-drill', 2, 'openai', 'gpt-6-luna'),
      rt('mushi-mushi', '*', 1, 'openai', 'gpt-6-luna'),
      rt('mushi-mushi', '*', 2, 'together', 'nemotron', { enabled: false }),
      rt('mushi-mushi', '*', 3, 'anthropic', 'claude-haiku-5-5'),
    ]
    const accounts = [acct('openai'), acct('anthropic'), acct('together')]
    const s = snapshot(routes, accounts, {
      spend: {
        last_24h: { since: AT, liability_micro: 0, rows: [{ app: 'yen-yen', provider: 'openai', calls: 120, errors: 2, cost_micro: 420_000, sell_micro: 0 }] },
        last_30d: { since: AT, rows: [], liability_micro: 0 },
      },
    })
    const rows = buildOverview(s, providers, healthMap(providers, accounts))
    const yen = rows.find((r) => r.app === 'yen-yen')!
    expect(yen.cells.get('openai')!.role).toBe('primary')
    expect(yen.cells.get('openrouter')!.role).toBe('backup')
    expect(yen.cells.get('anthropic')!.role).toBe('last')
    expect(yen.cells.get('anthropic')!.overrides).toBe(1)
    expect(yen.cells.get('together')!.role).toBe('none')
    expect(yen.cells.get('openai')!).toMatchObject({ calls: 120, errors: 2, cost: 420_000 })
    const mushi = rows.find((r) => r.app === 'mushi-mushi')!
    expect(mushi.cells.get('together')).toMatchObject({ role: 'off', offReason: 'step' })
    expect(mushi.cells.get('anthropic')!.role).toBe('last')
  })

  it('counts a switched-off provider as off everywhere and moves the next one up', () => {
    const routes = small('glot-it', '*')
    const accounts = [acct('openai', false), acct('anthropic')]
    const health = healthMap(providers, accounts)
    const glot = buildOverview(snapshot(routes, accounts), providers, health)[0]!
    expect(glot.cells.get('openai')).toMatchObject({ role: 'off', offReason: 'provider' })
    expect(glot.cells.get('openrouter')!.role).toBe('primary')
    expect(glot.cells.get('anthropic')!.role).toBe('last')
  })

  it('says "no health check yet" for a provider with no account, and off when every account is off', () => {
    expect(providerHealth('openrouter', [acct('openai')])).toMatchObject({ kind: 'no_check', word: 'No health check yet', killed: false })
    expect(providerHealth('anthropic', [acct('anthropic', false)])).toMatchObject({ kind: 'off', killed: true })
    expect(providerHealth('openai', [acct('openai', true, 'warn'), { ...acct('openai', true, 'down'), id: 'k2:openai' }]).kind).toBe('down')
  })

  it('writes the one-line status', () => {
    const accounts = [acct('openai'), acct('anthropic', false)]
    const line = routesStatusLine(['openai', 'openrouter', 'anthropic'].map((p) => providerHealth(p, accounts)), 0)
    expect(line.text).toBe('OpenAI healthy · OpenRouter no health check yet · Anthropic off for all apps · 0 open incidents')
    expect(line.tone).toBe('warn')
    expect(routesStatusLine([providerHealth('openai', [acct('openai')])], 1).text).toBe('OpenAI healthy · 1 open incident')
    expect(routesStatusLine([providerHealth('openai', [acct('openai', true, 'down')])], 0).tone).toBe('danger')
  })

  it('keys incidents by app and provider, app-reported ones (no account) included', () => {
    const inc = (over: Partial<OpsSnapshot['incidents'][number]>) => ({
      id: 1, fingerprint: 'f', account_id: null, app: 'glot-it', feature: null, provider: 'openai', model: null, class: 'payment', source: 'reactive' as const, severity: 'warn' as const, count: 1, first_seen: AT, last_seen: AT, alerted_at: null, ...over,
    })
    const m = incidentsByAppProvider({ providers: [acct('anthropic')], incidents: [inc({}), inc({ id: 2, severity: 'crit' }), inc({ id: 3, provider: null, account_id: 'kenji:anthropic', app: 'yen-yen' }), inc({ id: 4, app: null })] })
    expect(m.get('glot-it|openai')).toEqual({ total: 2, crit: true })
    expect(m.get('yen-yen|anthropic')).toEqual({ total: 1, crit: false })
    expect(m.size).toBe(2)
  })

  it('names the apps a kill switch affects and the features it would leave with nothing', () => {
    const routes = [...small('glot-it', '*'), rt('glot-it', 'chat', 1, 'openai', 'gpt-6-luna'), rt('yen-yen', '*', 1, 'anthropic', 'h')]
    const health = healthMap(providers, [acct('openai'), acct('anthropic')])
    const impact = killImpact(routes, 'openai', health)
    expect(impact.apps).toEqual(['glot-it'])
    expect(impact.stranded).toEqual([{ app: 'glot-it', features: ['chat'] }])
  })

  it('derives "Used by" from the routes that are turned on', () => {
    const routes = [...small('glot-it', '*'), rt('glot-it', 'chat', 1, 'openai', 'x'), rt('yen-yen', '*', 1, 'openai', 'x', { enabled: false }), rt('mushi-mushi', 'ask', 1, 'openai', 'x')]
    expect(routeUsers(routes, 'openai')).toEqual([
      { app: 'glot-it', features: ['default', 'chat'] },
      { app: 'mushi-mushi', features: ['ask'] },
    ])
    expect(routeUsers(routes, 'together')).toEqual([])
  })

  it('lists routed providers in meta order', () => {
    expect(routedProviders([...small('a', '*'), rt('a', 'f', 1, 'voyage', 'v')], META)).toEqual(['openai', 'anthropic', 'openrouter', 'voyage'])
  })
})

describe('price book', () => {
  const p = (model: string, input: number | null, output: number | null, effective_from = '2026-10-01T00:00:00Z', unit_kind = 'tokens'): ModelPrice => ({
    provider: 'anthropic', model, unit_kind, input_per_mtok_micro: input, output_per_mtok_micro: output, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from,
  })

  it('takes the newest price in effect, token chat models only, cheapest first', () => {
    const book = priceBook(
      [
        p('claude-sonnet-5', 3_000_000, 15_000_000, '2026-08-07T00:00:00Z'),
        p('claude-sonnet-5', 2_000_000, 10_000_000, '2026-08-21T00:00:00Z'),
        p('claude-haiku-5-5', 100_000, 500_000),
        p('claude-next', 1, 1, '2027-01-01T00:00:00Z'),
        p('embed', 20_000, 0),
        p('tts', null, null, AT, 'chars'),
        { ...p('gpt-x', 1, 1), provider: 'openai' },
      ],
      'anthropic',
      NOW,
    )
    expect(book.map((b) => [b.model, b.input, b.tier])).toEqual([
      ['claude-haiku-5-5', 100_000, 'small'],
      ['claude-sonnet-5', 2_000_000, 'mid'],
    ])
    expect(priceLabel(book[0]!)).toBe('$0.10 in / $0.50 out per 1M · small')
  })

  it('names the size from the model, else from the price', () => {
    expect(modelTier('gpt-6.2-sol', 0, 0)).toBe('top')
    expect(modelTier('gpt-6.1-terra', 0, 0)).toBe('mid')
    expect(modelTier('openai/gpt-6-luna', 9e9, 9e9)).toBe('small')
    expect(modelTier('nvidia/Nemotron', 150_000, 500_000)).toBe('small')
    expect(modelTier('gpt-x', 5_000_000, 25_000_000)).toBe('top')
  })
})

describe('editing a chain', () => {
  const chain = () => groupChains(small('glot-it', '*'))[0]!.chains[0]!

  it('says the edit in plain words', () => {
    const c = chain()
    let d = draftFrom(c)
    expect(draftChanges(c, d)).toEqual([])
    d = moveStep(d, 2, -1)
    d[0] = { ...d[0]!, model: 'gpt-6.1-terra' }
    d = d.filter((s) => s.provider !== 'openrouter')
    d.push({ provider: 'together', model: 'nemotron', params: {}, enabled: false, origin: null })
    expect(draftChanges(c, d)).toEqual([
      'Remove OpenRouter gpt-6-luna',
      'OpenAI: gpt-6-luna → gpt-6.1-terra',
      'Add Together nemotron as step 3 (off)',
    ])
    // Kept steps that swap places are a new order.
    expect(draftChanges(c, moveStep(draftFrom(c), 0, 1))).toEqual(['New order: OpenRouter gpt-6-luna → OpenAI gpt-6-luna → Anthropic claude-haiku-5-5'])
  })

  it('refuses a default with no step turned on, an empty or over-long order', () => {
    const c = chain()
    expect(draftProblem(c, draftFrom(c).map((s) => ({ ...s, enabled: false })), META)).toBe('The default needs at least one step turned on.')
    expect(draftProblem(c, [], META)).toBe('Keep at least one step.')
    const ten: DraftStep[] = Array.from({ length: 10 }, () => ({ provider: 'openai', model: 'm', params: {}, enabled: true, origin: null }))
    expect(draftProblem(c, ten, META)).toBe('At most 9 steps.')
    expect(draftProblem(c, draftFrom(c), META)).toBeNull()
    // A feature's own order may be all off (solo-boss advisor_quick is).
    const own = groupChains(small('a', 'f'))[0]!.chains[0]!
    expect(draftProblem(own, draftFrom(own).map((s) => ({ ...s, enabled: false })), META)).toBeNull()
  })
})

describe('planFeature', () => {
  const memberOf = (rows: AiRoute[]) => {
    const c = groupChains(rows)[0]!.chains[0]!
    return { c, m: c.members[0]! }
  }

  it('switches a model with one upsert that keeps the stored params', () => {
    const { c, m } = memberOf(small('glot-it', '*'))
    const d = draftFrom(c)
    d[0] = { ...d[0]!, model: 'gpt-6.1-terra' }
    expect(planFeature('glot-it', m, d, META).ops).toEqual([{ action: 'upsert_route', app: 'glot-it', feature: '*', priority: 1, provider: 'openai', model: 'gpt-6.1-terra' }])
  })

  it('reorders with the current priorities, gaps kept, and nothing else', () => {
    const { c, m } = memberOf(small('glot-it', 'story', 4))
    const d = moveStep(draftFrom(c), 2, -1)
    expect(planFeature('glot-it', m, d, META).ops).toEqual([{ action: 'reorder', app: 'glot-it', feature: 'story', order: [4, 6, 5] }])
  })

  it('adds at a free priority before deleting, turns on before off, and reorders last', () => {
    const { c, m } = memberOf(small('glot-it', '*'))
    // Remove OpenAI, turn Anthropic off, add Together first and on.
    let d = draftFrom(c).filter((s) => s.provider !== 'openai')
    d = d.map((s) => (s.provider === 'anthropic' ? { ...s, enabled: false } : s))
    d.unshift({ provider: 'together', model: 'nemotron', params: { max_output_tokens: 500 }, enabled: true, origin: null })
    const ops = planFeature('glot-it', m, d, META).ops
    expect(ops).toEqual([
      { action: 'upsert_route', app: 'glot-it', feature: '*', priority: 4, provider: 'together', model: 'nemotron', params: { max_output_tokens: 500 }, enabled: true },
      { action: 'disable_route', app: 'glot-it', feature: '*', priority: 3 },
      { action: 'delete_route', app: 'glot-it', feature: '*', priority: 1 },
      { action: 'reorder', app: 'glot-it', feature: '*', order: [4, 2, 3] },
    ])
  })

  it('turns a step on before turning the other off, so the default always has one', () => {
    const rows = [rt('a', '*', 1, 'openai', 'x'), rt('a', '*', 2, 'anthropic', 'y', { enabled: false })]
    const { c, m } = memberOf(rows)
    const d = draftFrom(c).map((s) => ({ ...s, enabled: !s.enabled }))
    expect(planFeature('a', m, d, META).ops.map((o) => o.action)).toEqual(['enable_route', 'disable_route'])
  })

  it('deletes first only when the order is too full to add', () => {
    const rows = Array.from({ length: 9 }, (_, i) => rt('a', 'f', i + 1, 'openai', `m${i}`))
    const { c, m } = memberOf(rows)
    const d = draftFrom(c).slice(1)
    d.push({ provider: 'anthropic', model: 'h', params: {}, enabled: true, origin: null })
    const ops = planFeature('a', m, d, META).ops
    expect(ops[0]).toEqual({ action: 'delete_route', app: 'a', feature: 'f', priority: 1 })
    expect(ops[1]).toMatchObject({ action: 'upsert_route', priority: 1, provider: 'anthropic' })
    expect(ops[2]).toEqual({ action: 'reorder', app: 'a', feature: 'f', order: [2, 3, 4, 5, 6, 7, 8, 9, 1] })
  })

  it('plans every feature of a chain from its own rows', () => {
    const c = groupChains([...small('glot-it', '*'), ...small('glot-it', 'story', 4)])[0]!.chains[0]!
    const d = draftFrom(c)
    d[2] = { ...d[2]!, enabled: false }
    expect(planChainSave(c, d, META)).toEqual([
      { app: 'glot-it', feature: '*', ops: [{ action: 'disable_route', app: 'glot-it', feature: '*', priority: 3 }] },
      { app: 'glot-it', feature: 'story', ops: [{ action: 'disable_route', app: 'glot-it', feature: 'story', priority: 6 }] },
    ])
  })
})

describe('runChainSave', () => {
  const c = groupChains([...small('glot-it', '*'), ...small('glot-it', 'story'), ...small('glot-it', 'translate')])[0]!.chains[0]!
  const d = draftFrom(c)
  d[0] = { ...d[0]!, model: 'gpt-6.1-terra' }
  const plans = planChainSave(c, d, META)

  it('sends every write in order and reports each feature saved', async () => {
    const sent: OpsAction[] = []
    const progress: number[] = []
    const report = await runChainSave(plans, async (a) => (sent.push(a), { ok: true }), (done) => progress.push(done))
    expect(sent.map((a) => ('feature' in a ? a.feature : ''))).toEqual(['*', 'story', 'translate'])
    expect(report).toEqual({ saved: ['*', 'story', 'translate'], failed: null, untouched: [], writes: 3 })
    expect(progress).toEqual([1, 2, 3])
    expect(saveReportText('glot.it', report, 3, (e) => e.message)).toBe('Saved to all 3 features of glot.it.')
  })

  it('stops at the first refusal and says what changed, what stopped and what was not touched', async () => {
    let n = 0
    const report = await runChainSave(plans, async () => (++n === 2 ? { ok: false, error: { code: 'unpriced_model', message: 'No price for gpt-6.1-terra' } } : { ok: true }))
    expect(n).toBe(2)
    expect(report.saved).toEqual(['*'])
    expect(report.failed).toMatchObject({ feature: 'story', done: 0, of: 1, error: { code: 'unpriced_model' } })
    expect(report.untouched).toEqual(['translate'])
    expect(saveReportText('glot.it', report, 3, (e) => e.message)).toBe(
      'Saved 1 of 3 features. Stopped at story: No price for gpt-6.1-terra. 1 not changed: translate. The rest keep the old order; open it again to finish.',
    )
  })

  it('says when a feature stopped part-way through its own writes', async () => {
    const two = [{ app: 'a', feature: '*', ops: [{ action: 'enable_route', app: 'a', feature: '*', priority: 2 } as OpsAction, { action: 'disable_route', app: 'a', feature: '*', priority: 1 } as OpsAction] }]
    let n = 0
    const report = await runChainSave(two, async () => (++n === 2 ? { ok: false, error: { code: 'last_default_route', message: 'a would have no enabled default route' } } : { ok: true }))
    expect(report.failed).toMatchObject({ done: 1, of: 2 })
    expect(saveReportText('a', report, 1, (e) => e.message)).toContain('Stopped at default (1 of its 2 changes went through): a would have no enabled default route.')
  })
})

describe('freshness', () => {
  it('finds features whose order changed or that are gone', () => {
    const routes = [...small('glot-it', '*'), ...small('glot-it', 'story')]
    const c = groupChains(routes)[0]!.chains[0]!
    expect(driftedFeatures(c, routes)).toEqual([])
    const changed = routes.map((r) => (r.feature === 'story' && r.priority === 1 ? { ...r, model: 'gpt-6.1-terra' } : r))
    expect(driftedFeatures(c, changed)).toEqual(['story'])
    expect(driftedFeatures(c, routes.filter((r) => r.feature !== '*'))).toEqual(['*'])
    expect(findChain(groupChains(changed), c.id)?.members.map((m) => m.feature)).toEqual(['*'])
  })
})

describe('scoutSuggestions', () => {
  it('reads the cheaper lines of the newest scout event and links the chains that use the model', () => {
    const apps = groupChains([...small('glot-it', '*'), rt('yen-yen', '*', 1, 'openai', 'gpt-6-luna', { params: LUNA })])
    const body =
      'Suggestions only; nothing was switched. To switch, change the route row (or the console) after a side-by-side check.\n' +
      'openai gpt-6-luna ($0.20/M) → openai/gpt-6-nano ($0.05/M, −75%), used by glot-it/* p1, yen-yen/* p1 · ' +
      'anthropic claude-haiku-5-5: price book $0.20/M but OpenRouter lists $0.30/M; check kensaurus_model_prices'
    const found = scoutSuggestions(
      [
        { kind: 'ai.model_scout', body: 'openai old ($9.00/M) → openai/x ($1.00/M, −89%), used by a/b p1', occurred_at: '2026-11-09T01:10:00Z' },
        { kind: 'ai.model_scout', body, occurred_at: '2026-11-16T01:10:00Z' },
        { kind: 'deploy.succeeded', body: null, occurred_at: '2026-11-20T00:00:00Z' },
      ],
      apps,
    )
    expect(found?.at).toBe('2026-11-16T01:10:00Z')
    expect(found?.items).toEqual([
      {
        provider: 'openai',
        model: 'gpt-6-luna',
        candidate: 'openai/gpt-6-nano',
        currentPerM: '$0.20',
        candidatePerM: '$0.05',
        savingPct: 75,
        uses: ['glot-it/* p1', 'yen-yen/* p1'],
        chains: [apps[0]!.chains[0]!.id, apps[1]!.chains[0]!.id],
        smaller: false,
      },
    ])
    expect(found?.smaller).toEqual([])
    // An older event wrote a downgrade as a swap: its size by name moves it out of the swaps.
    const old = scoutSuggestions(
      [{ kind: 'ai.model_scout', occurred_at: AT, body: 'anthropic claude-sonnet-5-5 ($4.00/M) → anthropic/claude-haiku-5.5 ($0.20/M, −95%), used by glot-it/judge p3' }],
      apps,
    )
    expect(old?.items).toEqual([])
    expect(old?.smaller.map((s) => s.candidate)).toEqual(['anthropic/claude-haiku-5.5'])
    // The scout's own wording since yen-yen PR 608.
    const now = scoutSuggestions(
      [
        {
          kind: 'ai.model_scout',
          occurred_at: AT,
          body: 'anthropic claude-opus-5-5 ($8.00/M) has a smaller, cheaper option, not a like-for-like swap: anthropic/claude-haiku-5.5 ($0.20/M, −98%), used by glot-it/script-top p3',
        },
      ],
      apps,
    )
    expect(now?.items).toEqual([])
    expect(now?.smaller).toMatchObject([{ model: 'claude-opus-5-5', candidate: 'anthropic/claude-haiku-5.5', savingPct: 98, smaller: true }])
    expect(scoutSuggestions([], apps)).toBeNull()
  })
})

describe('params a model refuses (Sol)', () => {
  it('refuses gpt-x-sol with reasoning effort none or minimal, on OpenAI and OpenRouter only', () => {
    expect(paramsProblem('openai', 'gpt-6.2-sol', { reasoning_effort: 'none' })).toBe('gpt-6.2-sol needs reasoning effort low or higher')
    expect(paramsProblem('openrouter', 'openai/gpt-6.2-sol', { reasoning_effort: 'minimal' })).not.toBeNull()
    expect(paramsProblem('openai', 'gpt-6.2-sol', { reasoning_effort: 'low' })).toBeNull()
    expect(paramsProblem('openai', 'gpt-6-luna', { reasoning_effort: 'none' })).toBeNull()
    expect(paramsProblem('anthropic', 'claude-opus-5-5', { effort: 'low' })).toBeNull()
  })

  it('moves the effort to low when a step switches to Sol, and says so; leaves anything else alone', () => {
    expect(paramsForModel('openai', 'gpt-6.2-sol', { reasoning_effort: 'none', max_output_tokens: 900 })).toEqual({
      params: { reasoning_effort: 'low', max_output_tokens: 900 },
      note: 'gpt-6.2-sol needs reasoning effort low or higher, so it is now low.',
    })
    const keep = { reasoning_effort: 'none' }
    expect(paramsForModel('openai', 'gpt-6.1-terra', keep)).toEqual({ params: keep, note: null })
  })

  it('blocks the save while a step pairs Sol with effort none, and names the settings change', () => {
    const c = groupChains(small('glot-it', '*'))[0]!.chains[0]!
    const d = draftFrom(c)
    d[0] = { ...d[0]!, model: 'gpt-6.2-sol' }
    expect(draftProblem(c, d, META)).toBe('OpenAI: gpt-6.2-sol needs reasoning effort low or higher.')
    d[0] = { ...d[0]!, params: { reasoning_effort: 'low' } }
    expect(draftProblem(c, d, META)).toBeNull()
    expect(draftChanges(c, d)).toEqual(['OpenAI: gpt-6-luna → gpt-6.2-sol', 'OpenAI gpt-6.2-sol: reasoning none → low'])
  })

  it('sends the full params with a switch only when the settings changed', () => {
    const c = groupChains(small('glot-it', '*'))[0]!.chains[0]!
    const m = c.members[0]!
    const d = draftFrom(c)
    d[0] = { ...d[0]!, model: 'gpt-6.2-sol', params: { reasoning_effort: 'low' } }
    expect(planFeature('glot-it', m, d, META).ops).toEqual([
      { action: 'upsert_route', app: 'glot-it', feature: '*', priority: 1, provider: 'openai', model: 'gpt-6.2-sol', params: { reasoning_effort: 'low' } },
    ])
    // A settings-only change is an upsert with the same model.
    const e = draftFrom(c)
    e[2] = { ...e[2]!, params: { ...e[2]!.params, effort: 'medium' } }
    expect(planFeature('glot-it', m, e, META).ops).toEqual([
      { action: 'upsert_route', app: 'glot-it', feature: '*', priority: 3, provider: 'anthropic', model: 'claude-haiku-5-5', params: { effort: 'medium', thinking: { type: 'disabled' } } },
    ])
  })
})

describe('batch save', () => {
  const stamp = (r: AiRoute, updated_at: string) => ({ ...r, updated_at })
  const routes = [
    ...small('glot-it', '*').map((r, i) => stamp(r, i === 1 ? '2026-11-21T12:10:00.654321+00:00' : '2026-11-21T12:10:00.654+00:00')),
    ...small('glot-it', 'story', 4).map((r) => stamp(r, '2026-11-20T09:00:00+00:00')),
  ]
  const chain = groupChains(routes)[0]!.chains[0]!

  it('expects each feature by row count and its newest updated_at, microseconds kept', () => {
    expect(chain.members.map(featureExpect)).toEqual([
      { feature: '*', count: 3, updated_at: '2026-11-21T12:10:00.654321+00:00' },
      { feature: 'story', count: 3, updated_at: '2026-11-20T09:00:00+00:00' },
    ])
  })

  it('puts every plan in one call, in order, with the edit in words', () => {
    const d = draftFrom(chain)
    d[0] = { ...d[0]!, model: 'gpt-6.1-terra' }
    const plans = planChainSave(chain, d, META)
    const b = chainBatch(chain, plans, 'OpenAI: gpt-6-luna → gpt-6.1-terra')
    expect(b.action).toBe('batch')
    expect(b.app).toBe('glot-it')
    expect(b.ops.map((o) => [o.feature, 'priority' in o ? o.priority : null])).toEqual([
      ['*', 1],
      ['story', 4],
    ])
    expect(b.expect).toHaveLength(2)
    expect(b.note).toBe('OpenAI: gpt-6-luna → gpt-6.1-terra')
    expect(chainBatch(chain, plans, 'x'.repeat(400)).note).toHaveLength(300)
    expect(chainBatch(chain, plans, '').note).toBeUndefined()
  })

  it('uses a batch only when upstream lists it and the call fits its limits', () => {
    const b = chainBatch(chain, planChainSave(chain, draftFrom(chain).reverse(), META), '')
    expect(batchFits(META, b)).toBe(false)
    const withBatch = { ...META, actions: ['batch'], batch: { max_ops: 300, max_body_bytes: 64 * 1024 } }
    expect(batchFits(withBatch, b)).toBe(true)
    expect(batchFits({ ...withBatch, batch: { max_ops: 1, max_body_bytes: 64 * 1024 } }, b)).toBe(false)
    expect(batchFits({ ...withBatch, batch: { max_ops: 300, max_body_bytes: 300 } }, b)).toBe(false)
  })
})
