/**
 * @vitest-environment jsdom
 */

/**
 * Connected sources (console repair group H):
 *   QA 44   Remove deleted the connector and its Vault credential on one click.
 *   QA 177  members saw Check / Remove / Connect, which always answer 403.
 *   QA 178  a load error showed "message (CODE)".
 *   2026-11-18 a source row was a long "app → id · app → id" string and two big dropdowns:
 *           now the bound apps are icons and Check / Bind / actions / Remove sit in one More menu.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = '0000000b-0000-4000-8000-000000000000'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  role: { value: 'owner' },
  error: { value: null as string | null },
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch, apiFetchMutate: mocks.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    if (path === '/v1/org') {
      // 'unknown-org': the caller's team list does not include this org, so the role is unknown.
      const orgs = mocks.role.value === 'unknown-org' ? [] : [{ id: ORG, slug: 'a', name: 'A', plan_id: 'free', role: mocks.role.value }]
      return { data: { organizations: orgs }, loading: false, error: null, reload: vi.fn() }
    }
    if (path?.endsWith('/connectors')) {
      return mocks.error.value
        ? { data: null, loading: false, error: mocks.error.value, reload: vi.fn() }
        : {
            data: {
              instances: [
                { id: 'c1', kind: 'llm_usage', display_name: 'OpenAI usage', status: 'ok', status_reason: null, bindings: [], enabled_capabilities: ['read'] },
                { id: 'c2', kind: 'play_console', display_name: 'Google Play', status: 'connected', status_reason: null, bindings: [{ projectId: 'p-glot', externalId: 'com.glotit.app', role: 'primary' }, { projectId: 'p-lt', externalId: 'us.kensaur.talk', role: 'primary' }], enabled_capabilities: ['read'] },
              ],
              available: [
                { kind: 'llm_usage', title: 'AI provider usage', credentialNote: '', actions: [], legacyBacked: false },
                { kind: 'play_console', title: 'Google Play', credentialNote: '', actions: ['rollout'], legacyBacked: false },
              ],
              planned: [],
            },
            loading: false,
            error: null,
            reload: vi.fn(),
          }
    }
    return { data: { actions: [] }, loading: false, error: null, reload: vi.fn() }
  },
}))

import { ConnectorsCard } from './ConnectorsCard'

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
}

function deletes(): unknown[][] {
  return mocks.apiFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
}

describe('ConnectorsCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mocks.role.value = 'owner'
    mocks.error.value = null
  })

  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ConnectorsCard, { orgId: ORG, projects: [{ projectId: 'p-glot', name: 'glot.it' }, { projectId: 'p-lt', name: 'lets-talk' }, { projectId: 'p-yen', name: 'yen-yen' }] })))
      await flush()
    })
  }

  async function openMore(id: string): Promise<void> {
    await act(async () => {
      ;(container.querySelector(`[data-testid="connector-more-${id}"]`) as HTMLButtonElement).click()
      await flush()
    })
  }

  it('asks before removing a source and its credential', async () => {
    await render()
    await openMore('c1')
    await act(async () => {
      button('Remove')!.click()
      await flush()
    })
    expect(deletes()).toHaveLength(0)
    expect(document.body.textContent).toContain('deletes its stored credential')
    await act(async () => {
      button('Remove source')!.click()
      await flush()
    })
    expect(deletes()).toEqual([[`/v1/admin/orgs/${ORG}/connectors/c1`, { method: 'DELETE' }]])
  })

  it('shows a member the sources without write controls', async () => {
    mocks.role.value = 'member'
    await render()
    expect(container.textContent).toContain('OpenAI usage')
    expect(container.querySelector('[data-testid^="connector-more-"]')).toBeNull()
    expect(button('Remove')).toBeUndefined()
    expect(button('Check')).toBeUndefined()
    expect(container.textContent).not.toContain('Add a source')
    expect(container.textContent).toContain('Only team owners and admins can change this.')
  })

  it('keeps the controls when the role is not known yet; the server still enforces it', async () => {
    mocks.role.value = 'unknown-org'
    await render()
    expect(container.querySelector('[data-testid="connector-more-c1"]')).not.toBeNull()
    await openMore('c1')
    expect(button('Remove')).toBeDefined()
    expect(container.textContent).not.toContain('Only team owners and admins can change this.')
  })

  it('shows the bound apps as icons, each id in its tooltip, and one More menu instead of buttons and dropdowns', async () => {
    await render()
    const row = container.querySelector('[data-testid="connector-c2"]')!
    // The ids are only tooltips and screen-reader text now, never a printed string.
    const seen = row.cloneNode(true) as HTMLElement
    seen.querySelectorAll('.sr-only').forEach((n) => n.remove())
    expect(seen.textContent).not.toContain('→')
    const chips = row.querySelector('[data-testid="connector-bindings"] [data-testid="app-icon-chips"]')!
    expect(chips.getAttribute('data-count')).toBe('2')
    expect([...chips.querySelectorAll('li[data-app]')].map((li) => li.getAttribute('title'))).toEqual(['glot.it → com.glotit.app', 'lets-talk → us.kensaur.talk'])
    expect(row.querySelector('[data-testid="connector-bindings"] [data-testid="status-mark"]')!.getAttribute('aria-label')).toBe('2 apps bound')
    // No loose buttons or dropdowns on the row: Check, Bind, the write actions and Remove are in More.
    expect([...row.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['More'])
    expect(row.querySelector('select')).toBeNull()
    await openMore('c2')
    expect([...row.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Check', 'Bind another app…', 'Release actions (off)…', 'Remove'])
  })

  it('opens the bind form inline when "Bind another app…" is chosen, listing only unbound apps', async () => {
    await render()
    await openMore('c2')
    await act(async () => {
      button('Bind another app…')!.click()
      await flush()
    })
    const form = container.querySelector('[data-testid="connector-bind-c2"]')!
    expect([...form.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Choose…', 'yen-yen'])
    await act(async () => {
      button('Close')!.click()
      await flush()
    })
    expect(container.querySelector('[data-testid="connector-bind-c2"]')).toBeNull()
  })

  it('checks a source again from the More menu', async () => {
    await render()
    await openMore('c1')
    await act(async () => {
      button('Check')!.click()
      await flush()
    })
    expect(mocks.apiFetch).toHaveBeenCalledWith(`/v1/admin/orgs/${ORG}/connectors/c1/probe`, { method: 'POST', body: '{}' })
  })

  it('explains a load error without the raw code', async () => {
    mocks.error.value = 'Could not check your membership of this organization. (DB_ERROR)'
    await render()
    expect(container.textContent).toContain("Couldn't load connected sources")
    expect(container.textContent).not.toContain('(DB_ERROR)')
  })
})
