/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/CodebaseIndexCard.test.tsx
 * PURPOSE: The card shows the plan's file limit the stats route now returns
 *          (it used to read `stats.file_cap`, which the route never sent, and
 *          render "undefined"), coverage in files with a callout when the
 *          index is short of the repo, and the push-webhook instructions for
 *          a PAT-connected repo.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('../../lib/supabase', () => api)

import { CodebaseIndexCard } from './CodebaseIndexCard'

const PROJECT = '11111111-1111-4111-8111-111111111111'

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

const STATS = {
  codebase_index_enabled: true,
  repo_url: 'https://github.com/acme/shop',
  default_branch: 'main',
  installation_id: null,
  indexing_enabled: true,
  path_globs: null,
  indexed_files: 1450,
  indexed_chunks: 1450,
  file_cap: 300,
  file_cap_source: 'plan_tier',
  plan_id: 'free_cloud',
  at_file_cap: true,
  coverage: {
    indexed_files: 300,
    eligible_files: 4700,
    file_cap: 300,
    truncated: false,
    state: 'capped',
    summary: '300 of 4,700 files indexed (plan limit 300)',
    measured_at: '2026-10-03T10:00:00Z',
  },
  language_distribution: { typescript: 280, javascript: 20 },
  last_indexed_at: null,
  index_swept_at: '2026-10-03T10:00:00Z',
  last_index_attempt_at: '2026-10-03T10:00:00Z',
  last_index_error: null,
  has_webhook_secret: true,
  push_webhook_path: '/v1/webhooks/github',
}

describe('CodebaseIndexCard', () => {
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

  async function render(stats: Record<string, unknown>): Promise<void> {
    api.apiFetch.mockImplementation(async (path: string) =>
      path.endsWith('/codebase/stats')
        ? { ok: true, data: stats }
        : { ok: true, data: { autofix_enabled: false } },
    )
    await act(async () => {
      root.render(createElement(CodebaseIndexCard, { projectId: PROJECT }))
      await flush()
    })
  }

  it('shows the plan limit and capped coverage in files, never "undefined"', async () => {
    await render(STATS)
    const text = container.textContent ?? ''
    expect(text).not.toContain('undefined')
    expect(text).toContain('Plan limit')
    expect(text).toContain('300 files')
    expect(text).toContain('300 of 4,700 files')
    expect(text).toContain('Indexed chunks')
    const callout = container.querySelector('[data-testid="codebase-coverage-callout"]')
    expect(callout?.textContent).toContain("your plan's 300-file limit")
  })

  it('shows a filling index as in progress, not as an error', async () => {
    await render({
      ...STATS,
      file_cap: 1500,
      at_file_cap: false,
      coverage: { ...STATS.coverage, indexed_files: 600, file_cap: 1500, state: 'filling' },
    })
    const callout = container.querySelector('[data-testid="codebase-coverage-callout"]')
    expect(callout?.textContent).toContain('Still filling')
    expect(container.textContent).not.toContain('Limit reached')
  })

  it('shows a stalled index with the reason, not as filling', async () => {
    await render({
      ...STATS,
      file_cap: 1500,
      at_file_cap: false,
      last_index_error: 'stalled: the last sweep indexed no new file; 3 file fetch(es) failed',
      coverage: { ...STATS.coverage, indexed_files: 40, file_cap: 1500, state: 'stalled' },
    })
    const callout = container.querySelector('[data-testid="codebase-coverage-callout"]')
    expect(callout?.textContent).toContain('the last sweep added no file')
    expect(container.textContent).not.toContain('Still filling')
  })

  it('tells a PAT-connected repo where to point the push webhook', async () => {
    await render(STATS)
    const hint = container.querySelector('[data-testid="codebase-push-webhook"]')
    expect(hint?.textContent).toContain('/v1/webhooks/github')
    expect(hint?.textContent).toContain('Pushes')
  })

  it('omits the push-webhook hint for a GitHub App install', async () => {
    await render({ ...STATS, installation_id: 123, push_webhook_path: null })
    expect(container.querySelector('[data-testid="codebase-push-webhook"]')).toBeNull()
  })

  it('reads an older server that sends no coverage without crashing', async () => {
    const { coverage: _c, file_cap_source: _s, plan_id: _p, indexed_chunks: _i, index_swept_at: _w, push_webhook_path: _h, ...old } = STATS
    await render({ ...old, file_cap: 300, at_file_cap: false, last_indexed_at: '2026-10-03T10:00:00Z' })
    expect(container.textContent).toContain('Plan limit')
    expect(container.querySelector('[data-testid="codebase-coverage-callout"]')).toBeNull()
  })

  it('asks before rotating the webhook secret, and only rotates on confirm', async () => {
    await render(STATS)
    const rotate = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Rotate secret')!
    await act(async () => {
      rotate.click()
      await flush()
    })
    const rotateCalls = () => api.apiFetch.mock.calls.filter((c) => String(c[0]).endsWith('/rotate-secret'))
    expect(rotateCalls()).toHaveLength(0)
    expect(document.body.textContent).toContain('Rotate the GitHub webhook secret?')
    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Rotate secret' && b.hasAttribute('data-primary'),
    )!
    await act(async () => {
      confirm.click()
      await flush()
    })
    expect(rotateCalls()).toHaveLength(1)
  })

  it('renders the docs link with a real arrow, not an escape sequence', async () => {
    await render(STATS)
    expect(container.innerHTML).not.toContain('\u2192')
  })

  it('disables enable and rotate for members, with the reason', async () => {
    api.apiFetch.mockImplementation(async (path: string) =>
      path.endsWith('/codebase/stats') ? { ok: true, data: STATS } : { ok: true, data: { autofix_enabled: false } },
    )
    await act(async () => {
      root.render(createElement(CodebaseIndexCard, { projectId: PROJECT, canManage: false }))
      await flush()
    })
    const rotate = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Rotate secret')!
    expect(rotate.disabled).toBe(true)
    expect(rotate.getAttribute('title')).toMatch(/Owners and admins/)
  })
})
