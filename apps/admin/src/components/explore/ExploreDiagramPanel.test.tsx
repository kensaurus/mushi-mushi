/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/explore/ExploreDiagramPanel.test.tsx
 * PURPOSE: Map → Diagram shows which parts carry open bugs and code
 *          findings, and clicking a part lists them (reports link to their
 *          detail page, findings to the file at the diagram's commit). The
 *          overlay is optional: if it fails the diagram still renders.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch, apiFetchMutate, toast } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchMutate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), push: vi.fn(), warn: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ apiFetch, apiFetchMutate }))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))
// React Flow needs layout APIs jsdom lacks; a stub keeps the click contract.
vi.mock('./ExploreDiagramCanvas', () => ({
  ExploreDiagramCanvas: (props: {
    graph: { nodes: Array<{ id: string; label: string }> }
    onSelect: (id: string) => void
    overlay: { nodes: Record<string, { report_count: number }> } | null
  }) =>
    createElement(
      'div',
      null,
      props.graph.nodes.map((n) =>
        createElement(
          'button',
          { key: n.id, type: 'button', onClick: () => props.onSelect(n.id) },
          `${n.label} (${props.overlay?.nodes[n.id]?.report_count ?? 0})`,
        ),
      ),
    ),
}))

import { ExploreDiagramPanel } from './ExploreDiagramPanel'

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

const SHA = 'c'.repeat(40)
const diagramResponse = {
  ok: true,
  data: {
    diagram: {
      id: 'd1',
      commit_sha: SHA,
      repo_owner: 'acme',
      repo_name: 'shop',
      model: 'm',
      updated_at: '2026-10-02T00:00:00Z',
      stats: {},
      graph: {
        groups: [{ id: 'g', label: 'App', x: 0, y: 0, w: 252, h: 200 }],
        nodes: [
          { id: 'auth', label: 'Auth', group: 'g', path: 'apps/web/src/auth', description: 'Sign-in', x: 16, y: 52 },
          { id: 'api', label: 'API', group: 'g', path: 'apps/api', description: '', x: 16, y: 136 },
        ],
        edges: [],
      },
    },
    publication: { published: false },
  },
}

const overlayResponse = {
  ok: true,
  data: {
    diagram_id: 'd1',
    nodes: {
      auth: {
        report_count: 1,
        finding_count: 1,
        reports: [{ id: 'r-123456789', summary: 'Login button does nothing', severity: 'high', status: 'new' }],
        findings: [{ id: 'f1', rule_id: 'dead-handler', severity: 'high', message: 'onClick never fires', file_path: 'apps/web/src/auth/Login.tsx', line: 12 }],
      },
    },
    unplaced: { reports: 2, findings: 0 },
    frames_matched: true,
    considered: { reports: 3, findings: 1, findings_days: 30 },
  },
}

function render() {
  act(() => root.render(createElement(MemoryRouter, null, createElement(ExploreDiagramPanel, { projectId: 'p1' }))))
}

describe('ExploreDiagramPanel overlay', () => {
  it('shows counts per part and lists a part’s bugs and findings when clicked', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/overlay') ? overlayResponse : diagramResponse),
    )
    render()
    await flush()

    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/projects/p1/codebase/diagram/overlay', { cache: 'no-store' })
    expect(container.textContent).toContain('Auth (1)')
    expect(container.querySelector('[data-testid="explore-diagram-overlay-summary"]')?.textContent).toContain(
      '2 reports and 0 findings are in files no part covers.',
    )

    const authButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Auth (1)')!
    await act(async () => authButton.click())

    const reports = container.querySelector('[data-testid="explore-diagram-selected-reports"]')!
    expect(reports.textContent).toContain('Open bug reports (1)')
    expect(reports.querySelector('a')?.getAttribute('href')).toBe('/reports/r-123456789')

    const findings = container.querySelector('[data-testid="explore-diagram-selected-findings"]')!
    expect(findings.textContent).toContain('dead-handler')
    expect(findings.querySelector('a')?.getAttribute('href')).toBe(
      `https://github.com/acme/shop/tree/${SHA}/apps/web/src/auth/Login.tsx#L12`,
    )
  })

  it('still shows the diagram when the overlay fails', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/overlay') ? { ok: false, error: { code: 'X', message: 'Overlay down' } } : diagramResponse),
    )
    render()
    await flush()
    expect(container.textContent).toContain('Auth (0)')
    expect(container.textContent).toContain('Overlay down')
  })
})
