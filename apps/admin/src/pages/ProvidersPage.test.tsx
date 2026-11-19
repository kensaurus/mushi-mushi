/**
 * @vitest-environment jsdom
 *
 * /providers (Providers & AI routes): every tab renders from a fixture
 * snapshot; a loss cell is outlined; reorder sends the feature's full
 * current order; the last enabled default cannot be turned off or deleted;
 * an optimistic toggle moves at once and falls back on a 409; the model
 * dropdown lists only priced models; a meta with `effort` shows that field
 * for anthropic only.
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
  toasts: [] as Array<{ tone: string; title: string }>,
}))

vi.mock('../lib/supabase', () => ({
  apiFetch: async (path: string) => {
    state.reads.push(path)
    return state.readError ? { ok: false, error: state.readError } : { ok: true, data: state.read }
  },
  apiFetchMutate: async (_path: string, opts: { body: string }) => {
    state.writes.push(JSON.parse(opts.body))
    return state.writeResult ?? { ok: true, data: { action: 'x', result: null } }
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
      route({ app: 'glot-it', feature: '*', priority: 1, provider: 'openai', model: 'gpt-6-luna' }),
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
      { provider: 'openai', model: 'gpt-6-luna', unit_kind: 'tokens', input_per_mtok_micro: 0, output_per_mtok_micro: 0, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-11-01T00:00:00Z' },
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
  state.readError = null
  state.toasts = []
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ProvidersPage tabs', () => {
  it('opens on Providers: alert cards first, one row per account, worst first', async () => {
    await render()
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
    await render()
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
    // No balance reading is unknown: hatched "not checked", never "no balance".
    const anthropic = q('[data-testid="provider-row-kenji:anthropic"]')!
    expect(anthropic.querySelector('[data-testid="gauge-not-checked"]')?.textContent).toBe('not checked')
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

  it('renders Routes per app and feature, a down provider struck and tried last', async () => {
    await render('/providers?tab=routes')
    expect(q('[data-testid="chain-yen-yen-*"]')?.textContent).toContain('default')
    const first = q('[data-testid="route-yen-yen|*|1"]')!
    expect(first.textContent).toContain('tried last')
    // The model shows once: the switcher is its name, struck when its provider is down.
    const model = first.querySelector<HTMLSelectElement>('[data-testid="switch-model"]')!
    expect(model.value).toBe('gpt-6-luna')
    expect(model.className).toContain('line-through')
    expect(q('[data-testid="route-yen-yen|*|3"] [data-testid="route-param-chips"]')?.textContent).toContain('effort high')
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
  it('sends the full current order when moving a candidate up', async () => {
    await render('/providers?tab=routes')
    const third = q('[data-testid="route-yen-yen|*|3"]')!
    await act(async () => {
      third.querySelector<HTMLButtonElement>('button[aria-label="Move up"]')!.click()
    })
    await flush()
    expect(state.writes).toEqual([{ action: 'reorder', app: 'yen-yen', feature: '*', order: [3, 1] }])
    // Refetched fresh after the write.
    expect(state.reads.at(-1)).toBe('/v1/admin/kensaurus/ops?fresh=1')
  })

  it('disables turning off or deleting the last enabled default', async () => {
    await render('/providers?tab=routes')
    const glot = q('[data-testid="route-glot-it|*|1"]')!
    expect(glot.querySelector('[data-testid="route-toggle-wrap"]')?.getAttribute('title')).toBe('Enable another default first')
    expect(glot.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true)
    expect(glot.querySelector<HTMLButtonElement>('button[aria-label="Delete #1"]')!.disabled).toBe(true)
    // yen-yen has a second enabled default, so its #1 may go off.
    expect(q<HTMLButtonElement>('[data-testid="route-yen-yen|*|1"] [role="switch"]')!.disabled).toBe(false)
  })

  it('moves a toggle at once and puts it back when the server answers 409', async () => {
    await render('/providers?tab=routes')
    let answer!: (r: Result) => void
    state.writeResult = new Promise<Result>((resolve) => {
      answer = resolve
    })
    const sel = '[data-testid="route-yen-yen|*|1"]'
    await act(async () => {
      q<HTMLButtonElement>(`${sel} [role="switch"]`)!.click()
    })
    expect(q(sel)?.getAttribute('data-enabled')).toBe('false')
    expect(q(`${sel} [data-testid="pending-mark"]`)).not.toBeNull()
    expect(state.writes[0]).toEqual({ action: 'disable_route', app: 'yen-yen', feature: '*', priority: 1 })
    await act(async () => {
      // Upstream's 409 message is what the toast reads (contract confirmed 2026-11-18).
      answer({ ok: false, error: { code: 'last_default_route', message: 'yen-yen would have no enabled default route' } })
    })
    await flush()
    expect(q(sel)?.getAttribute('data-enabled')).toBe('true')
    expect(q(`${sel} [data-testid="pending-mark"]`)).toBeNull()
    expect(state.toasts).toEqual([{ tone: 'error', title: 'yen-yen would have no enabled default route' }])
  })

  it('offers only priced models of the route’s provider', async () => {
    await render('/providers?tab=routes')
    const options = (sel: string) => [...q<HTMLSelectElement>(`${sel} [data-testid="switch-model"]`)!.options].map((o) => o.value)
    expect(options('[data-testid="route-yen-yen|*|3"]')).toEqual(['claude-haiku-5-5', 'claude-opus-5-5'])
    expect(options('[data-testid="route-yen-yen|*|1"]')).toEqual(['gpt-6-luna'])
  })

  it('switches a model with upsert_route and keeps stored params', async () => {
    await render('/providers?tab=routes')
    await act(async () => {
      choose(q<HTMLSelectElement>('[data-testid="route-yen-yen|*|3"] [data-testid="switch-model"]')!, 'claude-opus-5-5')
    })
    await flush()
    expect(state.writes).toEqual([{ action: 'upsert_route', app: 'yen-yen', feature: '*', priority: 3, provider: 'anthropic', model: 'claude-opus-5-5' }])
    expect(state.toasts[0]).toEqual({ tone: 'success', title: '#3 now claude-opus-5-5' })
  })

  it('shows a meta param such as effort only for the provider that reads it', async () => {
    const read = opsRead()
    read.meta = { ...read.meta!, route_params: { ...read.meta!.route_params, effort: ['low', 'medium', 'high', 'xhigh', 'max'] } }
    await render('/providers?tab=routes', read)
    const chain = q('[data-testid="chain-yen-yen-*"]')!
    await act(async () => {
      chain.querySelector<HTMLButtonElement>('button[aria-label="Add a candidate"]')!.click()
    })
    const form = () => chain.querySelector('[data-testid="add-candidate"]')!
    expect(form().querySelector('select[aria-label="effort"]')).toBeNull()
    expect(form().querySelector('select[aria-label="reasoning_effort"]')).not.toBeNull()
    await act(async () => {
      choose(form().querySelector<HTMLSelectElement>('select[aria-label="Provider"]')!, 'anthropic')
    })
    const effort = form().querySelector<HTMLSelectElement>('select[aria-label="effort"]')
    expect(effort).not.toBeNull()
    expect([...effort!.options].map((o) => o.value)).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(form().querySelector('select[aria-label="reasoning_effort"]')).toBeNull()
  })
})

describe('ProvidersPage providers', () => {
  it('turns a provider off optimistically and confirms with a link to History', async () => {
    await render()
    await act(async () => {
      q<HTMLButtonElement>('[data-testid="provider-row-kenji:anthropic"] [role="switch"]')!.click()
    })
    await flush()
    expect(state.writes).toEqual([{ action: 'set_provider_enabled', account_id: 'kenji:anthropic', enabled: false }])
    expect(state.toasts).toEqual([{ tone: 'success', title: 'Anthropic off' }])
  })

  it('says the page is not connected when the server has no ops URL', async () => {
    state.readError = { code: 'NOT_FOUND', message: 'No such route.' }
    await render()
    expect(container.textContent).toContain('Not connected')
    expect(q('[data-testid="providers-rows"]')).toBeNull()
  })
})
