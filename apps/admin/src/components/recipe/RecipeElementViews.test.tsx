/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/recipe/RecipeElementViews.test.tsx
 * PURPOSE: The per-element views in the recipe side panel (gap #17):
 *   (a) schema shows the tables and what changed since the snapshot before;
 *   (b) CI shows runs with estimated minutes and links only https run URLs;
 *   (c) deploy shows expected vs observed per target, and an unobserved
 *       target never reads as live;
 *   (d) the env matrix says Missing / Not checked / Set per environment, and
 *       a column GitHub did not list is never shown as missing;
 *   (e) the side panel renders the view for those elements and the generic
 *       list for the others.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiView, DeployView, EnvView, RecipeElementSummary, SchemaView } from '../../lib/recipeTypes'

const page = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('../../lib/usePageData', () => ({ usePageData: () => ({ data: page.data, loading: false, error: null, reload: vi.fn() }) }))
vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn(), supabase: { auth: { getSession: vi.fn() } } }))

import { detailWithoutView, pickElementView, RecipeElementView } from './RecipeElementViews'
import { RecipeSidePanel } from './RecipeSidePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const schema: SchemaView = {
  source: 'drift_scanner',
  capturedAt: '2026-10-02T03:05:00Z',
  tables: [{ name: 'profiles', schema: 'public', rls: true, columns: 4 }, { name: 'orders', schema: 'public', rls: false, columns: 2 }],
  totalTables: 2,
  diff: { previousCapturedAt: '2026-10-01T03:05:00Z', added: ['public.orders'], removed: ['public.legacy'], changed: [{ name: 'public.profiles', addedColumns: ['bio'], removedColumns: [], rls: null }] },
}
const ci: CiView = {
  runs: [
    { runId: 2, name: 'CI', event: 'push', branch: 'main', headSha: 'abc1234def', status: 'completed', conclusion: 'success', startedAt: '2026-10-02T09:00:00Z', completedAt: null, estMinutes: 4.5, url: 'https://github.com/k/r/actions/runs/2' },
    { runId: 1, name: 'Deploy', event: 'push', branch: 'main', headSha: null, status: 'completed', conclusion: 'failure', startedAt: null, completedAt: null, estMinutes: null, url: 'javascript:alert(1)' },
  ],
  estMinutesTotal: 4.5,
  estimatedRuns: 1,
  note: 'Minutes are estimated.',
}
const deploy: DeployView = {
  expectedCommit: 'abcdef1234',
  expectedVersion: '1.4.0',
  targets: [
    { id: 'web', kind: 'vercel', environment: 'production', probe: 'version_json', expected: { commit: 'abcdef1234', version: '1.4.0' }, observed: { commit: 'abcdef1', version: '1.4.0', at: '2026-10-02T10:00:00Z', ok: true, error: null, source: 'version_json' }, status: 'live', reason: 'Runs the default-branch head.' },
    { id: 'ios', kind: 'app-store', environment: null, probe: null, expected: { commit: 'abcdef1234', version: '1.4.0' }, observed: null, status: 'unobserved', reason: 'No probe is declared for this target.' },
  ],
  undeclared: ['old-api'],
}
const env: EnvView = {
  columns: [
    { key: 'github-actions', label: 'GitHub Actions (repo)', checked: true },
    { key: 'github-environment:staging', label: 'GitHub env: staging', checked: false },
  ],
  rows: [
    { name: 'API_URL', declared: true, cells: { 'github-actions': 'present', 'github-environment:staging': 'not_checked' } },
    { name: 'SENTRY_DSN', declared: true, cells: { 'github-actions': 'missing', 'github-environment:staging': 'not_required' } },
    { name: 'STRIPE_KEY', declared: false, cells: { 'github-actions': 'extra', 'github-environment:staging': 'not_required' } },
  ],
  truncated: false,
}

describe('recipe element views', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const show = (detail: Record<string, unknown>) => {
    const v = pickElementView(detail)
    if (!v) throw new Error('no view')
    act(() => root.render(createElement(RecipeElementView, { view: v })))
  }

  it('schema: tables, RLS, and the diff since the snapshot before', () => {
    show({ schemaView: schema })
    const text = container.textContent ?? ''
    expect(text).toContain('2 tables')
    expect(text).toMatch(/added\s*public\.orders/)
    expect(text).toMatch(/removed\s*public\.legacy/)
    expect(text).toContain('+bio')
    expect([...container.querySelectorAll('tbody tr')].map((r) => r.textContent)).toEqual(['profileson4', 'ordersoff2'])
  })

  it('CI: runs with estimated minutes, and only an https URL becomes a link', () => {
    show({ ciView: ci })
    expect(container.textContent).toContain('About 4.5 billable minutes across 1 estimated run')
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual(['https://github.com/k/r/actions/runs/2'])
    expect(container.textContent).toContain('failure')
  })

  it('deploy: expected vs observed per target, and an unobserved target is never live', () => {
    show({ deployView: deploy })
    const items = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '')
    expect(items[0]).toMatch(/web.*Live/)
    expect(items[1]).toMatch(/ios.*Not observed/)
    expect(items[1]).not.toContain('Live')
    expect(container.textContent).toContain('old-api')
  })

  it('env: the matrix says Set, Missing, Not checked and Set-not-declared, and explains the unchecked column', () => {
    show({ envView: env })
    const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent)
    expect(rows).toEqual(['API_URLSetNot checked', 'SENTRY_DSNMissing—', 'STRIPE_KEYnot declaredSet, not declared—'])
    expect(container.textContent).toMatch(/GitHub env: staging: GitHub did not list these names/)
  })

  it('pickElementView ignores details without a view, and detailWithoutView drops only the view key', () => {
    expect(pickElementView({ configured: [] })).toBeNull()
    expect(pickElementView(null)).toBeNull()
    expect(detailWithoutView({ ciView: ci, branch: 'main' })).toEqual({ branch: 'main' })
  })

  it('the side panel shows the view for env and the generic list for integrations', () => {
    const el = (key: RecipeElementSummary['key']): RecipeElementSummary => ({ key, label: key, lane: 'build', state: 'ok', reason: 'r', lastCheckedAt: null, facts: {}, findingsCount: 0, links: [] })
    page.data = { element: el('env'), detail: { envView: env, required: ['API_URL'] } }
    act(() => root.render(createElement(MemoryRouter, null, createElement(RecipeSidePanel, { projectId: 'p', element: el('env'), onClose: () => {} }))))
    expect(container.querySelector('table[aria-label="Environment by variable"]')).not.toBeNull()
    expect(container.textContent).toContain('More detail')

    page.data = { element: el('integrations'), detail: { configured: [{ kind: 'sentry', health: 'ok' }] } }
    act(() => root.render(createElement(MemoryRouter, null, createElement(RecipeSidePanel, { projectId: 'p', element: el('integrations'), onClose: () => {} }))))
    expect(container.querySelector('table[aria-label="Environment by variable"]')).toBeNull()
    expect(container.textContent).toContain('sentry')
  })
})
