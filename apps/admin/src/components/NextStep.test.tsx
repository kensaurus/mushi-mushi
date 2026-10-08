/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/NextStep.test.tsx
 * PURPOSE: Plan 021 Phase 3 folded seven "what next" nudges into <NextStep>.
 *          These pin the two promises that made it worth doing:
 *            1. one next step per screen: an inline blocker, a running tour
 *               or a setup list on screen makes the layout banner yield;
 *            2. every setup list marks the same step (nextSetupStepId), not
 *               "first required incomplete" in one place and the prerequisite
 *               chain in another.
 */

import { act, createElement, Fragment, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupProject, SetupStep, SetupStepId } from '../lib/useSetupStatus'
import type { NbaWork } from '../lib/nextBestAction'

const state = vi.hoisted(() => ({
  project: null as SetupProject | null,
  work: { ready: true, urgentOpenReports: 0, fixesFailed: 0, fixesRetryable: 0, prsOpen: 0 } as NbaWork,
}))

vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => {
    const project = state.project
    const byId = new Map(project?.steps.map((s) => [s.id, s]) ?? [])
    return {
      data: null,
      loading: false,
      error: null,
      reload: () => {},
      hasAnyProject: project !== null,
      activeProject: project,
      selectors: {},
      isStepIncomplete: (id: SetupStepId) => !byId.get(id)?.complete,
      getStep: (id: SetupStepId) => byId.get(id) ?? null,
    }
  },
}))
vi.mock('../lib/useNavCounts', () => ({ useNavCounts: () => state.work }))
vi.mock('../lib/mode', () => ({ useAdminMode: () => ({ isQuickstart: true, isBeginner: false, isAdvanced: false }) }))
vi.mock('./ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useSendTestReport', () => ({ useSendTestReport: () => vi.fn() }))

import { NextStep } from './NextStep'
import { SetupChecklist } from './SetupChecklist'
import { useClaimNextStep } from '../lib/useNextStep'
import { buildSetupGuideModel } from '../lib/setupGuideSteps'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function step(id: SetupStepId, complete: boolean, required = true): SetupStep {
  return { id, label: `Label ${id}`, description: `Why ${id}`, complete, required, cta_to: `/go/${id}`, cta_label: `Do ${id}` }
}

function project(steps: SetupStep[], extra: Partial<SetupProject> = {}): SetupProject {
  const required = steps.filter((s) => s.required)
  return {
    project_id: 'p1',
    project_name: 'Acme',
    project_slug: 'acme',
    created_at: '2026-10-01T00:00:00.000Z',
    steps,
    required_total: required.length,
    required_complete: required.filter((s) => s.complete).length,
    total: steps.length,
    complete: steps.filter((s) => s.complete).length,
    done: required.every((s) => s.complete),
    report_count: 3,
    fix_count: 2,
    merged_fix_count: 0,
    ...extra,
  }
}

const SET_UP = project([step('project_created', true), step('api_key_generated', true), step('sdk_installed', true), step('github_connected', true, false)])
const QUIET: NbaWork = { ready: true, urgentOpenReports: 0, fixesFailed: 0, fixesRetryable: 0, prsOpen: 0 }

function Tour({ running }: { running: boolean }) {
  useClaimNextStep('overlay', running)
  return null
}

describe('NextStep', () => {
  let container: HTMLDivElement
  let root: Root

  function render(...children: ReactNode[]) {
    act(() =>
      root.render(
        createElement(MemoryRouter, { initialEntries: ['/reports'] }, createElement(Fragment, null, ...children)),
      ),
    )
  }
  const banner = () => container.querySelector('[data-next-step="banner"]')
  const nextSteps = () => container.querySelectorAll('[data-next-step]')

  beforeEach(() => {
    // The docked guide is closed, so only the surfaces under test speak.
    window.localStorage.setItem('mushi:setupGuide:v1', 'dismissed')
    state.project = SET_UP
    state.work = { ...QUIET, urgentOpenReports: 2 }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
  })

  it('the banner names real work when nothing on the page speaks', () => {
    render(createElement(NextStep, { variant: 'banner' }))
    expect(banner()?.textContent).toContain('2 critical or high reports are still unfixed')
  })

  it('an inline blocker on the page silences the banner, and the page shows the missing step', () => {
    state.project = project([...SET_UP.steps.filter((s) => s.id !== 'github_connected'), step('github_connected', false, false)])
    render(
      createElement(NextStep, { variant: 'banner', key: 'b' }),
      createElement(NextStep, { variant: 'inline', key: 'i', requires: ['github_connected'], emptyTitle: 'No fixes yet' }),
    )
    expect(banner()).toBeNull()
    expect(container.textContent).toContain('Label github_connected')
    expect(container.querySelector('a[href="/go/github_connected"]')).not.toBeNull()
  })

  it('an inline slot with nothing missing is just the empty state, and the banner speaks', () => {
    render(
      createElement(NextStep, { variant: 'banner', key: 'b' }),
      createElement(NextStep, { variant: 'inline', key: 'i', requires: ['github_connected'], emptyTitle: 'No fixes yet' }),
    )
    expect(container.textContent).toContain('No fixes yet')
    expect(banner()).not.toBeNull()
  })

  it('several inline blockers hold the slot until the last one goes', () => {
    state.project = null
    const inline = (key: string) => createElement(NextStep, { variant: 'inline', key, requires: ['project'], emptyTitle: 'Pick one' })
    render(createElement(NextStep, { variant: 'banner', key: 'b' }), inline('a'), inline('c'))
    expect(banner()).toBeNull()
    expect(container.textContent).toContain('Create your first project to get started')
    render(createElement(NextStep, { variant: 'banner', key: 'b' }), inline('a'))
    expect(banner()).toBeNull()
    render(createElement(NextStep, { variant: 'banner', key: 'b' }))
    expect(banner()?.textContent).toContain('Create your first project')
  })

  it('stands down while the docked setup guide is open, even with real work waiting', () => {
    window.localStorage.setItem('mushi:setupGuide:v1', 'expanded')
    render(createElement(NextStep, { variant: 'banner', key: 'b' }), createElement(NextStep, { variant: 'card', key: 'c' }))
    expect(nextSteps()).toHaveLength(0)
    window.localStorage.setItem('mushi:setupGuide:v1', 'minimized')
    render(createElement(NextStep, { variant: 'banner', key: 'b2' }))
    expect(banner()?.textContent).toContain('2 critical or high reports are still unfixed')
  })

  it('stands down while the first-run tour is running', () => {
    render(createElement(NextStep, { variant: 'banner', key: 'b' }), createElement(Tour, { key: 't', running: true }))
    expect(banner()).toBeNull()
    render(createElement(NextStep, { variant: 'banner', key: 'b' }), createElement(Tour, { key: 't', running: false }))
    expect(banner()).not.toBeNull()
  })

  it('with a setup checklist on screen the banner leaves setup to it but still names real work', () => {
    const fresh = project([step('project_created', true), step('api_key_generated', true), step('sdk_installed', false)], {
      report_count: 0,
      fix_count: 0,
    })
    state.project = fresh
    state.work = QUIET
    render(createElement(NextStep, { variant: 'banner' }))
    expect(banner()?.textContent).toContain('Install the Mushi widget')

    render(
      createElement(NextStep, { variant: 'banner', key: 'b' }),
      createElement(SetupChecklist, { key: 'c', project: fresh, mode: 'banner' }),
    )
    expect(banner()).toBeNull()
    // The checklist's own row is the one setup step on screen.
    const marked = Array.from(container.querySelectorAll('li')).filter((li) => /do this next/i.test(li.textContent ?? ''))
    expect(marked.map((li) => li.textContent)).toEqual([expect.stringContaining('Label sdk_installed')])

    state.work = { ...QUIET, urgentOpenReports: 1 }
    render(
      createElement(NextStep, { variant: 'banner', key: 'b' }),
      createElement(SetupChecklist, { key: 'c', project: fresh, mode: 'banner' }),
    )
    expect(banner()?.textContent).toContain('1 critical or high report is still unfixed')
    expect(nextSteps()).toHaveLength(1)
  })

  it("the dashboard card is the screen's one next step: the banner yields to it", () => {
    render(createElement(NextStep, { variant: 'banner', key: 'b' }), createElement(NextStep, { variant: 'card', key: 'c' }))
    expect(nextSteps()).toHaveLength(1)
    expect(container.querySelector('[data-next-step="card"]')?.textContent).toContain('2 critical or high reports are still unfixed')
  })

  it('the checklist marks the step the setup guide marks, prerequisites first', () => {
    // Out of chain order: the SDK row comes first, but it needs the API key.
    const p = project([step('project_created', true), step('sdk_installed', false), step('api_key_generated', false)])
    expect(buildSetupGuideModel(p).nextStepId).toBe('api_key_generated')
    render(createElement(SetupChecklist, { project: p, mode: 'wizard' }))
    const marked = Array.from(container.querySelectorAll('li')).filter((li) => /do this next/i.test(li.textContent ?? ''))
    expect(marked).toHaveLength(1)
    expect(marked[0].textContent).toContain('Label api_key_generated')
  })
})
