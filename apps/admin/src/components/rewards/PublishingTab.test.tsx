/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/rewards/PublishingTab.test.tsx
 * PURPOSE: Group K entry 10 — typing into the Bounties listing, targeting and
 *          budget inputs must stick. Every onChange used to clear a "ready"
 *          flag that re-copied the server values on the next render.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  apiFetch: vi.fn(),
}))

vi.mock('../../lib/usePageData', () => ({
  // Stable objects per path, like usePageData between reloads.
  usePageData: (path: string | null) => {
    const key = path?.split('/').pop() ?? ''
    return {
      data: path ? (server.data[key] ?? null) : null,
      loading: false,
      error: null,
      reload: vi.fn(),
    }
  },
}))
vi.mock('../../lib/supabase', () => ({ apiFetch: server.apiFetch }))
vi.mock('../../lib/activeProject', () => ({ getActiveProjectIdSnapshot: () => 'proj-1' }))
vi.mock('../../lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

import { PublishingTab } from './PublishingTab'

let container: HTMLDivElement
let root: Root

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
  if (!el) throw new Error(`no input with placeholder ${placeholder}`)
  return el
}

/** Type into a React-controlled input the way a browser does. */
async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  server.data = {
    'proj-1': {
      id: 'app-1',
      project_id: 'proj-1',
      slug: 'demo',
      name: 'Saved name',
      tagline: null,
      description: null,
      visibility: 'draft',
      platforms: ['web'],
      sentry_dsn: null,
      published_at: null,
      created_at: '2026-10-01T00:00:00Z',
    },
    bounties: [],
    stats: {
      submissions_30d: 0,
      accepted_30d: 0,
      active_testers: 0,
      points_spent_30d: 0,
      monthly_budget_usd: 0,
      monthly_budget_used_pct: 0,
    },
    targeting: { country_codes: ['US'], languages: [], expertise_tags: [], reputation_min: 0, min_age: null },
    'marketplace-settings': { marketplace_monthly_budget_usd: 50, marketplace_max_testers: 10 },
  }
  server.apiFetch.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(PublishingTab)))
  })
}

describe('PublishingTab form inputs', () => {
  it('fills every form from the server snapshot', async () => {
    await render()
    expect(inputByPlaceholder('e.g. Mushi Mushi').value).toBe('Saved name')
    expect(inputByPlaceholder('US, CA, GB — empty = all countries').value).toBe('US')
    expect(inputByPlaceholder('0 = no cap').value).toBe('50')
  })

  it('keeps what the user types in the listing, targeting and budget inputs', async () => {
    await render()
    const name = inputByPlaceholder('e.g. Mushi Mushi')
    const countries = inputByPlaceholder('US, CA, GB — empty = all countries')
    const budget = inputByPlaceholder('0 = no cap')

    await typeInto(name, 'New name')
    await typeInto(countries, 'US, GB')
    await typeInto(budget, '75')
    // A later render (e.g. a parent re-render) must not snap them back.
    await render()

    expect(name.value).toBe('New name')
    expect(countries.value).toBe('US, GB')
    expect(budget.value).toBe('75')
  })

  it('saves the edited listing, not the stale server value', async () => {
    server.apiFetch.mockResolvedValue({ ok: true, data: {} })
    await render()
    await typeInto(inputByPlaceholder('e.g. Mushi Mushi'), 'Edited')
    const save = Array.from(container.querySelectorAll('button')).find((b) => /save listing|save draft/i.test(b.textContent ?? ''))
    expect(save).toBeTruthy()
    await act(async () => {
      save!.click()
    })
    const put = server.apiFetch.mock.calls.find(([path, opts]) => path === '/v1/admin/published-apps/proj-1' && opts?.method === 'PUT')
    expect(put).toBeTruthy()
    expect(JSON.parse(put![1].body as string).name).toBe('Edited')
  })
})
