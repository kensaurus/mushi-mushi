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
import { NOW, opsRead } from '../lib/__fixtures__/opsSnapshot'
import type { OpsReadResponse } from '../lib/kensaurusOpsTypes'

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
vi.mock('../lib/useNow', () => ({ useNow: () => NOW }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/PageHeaderBar', async () => {
  const { createElement: h } = await import('react')
  return {
    PageHeaderBar: ({ title, children }: { title: string; children?: unknown }) => h('header', null, h('h1', null, title), children as never),
  }
})

const { ProvidersPage } = await import('./ProvidersPage')

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

  it('renders Spend with KPIs, the grid, totals and the hourly bars', async () => {
    await render('/providers?tab=spend')
    expect(q('[data-testid="spend-grid"]')).not.toBeNull()
    expect(q('[data-testid="spend-totals"]')?.textContent).toContain('$11.50')
    expect(q('[data-testid="spend-liability"]')?.textContent).toContain('$123.45')
    expect(container.querySelectorAll('[data-testid="hour-error-tick"]').length).toBe(1)
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
    expect(first.querySelector('.line-through')?.textContent).toBe('gpt-6-luna')
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
      answer({ ok: false, error: { code: 'last_default_route', message: 'x' } })
    })
    await flush()
    expect(q(sel)?.getAttribute('data-enabled')).toBe('true')
    expect(q(`${sel} [data-testid="pending-mark"]`)).toBeNull()
    expect(state.toasts).toEqual([{ tone: 'error', title: 'Enable another default first: an app needs one enabled default route' }])
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
    expect(container.textContent).toContain('Not connected on this install')
    expect(q('[data-testid="providers-rows"]')).toBeNull()
  })
})
