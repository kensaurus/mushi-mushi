/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/settings/KnownIssuesSearchCard.test.tsx
 * PURPOSE: The known-fix web search sends a scrubbed error message to
 *          Firecrawl, so it is off by default, says what is sent, writes only
 *          `known_issues_search_enabled` when toggled, and is disabled (not a
 *          dead switch) when the server does not know the setting yet. The
 *          report page says the search is off and links here.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../lib/supabase', () => api)
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

import { KnownIssuesSearchCard } from './KnownIssuesSearchCard'
import { KnownIssuesSection } from '../report-detail/KnownIssuesSection'
import { KNOWN_ISSUES_SEARCH_HREF } from '../../lib/settingsTabs'

const PROJECT = '11111111-1111-4111-8111-111111111111'

type ApiReply = { ok: boolean; data?: unknown; error?: { message: string } }

function serve(settings: ApiReply, patch?: ApiReply) {
  api.apiFetch.mockImplementation(async (_path: string, init?: { method?: string }) => {
    if (init?.method === 'PATCH') return patch ?? { ok: true, data: {} }
    return settings
  })
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  api.apiFetch.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('KnownIssuesSearchCard', () => {
  async function render(): Promise<HTMLButtonElement> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(KnownIssuesSearchCard, { projectId: PROJECT })))
      await flush()
    })
    return container.querySelector<HTMLButtonElement>('button[role="switch"]')!
  }

  it('says what is sent and to whom', async () => {
    serve({ ok: true, data: { known_issues_search_enabled: false } })
    await render()
    const text = container.textContent ?? ''
    expect(text).toContain('Off by default')
    expect(text).toContain('error message')
    expect(text).toContain('IDs, URLs and long numbers removed')
    expect(text).toContain('Firecrawl')
    expect(text).toContain('GitHub and Stack Overflow')
  })

  it('shows the saved OFF state and turns it on with a one-field PATCH', async () => {
    serve({ ok: true, data: { known_issues_search_enabled: false } })
    const toggle = await render()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.disabled).toBe(false)

    await act(async () => {
      toggle.click()
      await flush()
    })
    expect(api.apiFetch).toHaveBeenLastCalledWith('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ known_issues_search_enabled: true }),
    })
    expect(container.querySelector('button[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
    expect(toast.success).toHaveBeenCalledWith('Known-fix search is on')
  })

  it('keeps the old state and reports the error when the save is refused', async () => {
    serve({ ok: true, data: { known_issues_search_enabled: true } }, { ok: false, error: { message: 'Project admins only' } })
    const toggle = await render()
    await act(async () => {
      toggle.click()
      await flush()
    })
    expect(container.querySelector('button[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
    expect(toast.error).toHaveBeenCalledWith('Could not change the known-fix search', 'Project admins only')
  })

  it('is disabled with an explanation when the server has no such setting yet', async () => {
    serve({ ok: true, data: { stage2_model: 'claude-sonnet-5-5' } })
    const toggle = await render()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.disabled).toBe(true)
    expect(container.textContent).toContain('after the next server update')
  })
})

describe('KnownIssuesSection when the search is off', () => {
  function renderSection(props: Parameters<typeof KnownIssuesSection>[0]) {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(KnownIssuesSection, props)))
    })
  }

  it('says the search is off and links to the setting', () => {
    renderSection({ issues: [], searchEnabled: false })
    expect(container.textContent).toContain('Web search for known fixes is off')
    expect(container.querySelector(`a[href="${KNOWN_ISSUES_SEARCH_HREF}"]`)).not.toBeNull()
  })

  it('says nothing when the state is unknown or the search is on', () => {
    renderSection({ issues: [], searchEnabled: null })
    expect(container.textContent).toBe('')
    renderSection({ issues: [], searchEnabled: true })
    expect(container.textContent).toBe('')
  })

  it('still lists snippets attached by hand while the search is off', () => {
    renderSection({
      issues: [
        {
          id: 'sn-1',
          url: 'https://github.com/supabase/realtime-js/issues/1',
          title: 'cannot add callbacks',
          snippet: null,
          attached_by: 'u1',
          attached_at: null,
        },
      ],
      searchEnabled: false,
    })
    expect(container.textContent).toContain('cannot add callbacks')
    expect(container.textContent).not.toContain('is off')
  })
})
