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
vi.mock('../../lib/useSdkUpgrade', () => ({
  useSdkUpgrade: () => ({ state: { status: 'idle' }, createUpgradePr: vi.fn(), refreshUpgradePr: vi.fn(), mergePr: vi.fn(), syncStatus: vi.fn() }),
}))

import { ProjectNextStepsPanel } from './ProjectNextStepsPanel'
import { rankProjectNeeds, stuckAppsSummary } from './projectNextSteps'
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
    // An up-to-date app offers no SDK update; a behind one opens its bump PR from the SDK cell.
    const solo = host.querySelector('[data-testid="project-needs-row-solo"]')!
    const kens = host.querySelector('[data-testid="project-needs-row-kens"]')!
    expect([...solo.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toContain('Open SDK bump PR for solo-boss-cloud')
    expect([...kens.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).not.toContain('Open SDK bump PR for kensaur.us')
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
    expect(labels).toEqual(['Apps', 'Ingesting', 'SDK connected', 'Active keys', 'Reports · 24h'])
  })
})

describe('round 2 (2026-11-18): one link per row, no repeated "Open inbox →", nothing green over stuck reports', () => {
  it('makes the stuck bar the inbox link and drops the repeated "Open inbox" step', () => {
    const host = render([
      project({ id: 'solo', name: 'solo', pdca_bottleneck_label: '129 reports still unfixed', pdca_bottleneck_count: 129 }),
      project({ id: 'glot', name: 'glot', pdca_bottleneck_label: '58 reports still unfixed', pdca_bottleneck_count: 58 }),
    ])
    expect(host.querySelector('[data-testid="project-needs-inbox-solo"]')!.getAttribute('href')).toBe('/inbox?project=solo')
    expect(host.textContent).not.toContain('Open inbox')
    // A stuck count needs you; it is not a failure: amber, never red.
    expect(host.querySelector('[data-testid="project-needs-stuck-solo"] [data-testid="bar-cell-fill"]')!.className).toContain('bg-warn')
    // No app has a step left, so there is no column of dashes.
    expect([...host.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent)).not.toContain('Next step')
  })

  it('keeps the next-step column while some app still has a step, and links an app with no repo to the Update center', () => {
    const host = render([
      project({ id: 'norepo', name: 'norepo', primary_repo: null, sdk_version: '1.35.0', sdk_status: 'outdated' }),
      project({ id: 'ok', name: 'ok' }),
    ])
    expect([...host.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent)).toContain('Next step')
    expect(host.querySelector('[data-testid="project-needs-step-norepo-connect-repo"]')).not.toBeNull()
    const norepo = host.querySelector('[data-testid="project-needs-row-norepo"]')!
    expect([...norepo.querySelectorAll('a')].map((a) => a.textContent)).toContain('Update')
  })

  it('stuckAppsSummary counts the apps with stuck reports and names the worst, from the table rows', () => {
    const rows = rankProjectNeeds([
      project({ id: 'a', name: 'a', pdca_bottleneck_label: 'x', pdca_bottleneck_count: 10 }),
      project({ id: 'b', name: 'b', pdca_bottleneck_label: 'x', pdca_bottleneck_count: 129 }),
      project({ id: 'c', name: 'c' }),
      project({ id: 'd', name: 'd', active_key_count: 0, api_keys: [] }),
    ])
    const s = stuckAppsSummary(rows)
    expect(s.apps).toBe(2)
    expect(s.reports).toBe(139)
    expect(s.worst?.project.id).toBe('b')
    expect(stuckAppsSummary(rankProjectNeeds([project({ id: 'c' })]))).toEqual({ apps: 0, reports: 0, worst: null })
  })
})
