/**
 * @vitest-environment jsdom
 */

/**
 * Processing jobs showed a green "Queue healthy" banner above tiles that said
 * the same, and Manage apps said "All projects ingesting" up to three times
 * (console sweep, 2026-10-28). Neither banner shows when all is well; a
 * problem still gets one.
 */

import { act, createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueueStatusBanner } from './QueueStatusBanner'
import { EMPTY_QUEUE_STATS, type QueueStats } from './QueueStatsTypes'
import { ProjectsStatusBanner } from '../projects/ProjectsStatusBanner'
import { EMPTY_PROJECTS_STATS, type ProjectsStats } from '../projects/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function show<P extends object>(node: ComponentType<P>, props: Partial<P>) {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(node as ComponentType<Partial<P>>, props)))
  })
}

describe('healthy pages without a green banner', () => {
  it('Processing jobs shows no banner for a healthy queue, and one for stuck items', () => {
    const healthy: QueueStats = { ...EMPTY_QUEUE_STATS, hasAnyProject: true, projectName: 'glot.it', topPriority: 'healthy' }
    show(QueueStatusBanner, { stats: healthy, onRefresh: () => {} })
    expect(container.textContent).toBe('')
    show(QueueStatusBanner, { stats: { ...healthy, topPriority: 'dead_letter', deadLetter: 2 }, onRefresh: () => {} })
    expect(container.textContent).toContain('stuck after retries')
  })

  it('Manage apps shows no banner when every app is ingesting', () => {
    const healthy: ProjectsStats = { ...EMPTY_PROJECTS_STATS, projectCount: 3, topPriority: 'healthy' }
    show(ProjectsStatusBanner, { stats: healthy })
    expect(container.textContent).toBe('')
  })
})

describe('Manage apps with no app yet', () => {
  // A first-time user test (2026-10-29) clicked the banner's "Create project"
  // twice on the create tab, where it only re-opened that tab.
  const empty: ProjectsStats = { ...EMPTY_PROJECTS_STATS, topPriority: 'no_projects' }
  const buttons = () => [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Create project')

  it('offers Create project from the other tabs', () => {
    show(ProjectsStatusBanner, { stats: empty, onTab: () => {}, activeTab: 'overview' })
    expect(buttons()).toHaveLength(1)
  })

  it('shows no second Create project button on the create tab, where the form is', () => {
    show(ProjectsStatusBanner, { stats: empty, onTab: () => {}, activeTab: 'create' })
    expect(container.textContent).toContain('No projects in this workspace yet')
    expect(buttons()).toHaveLength(0)
  })
})

describe('Manage apps with an app made today', () => {
  // Live journey (2026-10-30): a new app was greeted with "no SDK heartbeat"
  // in warn, and after a test report with "compare endpoint host vs this admin".
  const today = new Date(Date.now() - 60_000).toISOString()
  const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const base: ProjectsStats = { ...EMPTY_PROJECTS_STATS, projectCount: 1, sdkMissingCount: 1 }

  it('reads as setup left, with one way to finish it, before and after a test report', () => {
    for (const topPriority of ['never_ingested', 'no_sdk_heartbeat', 'sdk_missing'] as const) {
      show(ProjectsStatusBanner, { stats: { ...base, topPriority, sdkMissingProjects: [{ id: 'p1', name: 'kensaur.us', createdAt: today }] } })
      expect(container.textContent).toContain('kensaur.us is waiting for its first SDK heartbeat')
      expect(container.textContent).not.toContain('compare endpoint host')
      expect(container.querySelector('a')?.getAttribute('href')).toBe('/connect?project=p1#connect-sdk-health')
    }
  })

  it('still warns about an app that should have checked in by now', () => {
    show(ProjectsStatusBanner, {
      stats: { ...base, topPriority: 'sdk_missing', topPriorityTo: '/connect?project=p1', sdkMissingProjects: [{ id: 'p1', name: 'old app', createdAt: lastWeek }] },
    })
    expect(container.textContent).toContain('old app has no SDK heartbeat')
  })
})
