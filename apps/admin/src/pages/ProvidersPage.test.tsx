/**
 * @vitest-environment jsdom
 *
 * /providers (Providers & AI routes): every tab renders from a fixture
 * snapshot; a loss cell is outlined. Routes (the default tab): the status
 * line, provider cards and the app × provider matrix; features with the same
 * steps fold into one chain; the drawer lists only priced models, saves one
 * edit to every feature after a review, re-reads first and refuses a chain
 * that changed, stops at the first refusal and says so; the default needs a
 * step turned on; a meta with `effort` shows that field for anthropic only;
 * a provider switch is confirmed with the apps it affects. "Used by" comes
 * from the routes.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiRoute, OpsMeta, OpsReadResponse, OpsSnapshot } from '../lib/kensaurusOpsTypes'

type Result = { ok: boolean; data?: unknown; error?: { code: string; message: string; issues?: unknown[] } }

const state = vi.hoisted(() => ({
  read: null as unknown,
  readError: null as null | { code: string; message: string },
  reads: [] as string[],
  writes: [] as Array<Record<string, unknown>>,
  writeResult: null as null | Promise<Result> | Result,
  /** Answers for the next writes, in order; falls back to writeResult. */
  writeQueue: [] as Result[],
  feed: null as unknown,
  toasts: [] as Array<{ tone: string; title: string }>,
}))

vi.mock('../lib/supabase', () => ({
  apiFetch: async (path: string) => {
    if (path.startsWith('/v1/admin/ops/events')) return { ok: true, data: state.feed ?? { events: [], apps: [], nextBefore: null, canAck: true } }
    state.reads.push(path)
    return state.readError ? { ok: false, error: state.readError } : { ok: true, data: state.read }
  },
  apiFetchMutate: async (_path: string, opts: { body: string }) => {
    state.writes.push(JSON.parse(opts.body))
    return state.writeQueue.shift() ?? state.writeResult ?? { ok: true, data: { action: 'x', result: null } }
  },
}))
vi.mock('../lib/toast', () => ({
  useToast: () => ({
    success: (title: string) => state.toasts.push({ tone: 'success', title }),
    error: (title: string) => state.toasts.push({ tone: 'error', title }),
    info: () => {},
    warn: () => {},
    push: () => {},
  }),
}))
vi.mock('../lib/useNow', () => ({ useNow: () => Date.parse('2026-11-18T12:00:00Z') }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/PageHeaderBar', async () => {
  const { createElement: h } = await import('react')
  return {
    PageHeaderBar: ({ title, children }: { title: string; children?: unknown }) => h('header', null, h('h1', null, title), children as never),
  }
})

const { ProvidersPage } = await import('./ProvidersPage')

// ── fixture: three accounts (down on balance, warn on usage, ok), one crit incident,
// yen-yen losing money on anthropic, two apps with routes, prices and some history ──

const opsMeta: OpsMeta = {
  version: 1,
  route_providers: ['openai', 'anthropic', 'together', 'openrouter'],
  priority: { min: 1, max: 9 },
  route_params: {
    max_output_tokens: 'integer 1..64000',
    temperature: 'number 0..2',
    reasoning_effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    thinking: { type: ['disabled', 'enabled', 'adaptive'], budget_tokens: 'integer 1024..64000, required for enabled' },
    secret_name: 'edge secret NAME',
  },
  threshold_keys: ['warn_balance', 'crit_balance', 'expected_tier', 'ok_statuses', 'warn_pct_used', 'crit_pct_used', 'stale_after_min', 'console_url'],
  actions: ['upsert_route', 'enable_route', 'disable_route', 'delete_route', 'reorder', 'set_provider_enabled', 'set_provider_thresholds'],
}

const route = (r: Partial<AiRoute> & Pick<AiRoute, 'app' | 'feature' | 'priority' | 'provider' | 'model'>): AiRoute => ({
  params: {},
  enabled: true,
  note: null,
  updated_at: '2026-11-18T10:00:00Z',
  updated_by: 'migration',
  provider_state: 'ok',
  ...r,
})

function opsSnapshot(): OpsSnapshot {
  return {
    generated_at: '2026-11-18T12:00:00Z',
    providers: [
      {
        id: 'kenji:openai',
        provider: 'openai',
        label: 'OpenAI (kenji)',
        host_project: 'kenji',
        origin: 'pull',
        probe_kind: 'billing',
        secret_name: 'OPENAI_API_KEY',
        depends: [{ app: 'yen-yen' }, { app: 'glot-it' }, { app: 'yen-yen', feature: 'chat' }],
        thresholds: { warn_balance: 20, crit_balance: 5 },
        enabled: true,
        is_test: false,
        updated_at: '2026-11-18T09:00:00Z',
        updated_by: 'migration',
        status: {
          state: 'down',
          state_since: '2026-11-18T09:00:00Z',
          pending_state: null,
          class: 'low_balance',
          last_probe_at: '2026-11-18T11:58:00Z',
          last_ok_at: '2026-11-18T08:55:00Z',
          http_status: 200,
          balance_micro: 3_200_000,
          usage: { balance: 3.2, currency: 'USD' },
          detail: '3.20 USD left',
        },
      },
      {
        id: 'kenji:elevenlabs',
        provider: 'elevenlabs',
        label: 'ElevenLabs',
        host_project: 'kenji',
        origin: 'pull',
        probe_kind: 'subscription',
        secret_name: 'ELEVENLABS_API_KEY',
        depends: [{ app: 'glot-it' }],
        thresholds: { warn_pct_used: 0.8, crit_pct_used: 0.95 },
        enabled: true,
        is_test: false,
        updated_at: '2026-11-18T09:00:00Z',
        updated_by: 'migration',
        status: {
          state: 'warn',
          state_since: '2026-11-18T11:00:00Z',
          pending_state: null,
          class: 'low_balance',
          last_probe_at: '2026-11-18T11:59:00Z',
          last_ok_at: '2026-11-18T11:59:00Z',
          http_status: 200,
          balance_micro: null,
          usage: { tier: 'creator', character_count: 85_000, character_limit: 100_000 },
          detail: "85% of this period's characters used",
        },
      },
      {
        id: 'kenji:anthropic',
        provider: 'anthropic',
        label: 'Anthropic',
        host_project: 'kenji',
        origin: 'pull',
        probe_kind: 'auth_only',
        secret_name: 'ANTHROPIC_API_KEY',
        depends: [{ app: 'yen-yen' }],
        thresholds: {},
        enabled: true,
        is_test: false,
        updated_at: '2026-11-18T09:00:00Z',
        updated_by: 'migration',
        status: {
          state: 'ok',
          state_since: '2026-11-17T12:00:00Z',
          pending_state: null,
          class: null,
          last_probe_at: '2026-11-18T11:59:30Z',
          last_ok_at: '2026-11-18T11:59:30Z',
          http_status: 200,
          balance_micro: null,
          usage: {},
          detail: 'Key accepted',
        },
      },
    ],
    incidents: [
      {
        id: 7,
        fingerprint: 'fp7',
        account_id: 'kenji:openai',
        app: 'yen-yen',
        feature: 'chat',
        provider: 'openai',
        model: 'gpt-6-luna',
        class: 'payment',
        source: 'reactive',
        severity: 'crit',
        count: 4,
        first_seen: '2026-11-18T09:05:00Z',
        last_seen: '2026-11-18T11:40:00Z',
        alerted_at: '2026-11-18T09:06:00Z',
      },
    ],
    spend: {
      last_24h: {
        since: '2026-11-17T12:00:00Z',
        rows: [
          { app: 'yen-yen', provider: 'anthropic', calls: 40, errors: 2, cost_micro: 9_000_000, sell_micro: 6_000_000 },
          { app: 'yen-yen', provider: 'openai', calls: 100, errors: 0, cost_micro: 2_000_000, sell_micro: 5_000_000 },
          { app: 'glot-it', provider: 'openai', calls: 10, errors: 1, cost_micro: 500_000, sell_micro: 1_000_000 },
        ],
        liability_micro: 123_450_000,
      },
      last_30d: {
        since: '2026-10-19T12:00:00Z',
        rows: [{ app: 'yen-yen', provider: 'openai', calls: 3000, errors: 12, cost_micro: 60_000_000, sell_micro: 150_000_000 }],
        liability_micro: 123_450_000,
      },
    },
    spend_hourly: [
      { hour: '2026-11-18T11:00:00Z', app: 'yen-yen', provider: 'openai', calls: 5, errors: 1, cost_micro: 2000, sell_micro: 5000 },
      { hour: '2026-11-18T10:00:00Z', app: 'glot-it', provider: 'openai', calls: 2, errors: 0, cost_micro: 1000, sell_micro: 2000 },
      { hour: '2026-11-18T10:00:00Z', app: 'yen-yen', provider: 'openai', calls: 3, errors: 0, cost_micro: 1500, sell_micro: 3000 },
    ],
    routes: [
      route({ app: 'yen-yen', feature: '*', priority: 1, provider: 'openai', model: 'gpt-6-luna', params: { reasoning_effort: 'none' }, provider_state: 'down' }),
      route({ app: 'yen-yen', feature: '*', priority: 3, provider: 'anthropic', model: 'claude-haiku-5-5', params: { effort: 'high' } }),
      route({ app: 'yen-yen', feature: 'chat', priority: 1, provider: 'anthropic', model: 'claude-haiku-5-5', enabled: false }),
      // glot-it: three features with the same two steps (translate at other priorities): one chain.
      route({ app: 'glot-it', feature: '*', priority: 1, provider: 'openai', model: 'gpt-6-luna' }),
      route({ app: 'glot-it', feature: '*', priority: 2, provider: 'openrouter', model: 'openai/gpt-6-luna', provider_state: 'unknown' }),
      route({ app: 'glot-it', feature: 'story', priority: 1, provider: 'openai', model: 'gpt-6-luna' }),
      route({ app: 'glot-it', feature: 'story', priority: 2, provider: 'openrouter', model: 'openai/gpt-6-luna', provider_state: 'unknown' }),
      route({ app: 'glot-it', feature: 'translate', priority: 2, provider: 'openai', model: 'gpt-6-luna' }),
      route({ app: 'glot-it', feature: 'translate', priority: 3, provider: 'openrouter', model: 'openai/gpt-6-luna', provider_state: 'unknown' }),
    ],
    route_changes: [
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
    provider_changes: [
      {
        id: 3,
        changed_at: '2026-11-18T11:00:00Z',
        changed_by: 'migration',
        op: 'UPDATE',
        account_id: 'kenji:elevenlabs',
        before: { enabled: false },
        after: { enabled: true },
      },
    ],
    prices: [
      { provider: 'anthropic', model: 'claude-haiku-5-5', unit_kind: 'tokens', input_per_mtok_micro: 1, output_per_mtok_micro: 5, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-10-08T00:00:00Z' },
      { provider: 'anthropic', model: 'claude-opus-5-5', unit_kind: 'tokens', input_per_mtok_micro: 15, output_per_mtok_micro: 75, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-09-26T00:00:00Z' },
      { provider: 'openai', model: 'gpt-6-luna', unit_kind: 'tokens', input_per_mtok_micro: 100_000, output_per_mtok_micro: 500_000, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-11-01T00:00:00Z' },
      { provider: 'openai', model: 'gpt-6.1-terra', unit_kind: 'tokens', input_per_mtok_micro: 1_000_000, output_per_mtok_micro: 5_000_000, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-11-01T00:00:00Z' },
      { provider: 'openai', model: 'gpt-6.2-sol', unit_kind: 'tokens', input_per_mtok_micro: 2_000_000, output_per_mtok_micro: 10_000_000, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-11-01T00:00:00Z' },
      { provider: 'openai', model: 'text-embedding-3-small', unit_kind: 'tokens', input_per_mtok_micro: 20_000, output_per_mtok_micro: 0, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-08-08T00:00:00Z' },
      { provider: 'openrouter', model: 'openai/gpt-6-luna', unit_kind: 'tokens', input_per_mtok_micro: 100_000, output_per_mtok_micro: 500_000, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-11-01T00:00:00Z' },
    ],
  }
}

function opsRead(): OpsReadResponse {
  return { meta: opsMeta, snapshot: opsSnapshot(), fetched_at: '2026-11-18T12:00:00Z', cached: false }
}


let container: HTMLDivElement
let root: Root

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => {})
}

async function render(path = '/providers', read: OpsReadResponse = opsRead()) {
  state.read = read
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(ProvidersPage)))
  })
  await flush()
}

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel)
/** The drawer and dialogs render into document.body. */
const d = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)

async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    el!.click()
  })
  await flush()
}

function buttonByText(text: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text) ?? null
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  setter.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  state.reads = []
  state.writes = []
  state.writeResult = null
  state.writeQueue = []
  state.feed = null
  state.readError = null
  state.toasts = []
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ProvidersPage tabs', () => {
  it('opens Providers on ?tab=providers: alert cards first, one row per account, worst first', async () => {
    await render('/providers?tab=providers')
    expect(q('h1')?.textContent).toBe('Providers & AI routes')
    expect(state.reads[0]).toBe('/v1/admin/kensaurus/ops')
    const alerts = [...container.querySelectorAll('[data-testid^="providers-alert-"]')].map((el) => el.getAttribute('data-testid'))
    expect(alerts).toEqual(['providers-alert-providers-down', 'providers-alert-incidents-crit', 'providers-alert-providers-warn'])
    const rows = [...container.querySelectorAll('[data-testid^="provider-row-"]')]
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['down', 'warn', 'ok'])
    expect(rows[0]!.textContent).toContain('$3.20 left')
    expect(rows[0]!.textContent).toContain('3h')
    expect(rows[1]!.textContent).toContain('85% used')
  })

  it('lines every value up under its column name, and labels values on a phone', async () => {
    await render('/providers?tab=providers')
    const width = (el: Element) => (el.className.match(/md:w-\S+|md:flex-1/g) ?? []).join(' ')
    const head = [...q('[data-testid="providers-head"]')!.children].map(width)
    const row = q('[data-testid^="provider-row-"]')!
    expect([...row.children].map(width)).toEqual(head)
    expect(head.every((w) => w !== '')).toBe(true)
    // Phone-only words beside the bare age and the empty incidents cell.
    expect(row.querySelector('[data-testid="provider-probed"]')?.textContent).toMatch(/probed .+ ago|never probed/)
    const rows = [...container.querySelectorAll('[data-testid^="provider-row-"]')]
    const noInc = rows.find((r) => !r.querySelector('[data-testid="provider-incidents"] [title]'))
    if (noInc) expect(noInc.querySelector('[data-testid="provider-incidents"]')?.textContent).toContain('no incidents')
    // No balance reading says why (a key-only check), hatched, never "no balance".
    const anthropic = q('[data-testid="provider-row-kenji:anthropic"]')!
    expect(anthropic.querySelector('[data-testid="gauge-not-checked"]')?.textContent).toBe('key check only')
    expect(container.textContent).not.toContain('no balance')
  })

  it('renders Spend with KPIs, the grid, totals and the hourly bars', async () => {
    await render('/providers?tab=spend')
    expect(q('[data-testid="spend-grid"]')).not.toBeNull()
    expect(q('[data-testid="spend-totals"]')?.textContent).toContain('$11.50')
    expect(q('[data-testid="spend-liability"]')?.textContent).toContain('$123.45')
    expect(container.querySelectorAll('[data-testid="hour-error-tick"]').length).toBe(1)
    // A chart is drawn, so its legend shows and no empty sentence does.
    expect(q('[data-testid="spend-hourly-legend-errors"]')).not.toBeNull()
    expect(q('[data-testid="spend-hourly-empty"]')).toBeNull()
  })

  it('outlines a cell whose cost beat what it sold', async () => {
    await render('/providers?tab=spend')
    expect(q('[data-testid="spend-cell-yen-yen-anthropic"]')?.getAttribute('data-loss')).toBe('true')
    expect(q('[data-testid="spend-cell-yen-yen-openai"]')?.getAttribute('data-loss')).toBeNull()
    expect(q('[data-testid="spend-cell-yen-yen-anthropic"]')?.className).toContain('ring-danger')
  })

  it('opens on Routes: one status line, a card per routed provider, the matrix and folded chains', async () => {
    await render()
    const line = q('[data-testid="routes-status-line"]')!
    expect(line.textContent).toBe('OpenAI down · Anthropic healthy · OpenRouter no health check yet · 1 open incident')
    expect(line.getAttribute('data-tone')).toBe('danger')
    expect([...container.querySelectorAll('[data-testid^="provider-card-"]')].map((c) => c.getAttribute('data-testid'))).toEqual([
      'provider-card-openai',
      'provider-card-anthropic',
      'provider-card-openrouter',
    ])
    // OpenRouter has no account on kenji: no health check, and its switch says so.
    expect(q('[data-testid="provider-card-openrouter"]')?.getAttribute('data-health')).toBe('no_check')
    expect(q<HTMLButtonElement>('[data-testid="provider-switch-openrouter"]')!.disabled).toBe(true)
    const role = (app: string, p: string) => q(`[data-testid="matrix-cell-${app}-${p}"]`)?.getAttribute('data-role')
    expect([role('yen-yen', 'openai'), role('yen-yen', 'anthropic'), role('yen-yen', 'openrouter')]).toEqual(['primary', 'last', 'none'])
    expect([role('glot-it', 'openai'), role('glot-it', 'openrouter'), role('glot-it', 'anthropic')]).toEqual(['primary', 'last', 'none'])
    expect(q('[data-testid="matrix-cell-yen-yen-openai"]')?.textContent).toContain('100')
    // glot-it's three features share one line; yen-yen's chat has its own order.
    expect(q('[data-testid="chain-glot-it-*"]')?.getAttribute('data-features')).toBe('3')
    expect(q('[data-testid="chain-glot-it-*"] [data-testid="chain-features"]')?.textContent).toBe('default, story, translate')
    expect(q('[data-testid="chain-yen-yen-chat"]')).not.toBeNull()
  })

  it('renders History newest first with before → after', async () => {
    await render('/providers?tab=history')
    const rows = [...container.querySelectorAll('[data-testid^="history-"]')].filter((el) => el.getAttribute('data-testid') !== 'providers-history')
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['history-p3', 'history-r11'])
    expect(rows[1]!.textContent).toContain('gpt-6')
    expect(rows[1]!.textContent).toContain('gpt-6-luna')
    expect(rows[1]!.textContent).not.toContain('updated_at')
  })
})

describe('ProvidersPage routes', () => {
  const openChain = async (sel: string) => {
    await render()
    await click(q<HTMLButtonElement>(`${sel} [data-testid="chain-open"]`))
    expect(d('[data-testid="chain-editor"]')).not.toBeNull()
  }
  const switchFirstModel = async (model: string) => {
    await act(async () => {
      choose(d<HTMLSelectElement>('[data-testid="step-0"] [data-testid="step-model"]')!, model)
    })
  }

  it('lists only priced chat models of the step’s provider, with prices and size', async () => {
    await openChain('[data-testid="chain-glot-it-*"]')
    const options = [...d<HTMLSelectElement>('[data-testid="step-0"] [data-testid="step-model"]')!.options]
    expect(options.map((o) => o.value)).toEqual(['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol'])
    expect(options[0]!.textContent).toBe('gpt-6-luna — $0.10 in / $0.50 out per 1M · small')
  })

  it('saves one model switch to every feature of the chain after a review, reading fresh first', async () => {
    await openChain('[data-testid="chain-glot-it-*"]')
    await switchFirstModel('gpt-6.1-terra')
    expect(d('[data-testid="chain-change-count"]')?.textContent).toBe('1 change')
    await click(d('[data-testid="chain-review-open"]'))
    expect(d('[data-testid="chain-changes"]')?.textContent).toBe('OpenAI: gpt-6-luna → gpt-6.1-terra')
    expect(d('[data-testid="chain-before"]')?.textContent).toContain('gpt-6-luna')
    expect(d('[data-testid="chain-after"]')?.textContent).toContain('gpt-6.1-terra')
    expect(state.writes).toEqual([])
    const readsBefore = state.reads.length
    await click(d('[data-testid="chain-save"]'))
    expect(state.writes).toEqual([
      { action: 'upsert_route', app: 'glot-it', feature: '*', priority: 1, provider: 'openai', model: 'gpt-6.1-terra' },
      { action: 'upsert_route', app: 'glot-it', feature: 'story', priority: 1, provider: 'openai', model: 'gpt-6.1-terra' },
      { action: 'upsert_route', app: 'glot-it', feature: 'translate', priority: 2, provider: 'openai', model: 'gpt-6.1-terra' },
    ])
    // One fresh read before the writes and one after, not one per write.
    expect(state.reads.slice(readsBefore)).toEqual(['/v1/admin/kensaurus/ops?fresh=1', '/v1/admin/kensaurus/ops?fresh=1'])
    expect(state.toasts).toEqual([{ tone: 'success', title: 'Saved to all 3 features of glot-it.' }])
    expect(d('[data-testid="chain-editor"]')).toBeNull()
  })

  it('stops at the first refusal and says which features changed', async () => {
    await openChain('[data-testid="chain-glot-it-*"]')
    await switchFirstModel('gpt-6.1-terra')
    await click(d('[data-testid="chain-review-open"]'))
    state.writeQueue = [
      { ok: true, data: {} },
      { ok: false, error: { code: 'unpriced_model', message: 'No price for gpt-6.1-terra on openai' } },
    ]
    await click(d('[data-testid="chain-save"]'))
    expect(state.writes).toHaveLength(2)
    expect(q('[data-testid="routes-save-report"]')?.textContent).toBe(
      'Saved 1 of 3 features. Stopped at story: No price for gpt-6.1-terra on openai. 1 not changed: translate. The rest keep the old order; open it again to finish.',
    )
    expect(state.toasts).toEqual([{ tone: 'error', title: 'Save stopped at story: 1 of 3 features changed.' }])
  })

  it('refuses to save a chain that changed since it was opened, and sends nothing', async () => {
    await openChain('[data-testid="chain-glot-it-*"]')
    await switchFirstModel('gpt-6.1-terra')
    await click(d('[data-testid="chain-review-open"]'))
    const changed = opsRead()
    changed.snapshot.routes = changed.snapshot.routes.map((r) => (r.app === 'glot-it' && r.feature === 'story' && r.priority === 1 ? { ...r, model: 'gpt-6.1-terra' } : r))
    state.read = changed
    await click(d('[data-testid="chain-save"]'))
    expect(state.writes).toEqual([])
    expect(state.toasts[0]?.tone).toBe('error')
    expect(state.toasts[0]?.title).toContain('This order changed since you opened it (story)')
  })

  it('keeps the default saveable only while one step is turned on', async () => {
    await openChain('[data-testid="chain-yen-yen-*"]')
    await click(d<HTMLButtonElement>('[data-testid="step-0"] [role="switch"]'))
    await click(d<HTMLButtonElement>('[data-testid="step-1"] [role="switch"]'))
    expect(d('[data-testid="chain-change-count"]')?.textContent).toBe('The default needs at least one step turned on.')
    expect(d<HTMLButtonElement>('[data-testid="chain-review-open"]')!.disabled).toBe(true)
  })

  it('reorders in the drawer and saves one reorder with the current priorities', async () => {
    await openChain('[data-testid="chain-yen-yen-*"]')
    await click(d<HTMLButtonElement>('[data-testid="step-1"] button[aria-label^="Move step 2"][aria-label$="up"]'))
    await click(d('[data-testid="chain-review-open"]'))
    await click(d('[data-testid="chain-save"]'))
    expect(state.writes).toEqual([{ action: 'reorder', app: 'yen-yen', feature: '*', order: [3, 1] }])
  })

  it('shows a meta param such as effort only for the provider that reads it', async () => {
    const read = opsRead()
    read.meta = { ...read.meta!, route_params: { ...read.meta!.route_params, effort: ['low', 'medium', 'high', 'xhigh', 'max'] } }
    await render('/providers', read)
    await click(q<HTMLButtonElement>('[data-testid="chain-yen-yen-*"] [data-testid="chain-open"]'))
    await click(d('[data-testid="add-step-open"]'))
    const form = () => d('[data-testid="add-step"]')!
    expect(form().querySelector('select[aria-label="effort"]')).toBeNull()
    expect(form().querySelector('select[aria-label="reasoning_effort"]')).not.toBeNull()
    await act(async () => {
      choose(form().querySelector<HTMLSelectElement>('select[aria-label="Provider for the new step"]')!, 'anthropic')
    })
    const effort = form().querySelector<HTMLSelectElement>('select[aria-label="effort"]')
    expect([...effort!.options].map((o) => o.value)).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(form().querySelector('select[aria-label="reasoning_effort"]')).toBeNull()
  })

  it('switches a provider off for every app only after a confirm that names the apps', async () => {
    await render()
    await click(q<HTMLButtonElement>('[data-testid="provider-switch-anthropic"]'))
    expect(document.body.textContent).toContain('Switch Anthropic off for every app?')
    expect(document.body.textContent).toContain('Apps that use it now: yen-yen.')
    expect(state.writes).toEqual([])
    await click(buttonByText('Switch off'))
    expect(state.writes).toEqual([{ action: 'set_provider_enabled', account_id: 'kenji:anthropic', enabled: false }])
    expect(state.toasts).toEqual([{ tone: 'success', title: 'Anthropic off for every app' }])
  })

  it('shows the weekly scout’s cheaper model and marks the chain it would change', async () => {
    state.feed = {
      events: [
        {
          kind: 'ai.model_scout',
          occurred_at: '2026-11-16T01:10:00Z',
          body: 'Suggestions only.\nopenai gpt-6-luna ($0.20/M) → openai/gpt-6-nano ($0.05/M, −75%), used by glot-it/* p1',
        },
      ],
      apps: [],
      nextBefore: null,
      canAck: true,
    }
    await render('/providers?org=11111111-1111-4111-8111-111111111111')
    expect(q('[data-testid="routes-cheaper-item"]')?.textContent).toContain('openai/gpt-6-nano')
    expect(q('[data-testid="chain-glot-it-*"]')?.textContent).toContain('cheaper model available')
  })
})

describe('ProvidersPage providers', () => {
  it('turns a provider off optimistically and confirms with a link to History', async () => {
    await render('/providers?tab=providers')
    await act(async () => {
      q<HTMLButtonElement>('[data-testid="provider-row-kenji:anthropic"] [role="switch"]')!.click()
    })
    await flush()
    expect(state.writes).toEqual([{ action: 'set_provider_enabled', account_id: 'kenji:anthropic', enabled: false }])
    expect(state.toasts).toEqual([{ tone: 'success', title: 'Anthropic off' }])
  })

  it('says who uses an account from the routes, not the account’s stale list', async () => {
    await render('/providers?tab=providers')
    const apps = (id: string) => [...q(`[data-testid="provider-row-${id}"] [data-testid="provider-used-by"]`)!.querySelectorAll('[data-app]')].map((el) => el.getAttribute('data-app'))
    expect(apps('kenji:openai')).toEqual(['glot-it', 'yen-yen'])
    // yen-yen's chat step on Anthropic is off; its default step is on.
    expect(apps('kenji:anthropic')).toEqual(['yen-yen'])
    // ElevenLabs lists glot-it in `depends`, but no route tries it.
    expect(q('[data-testid="provider-row-kenji:elevenlabs"] [data-testid="provider-used-by"]')?.textContent).toBe('no AI routes')
  })

  it('says the page is not connected when the server has no ops URL', async () => {
    state.readError = { code: 'NOT_FOUND', message: 'No such route.' }
    await render()
    expect(container.textContent).toContain('Not connected')
    expect(q('[data-testid="providers-rows"]')).toBeNull()
  })
})

describe('ProvidersPage routes: batch, Sol and the off pill (2026-11-21)', () => {
  const withBatch = () => {
    const read = opsRead()
    read.meta = { ...read.meta!, actions: [...read.meta!.actions, 'batch'], batch: { max_ops: 300, max_body_bytes: 65536 } }
    return read
  }
  const openGlot = async (read: OpsReadResponse) => {
    await render('/providers', read)
    await click(q<HTMLButtonElement>('[data-testid="chain-glot-it-*"] [data-testid="chain-open"]'))
  }
  const pick = async (sel: string, value: string) => {
    await act(async () => {
      choose(d<HTMLSelectElement>(sel)!, value)
    })
  }
  const terra = (feature: string, priority: number) => ({ action: 'upsert_route', app: 'glot-it', feature, priority, provider: 'openai', model: 'gpt-6.1-terra' })

  it('saves one chain edit as ONE batch call when upstream offers it, with what it read per feature', async () => {
    await openGlot(withBatch())
    await pick('[data-testid="step-0"] [data-testid="step-model"]', 'gpt-6.1-terra')
    await click(d('[data-testid="chain-review-open"]'))
    const readsBefore = state.reads.length
    await click(d('[data-testid="chain-save"]'))
    expect(state.writes).toEqual([
      {
        action: 'batch',
        app: 'glot-it',
        ops: [terra('*', 1), terra('story', 1), terra('translate', 2)],
        expect: [
          { feature: '*', count: 2, updated_at: '2026-11-18T10:00:00Z' },
          { feature: 'story', count: 2, updated_at: '2026-11-18T10:00:00Z' },
          { feature: 'translate', count: 2, updated_at: '2026-11-18T10:00:00Z' },
        ],
        note: 'OpenAI: gpt-6-luna → gpt-6.1-terra',
      },
    ])
    expect(state.reads.slice(readsBefore)).toEqual(['/v1/admin/kensaurus/ops?fresh=1', '/v1/admin/kensaurus/ops?fresh=1'])
    expect(state.toasts).toEqual([{ tone: 'success', title: 'Saved to all 3 features of glot-it.' }])
  })

  it('a stale batch saves nothing and says so, with no part-way report', async () => {
    await openGlot(withBatch())
    await pick('[data-testid="step-0"] [data-testid="step-model"]', 'gpt-6.1-terra')
    await click(d('[data-testid="chain-review-open"]'))
    state.writeQueue = [{ ok: false, error: { code: 'stale', message: 'glot-it / story changed since it was read; nothing was saved' } }]
    await click(d('[data-testid="chain-save"]'))
    expect(state.writes).toHaveLength(1)
    expect(state.toasts).toEqual([{ tone: 'error', title: 'This order changed since you opened it. Nothing was saved; open it again to see the latest.' }])
    expect(q('[data-testid="routes-save-report"]')).toBeNull()
  })

  it('falls back to one write at a time when the proxy does not know batch yet', async () => {
    await openGlot(withBatch())
    await pick('[data-testid="step-0"] [data-testid="step-model"]', 'gpt-6.1-terra')
    await click(d('[data-testid="chain-review-open"]'))
    state.writeQueue = [{ ok: false, error: { code: 'validation_failed', message: 'Unknown action.' } }]
    await click(d('[data-testid="chain-save"]'))
    expect(state.writes.map((w) => w.action)).toEqual(['batch', 'upsert_route', 'upsert_route', 'upsert_route'])
    expect(state.toasts).toEqual([{ tone: 'success', title: 'Saved to all 3 features of glot-it.' }])
  })

  it('picking Sol moves reasoning effort none to low, says so, and saves the new effort', async () => {
    const read = opsRead()
    read.snapshot.routes = read.snapshot.routes.map((r) => (r.app === 'glot-it' && r.provider === 'openai' ? { ...r, params: { reasoning_effort: 'none' } } : r))
    await openGlot(read)
    expect(d<HTMLSelectElement>('[data-testid="step-0"] [data-testid="step-effort"]')!.value).toBe('none')
    await pick('[data-testid="step-0"] [data-testid="step-model"]', 'gpt-6.2-sol')
    expect(d<HTMLSelectElement>('[data-testid="step-0"] [data-testid="step-effort"]')!.value).toBe('low')
    expect(d('[data-testid="step-0"] [data-testid="step-effort-note"]')?.textContent).toBe('gpt-6.2-sol needs reasoning effort low or higher, so it is now low.')
    // Setting it back to none is refused before review.
    await pick('[data-testid="step-0"] [data-testid="step-effort"]', 'none')
    expect(d('[data-testid="step-0"] [data-testid="step-problem"]')?.textContent).toBe('gpt-6.2-sol needs reasoning effort low or higher.')
    expect(d<HTMLButtonElement>('[data-testid="chain-review-open"]')!.disabled).toBe(true)
    await pick('[data-testid="step-0"] [data-testid="step-effort"]', 'low')
    await click(d('[data-testid="chain-review-open"]'))
    expect(d('[data-testid="chain-changes"]')?.textContent).toContain('OpenAI gpt-6.2-sol: reasoning none → low')
    await click(d('[data-testid="chain-save"]'))
    expect(state.writes[0]).toEqual({ action: 'upsert_route', app: 'glot-it', feature: '*', priority: 1, provider: 'openai', model: 'gpt-6.2-sol', params: { reasoning_effort: 'low' } })
    expect(state.writes).toHaveLength(3)
  })

  it('an off provider reads "Off for all apps" without a strike-through', async () => {
    const read = opsRead()
    read.snapshot.providers = read.snapshot.providers.map((p) => (p.id === 'kenji:anthropic' ? { ...p, enabled: false } : p))
    await render('/providers', read)
    const pill = q('[data-testid="provider-card-anthropic"] [data-testid="status-pill"]')!
    expect(pill.textContent).toBe('Off for all apps')
    expect(pill.innerHTML).not.toContain('line-through')
    expect(q('[data-testid="matrix-cell-yen-yen-anthropic"]')?.innerHTML).not.toContain('line-through')
  })
})
