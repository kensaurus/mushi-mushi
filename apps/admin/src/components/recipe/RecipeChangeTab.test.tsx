/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/recipe/RecipeChangeTab.test.tsx
 * PURPOSE: The side panel's Change tab:
 *   (a) it exists for gates, env and routes only;
 *   (b) a file the allowlist does not cover is read-only, with the server's
 *       reason, and Preview stays disabled (no dead button);
 *   (c) editing a budget and pressing Preview sends a dry run with the base
 *       SHA, and the diff and "Open draft PR" appear;
 *   (d) the env form has no value input;
 *   (e) the routes form edits the inventory path the server returned
 *       (routes.inventory), and an inventory the server refuses blocks the PR.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecipeElementSummary, RecipeSources } from '../../lib/recipeTypes'

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchMutate: vi.fn(),
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}))
vi.mock('../../lib/supabase', () => api)
const page = vi.hoisted(() => ({ data: null as unknown, byPath: new Map<string, unknown>() }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string) => ({ data: page.byPath.get(path.split('?')[1] ?? path) ?? page.data, loading: false, error: null, reload: vi.fn() }),
}))

import { RecipeSidePanel } from './RecipeSidePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const P = '1000000a-0000-4000-8000-000000000000'
const MANIFEST = `${JSON.stringify({ version: 1, gates: { budgets: { 'bundle.web.gzip_kb': 300 } }, env: { required: [{ name: 'API_URL' }] } }, null, 2)}\n`

function element(key: RecipeElementSummary['key']): RecipeElementSummary {
  return { key, label: key, lane: 'build', state: 'ok', reason: `${key} reason`, lastCheckedAt: null, facts: {}, findingsCount: 0, links: [] }
}

function sources(element: 'gates' | 'env' | 'routes', writable: boolean): RecipeSources {
  return {
    ok: true,
    element,
    branch: 'main',
    headSha: 'abcdef1234',
    files: [
      { path: 'mushi.recipe.json', exists: true, content: MANIFEST, sha: 'sha-m', writable, reason: writable ? null : 'not matched by change.allowPaths in mushi.recipe.json' },
      ...(element === 'env' ? [{ path: '.env.example', exists: false, content: null, sha: null, writable: true, reason: null }] : []),
    ],
  }
}

describe('RecipeSidePanel Change tab', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetchMutate.mockReset()
    page.byPath.clear()
    page.data = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(key: RecipeElementSummary['key']) {
    act(() => root.render(createElement(MemoryRouter, null, createElement(RecipeSidePanel, { projectId: P, element: element(key), onClose: () => {} }))))
  }
  const buttons = () => [...container.querySelectorAll('button')]
  const byText = (t: string) => buttons().find((b) => b.textContent?.trim() === t)
  function openChange() {
    act(() => byText('Change')!.click())
  }
  function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('shows a Change tab for gates, env and routes only', () => {
    for (const key of ['gates', 'env', 'routes'] as const) {
      render(key)
      expect(byText('Change')).toBeDefined()
    }
    for (const key of ['schema', 'design', 'ci', 'deploy', 'integrations'] as const) {
      render(key)
      expect(byText('Change')).toBeUndefined()
    }
  })

  it('keeps a file outside change.allowPaths read-only, with the reason, and Preview disabled', () => {
    page.byPath.set('element=gates', sources('gates', false))
    render('gates')
    openChange()
    expect(container.textContent).toContain('Read-only: not matched by change.allowPaths')
    expect(byText('Preview diff')!.disabled).toBe(true)
    expect((container.querySelector('input[aria-label="Budget 1 limit"]') as HTMLInputElement).disabled || container.querySelector('fieldset[disabled]')).toBeTruthy()
  })

  it('previews a budget change as a dry run carrying the base SHA, then offers the draft PR', async () => {
    page.byPath.set('element=gates', sources('gates', true))
    api.apiFetchMutate.mockResolvedValueOnce({
      ok: true,
      data: { dryRun: true, ok: true, reason: null, files: [{ path: 'mushi.recipe.json', diff: '--- a\n+++ b\n@@ -1 +1 @@\n-300\n+250', additions: 1, deletions: 1 }], denied: [] },
    })
    render('gates')
    openChange()
    expect(byText('Preview diff')!.disabled).toBe(true) // nothing changed yet
    type(container.querySelector('input[aria-label="Budget 1 limit"]') as HTMLInputElement, '250')
    expect(byText('Preview diff')!.disabled).toBe(false)
    await act(async () => { byText('Preview diff')!.click() })
    const body = JSON.parse(api.apiFetchMutate.mock.calls[0][1].body)
    expect(body).toMatchObject({ element: 'gates', dryRun: true, edits: [{ path: 'mushi.recipe.json', baseSha: 'sha-m' }] })
    expect(body.edits[0].content).toContain('"bundle.web.gzip_kb": 250')
    expect(container.textContent).toContain('+250')
    expect(byText('Open draft PR')!.disabled).toBe(false)
  })

  it('the env form asks for names only', () => {
    page.byPath.set('element=env', sources('env', true))
    render('env')
    openChange()
    const labels = [...container.querySelectorAll('input')].map((i) => `${i.getAttribute('aria-label') ?? ''} ${i.getAttribute('placeholder') ?? ''}`)
    expect(labels.some((l) => /value|secret/i.test(l))).toBe(false)
    expect((container.querySelector('input[aria-label="Env name 1"]') as HTMLInputElement).value).toBe('API_URL')
  })

  it('the routes form edits the inventory path the server named, and a refused inventory blocks the draft PR', async () => {
    const INV = 'schema_version: "2.0"\n'
    page.byPath.set('element=routes', {
      ok: true,
      element: 'routes',
      branch: 'main',
      headSha: 'abcdef1234',
      files: [{ path: 'apps/web/inventory.yaml', exists: true, content: INV, sha: 'sha-inv', writable: true, reason: null }],
    } satisfies RecipeSources)
    api.apiFetchMutate.mockResolvedValueOnce({
      ok: true,
      data: { dryRun: true, ok: true, reason: null, files: [], denied: [{ path: 'apps/web/inventory.yaml', reason: 'the new inventory would fail inventory ingest: app: Required' }] },
    })
    render('routes')
    openChange()
    const area = container.querySelector('textarea') as HTMLTextAreaElement
    expect(area.getAttribute('aria-label')).toBe('apps/web/inventory.yaml')
    expect(container.textContent).toContain('routes.inventory')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(area, `${INV}pages: []\n`)
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { byText('Preview diff')!.click() })
    const body = JSON.parse(api.apiFetchMutate.mock.calls[0][1].body)
    expect(body).toMatchObject({ element: 'routes', dryRun: true, edits: [{ path: 'apps/web/inventory.yaml', baseSha: 'sha-inv' }] })
    expect(container.textContent).toContain('would fail inventory ingest')
    expect(byText('Open draft PR')?.disabled ?? true).toBe(true)
  })
})
