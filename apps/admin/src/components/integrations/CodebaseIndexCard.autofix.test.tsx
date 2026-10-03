/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/CodebaseIndexCard.autofix.test.tsx
 * PURPOSE: The autofix switch follows GET /autofix `can_toggle`. The API lets
 *          only a project owner or admin flip autofix, so a member sees the
 *          switch disabled with the reason, instead of a live switch that
 *          answers with a 403.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('../../lib/supabase', () => api)

import { CodebaseIndexCard } from './CodebaseIndexCard'

const PROJECT = '11111111-1111-4111-8111-111111111111'

const STATS = {
  codebase_index_enabled: true,
  repo_url: 'https://github.com/acme/app',
  default_branch: 'main',
  installation_id: null,
  indexing_enabled: true,
  path_globs: null,
  indexed_files: 120,
  file_cap: 300,
  at_file_cap: false,
  language_distribution: { ts: 120 },
  last_indexed_at: '2026-10-01T00:00:00Z',
  last_index_attempt_at: '2026-10-01T00:00:00Z',
  last_index_error: null,
  has_webhook_secret: true,
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function autofixSwitch(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('button[aria-label="Toggle autofix dispatcher"]')
  if (!el) throw new Error('autofix switch not rendered')
  return el
}

describe('CodebaseIndexCard autofix switch', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function serve(autofix: { autofix_enabled: boolean; can_toggle: boolean }): void {
    api.apiFetch.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      if (path.endsWith('/codebase/stats')) return { ok: true, data: STATS }
      if (path.endsWith('/autofix/toggle')) {
        const enabled = (JSON.parse(init?.body ?? '{}') as { enabled: boolean }).enabled
        return { ok: true, data: { autofix_enabled: enabled } }
      }
      if (path.endsWith('/autofix')) return { ok: true, data: autofix }
      return { ok: false, error: { code: 'NOT_FOUND', message: path } }
    })
  }

  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(CodebaseIndexCard, { projectId: PROJECT }))
      await flush()
    })
  }

  it('disables the switch for a member and says who can change it', async () => {
    serve({ autofix_enabled: true, can_toggle: false })
    await render()
    expect(autofixSwitch(container).disabled).toBe(true)
    expect(container.textContent).toContain('Only a project owner or admin can turn autofix on or off.')
  })

  it('lets an owner or admin flip it, posting the new value', async () => {
    serve({ autofix_enabled: false, can_toggle: true })
    await render()
    const sw = autofixSwitch(container)
    expect(sw.disabled).toBe(false)
    expect(container.textContent).not.toContain('Only a project owner or admin')
    await act(async () => {
      sw.click()
      await flush()
    })
    expect(api.apiFetch).toHaveBeenCalledWith(
      `/v1/admin/projects/${PROJECT}/autofix/toggle`,
      { method: 'POST', body: JSON.stringify({ enabled: true }) },
    )
    expect(autofixSwitch(container).getAttribute('aria-checked')).toBe('true')
  })
})
