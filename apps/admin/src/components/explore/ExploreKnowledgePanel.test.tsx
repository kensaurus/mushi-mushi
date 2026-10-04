/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/explore/ExploreKnowledgePanel.test.tsx
 * PURPOSE: Knowledge sources show their real state: a failure carries its
 *          reason and a Retry, a row stuck at pending (from before the
 *          ingest worker existed, or a worker that died) can be retried, and
 *          a failed add shows plain English instead of a raw code.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch }))

import { ExploreKnowledgePanel } from './ExploreKnowledgePanel'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString()

function mockSources(sources: unknown[]) {
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.endsWith('/wiki/sources') && !init?.method) return Promise.resolve({ ok: true, data: { sources } })
    if (path.endsWith('/knowledge/graph')) return Promise.resolve({ ok: true, data: { graphs: [] } })
    if (path.endsWith('/retry')) return Promise.resolve({ ok: true, data: {} })
    if (path.endsWith('/wiki/sources') && init?.method === 'POST') {
      return Promise.resolve({ ok: false, error: { code: 'DB_ERROR', message: 'duplicate key value violates unique constraint' } })
    }
    return Promise.resolve({ ok: true, data: {} })
  })
}

function render() {
  act(() => root.render(createElement(MemoryRouter, null, createElement(ExploreKnowledgePanel, { projectId: 'p1' }))))
}

describe('ExploreKnowledgePanel', () => {
  it('shows why a source failed and offers Retry', async () => {
    mockSources([
      { id: 's1', kind: 'repo_subpath', root_path: 'docs/', label: null, status: 'failed', error: 'No GitHub repo is connected.', updated_at: OLD },
    ])
    render()
    await flush()
    expect(container.textContent).toContain('No GitHub repo is connected.')
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!
    await act(async () => retry.click())
    await flush()
    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/projects/p1/codebase/wiki/sources/s1/retry', { method: 'POST' })
  })

  it('lets a source stuck at pending be retried', async () => {
    mockSources([{ id: 's2', kind: 'repo_subpath', root_path: 'docs/', label: null, status: 'pending', updated_at: OLD }])
    render()
    await flush()
    expect(container.textContent).toContain('Stuck')
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Retry')).toBe(true)
  })

  it('never shows database text when adding fails', async () => {
    mockSources([])
    render()
    await flush()
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Add source')!
    await act(async () => add.click())
    await flush()
    expect(container.textContent).not.toContain('duplicate key')
    expect(container.textContent).toContain('Something went wrong on our side')
  })
})
