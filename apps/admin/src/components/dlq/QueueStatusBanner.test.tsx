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
