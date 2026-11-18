/**
 * @vitest-environment jsdom
 *
 * "What needs you, per project" is one table, worst first (fresh-eyes review 2026-11-18: it
 * was one card per app repeating the same two sentences), and the snapshot is flat figures
 * with no "Viewing" tile.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Project } from './project-models'

vi.mock('../ProjectFavicon', () => ({ ProjectFavicon: () => null }))

import { ProjectNextStepsPanel } from './ProjectNextStepsPanel'
import { projectsSnapshotFigures } from './ProjectsSnapshotStrip'
import { EMPTY_PROJECTS_STATS } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'app',
    slug: 'app',
    created_at: '2026-01-01T00:00:00Z',
    organization_id: null,
    organization_role: null,
    api_keys: [{ id: 'k1', key_prefix: 'mushi_abc', created_at: '2026-01-01T00:00:00Z', is_active: true, revoked: false, last_seen_at: '2026-07-01T00:00:00Z' }],
    active_key_count: 1,
    member_count: 1,
    members: [],
    report_count: 5,
    last_report_at: '2026-07-01T00:00:00Z',
    pdca_bottleneck: null,
    pdca_bottleneck_label: null,
    primary_repo: { repo_url: 'https://github.com/x/y' } as Project['primary_repo'],
    sdk_version: '1.37.0',
    sdk_latest_version: '1.37.0',
    sdk_status: 'up-to-date',
    ...overrides,
  }
}

function render(projects: Project[]): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(createElement(MemoryRouter, null, createElement(ProjectNextStepsPanel, { projects }))))
  return host
}

describe('ProjectNextStepsPanel', () => {
  it('lists one row per app, most stuck first, with the stuck count and SDK drift', () => {
    const host = render([
      project({ id: 'lets', name: 'lets-talk', sdk_version: '1.35.0', sdk_status: 'outdated', pdca_bottleneck_label: '9 reports still unfixed', pdca_bottleneck_count: 9 }),
      project({ id: 'kens', name: 'kensaur.us' }),
      project({ id: 'solo', name: 'solo-boss-cloud', sdk_version: '1.33.3', sdk_status: 'outdated', pdca_bottleneck_label: '129 reports still unfixed', pdca_bottleneck_count: 129 }),
    ])
    const rows = [...host.querySelectorAll('[data-testid^="project-needs-row-"]')].map((r) => r.getAttribute('data-testid'))
    expect(rows).toEqual(['project-needs-row-solo', 'project-needs-row-lets', 'project-needs-row-kens'])
    expect(host.querySelector('[data-testid="project-needs-stuck-solo"]')!.textContent).toContain('129')
    expect(host.querySelector('[data-testid="project-needs-sdk-solo"]')!.textContent).toBe('1.33.3 → 1.37.0')
    // An up-to-date app offers no SDK update; a behind one links to it.
    const solo = host.querySelector('[data-testid="project-needs-row-solo"]')!
    const kens = host.querySelector('[data-testid="project-needs-row-kens"]')!
    expect([...solo.querySelectorAll('a')].map((a) => a.textContent)).toContain('Update')
    expect([...kens.querySelectorAll('a')].map((a) => a.textContent)).not.toContain('Update')
    // The repeated sentences are gone.
    expect(host.textContent).not.toContain('things below would make it healthier')
    expect(host.textContent).not.toContain('One click opens a version-bump PR')
  })

  it('hatches the stuck count of an app that is not connected instead of printing 0', () => {
    const host = render([project({ id: 'new', active_key_count: 0, api_keys: [] })])
    const cell = host.querySelector('[data-testid="project-needs-stuck-new"]')!
    expect(cell.querySelector('.ci-nodata')).not.toBeNull()
    expect(cell.textContent).not.toContain('0')
  })
})

describe('projectsSnapshotFigures', () => {
  it('holds only numbers: no "Viewing" tile', () => {
    const labels = projectsSnapshotFigures(EMPTY_PROJECTS_STATS).map((f) => f.label)
    expect(labels).toEqual(['Projects', 'Ingesting', 'SDK connected', 'Active keys', 'Reports · 24h'])
  })
})
