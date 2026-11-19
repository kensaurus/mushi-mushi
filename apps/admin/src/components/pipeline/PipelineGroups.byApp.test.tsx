/**
 * @vitest-environment jsdom
 *
 * /pipeline in All apps mode: an open stuck group lists its items in one block
 * per app (AppGroupSection), the app with the oldest item first, the count in
 * the header and "Open →" to that app's pipeline at this group. One app, or
 * one-app mode, keeps the flat list.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/useSetupStatus', () => ({ useSetupStatus: () => ({ data: null }) }))

import type { PipelineGroup, PipelineItem } from '../../lib/pipeline'
import { PipelineGroups, groupItemsByApp } from './PipelineGroups'
import { stuckSummary } from '../health/PipelineRecoveryPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-11-19T12:00:00Z')
const item = (id: string, projectId: string, daysAgo: number): PipelineItem => ({
  id,
  projectId,
  reportId: `r-${id}`,
  title: `Report ${id}`,
  repo: null,
  prNumber: null,
  prUrl: null,
  queueId: null,
  since: new Date(NOW - daysAgo * 86_400_000).toISOString(),
  lastError: null,
  lastEventAt: null,
  lastEventLabel: null,
  failingChecks: [],
  review: null,
  queueDetail: null,
  blocked: {},
})

const group = (items: PipelineItem[]): PipelineGroup => ({
  id: 'ci_red',
  stage: 'ci',
  tone: 'stuck',
  label: `${items.length} PRs: their own CI is red`,
  count: items.length,
  oldestAt: items[0]?.since ?? null,
  actions: [],
  settings: null,
  items,
})

const names = new Map([
  ['pa', 'Alpha'],
  ['pb', 'Beta'],
])

describe('groupItemsByApp', () => {
  it('groups by app with the oldest item first, inside and across apps', () => {
    const g = group([item('a1', 'pa', 1), item('b1', 'pb', 9), item('a2', 'pa', 4)])
    const apps = groupItemsByApp(g, names, true)!
    expect(apps.map((a) => a.name)).toEqual(['Beta', 'Alpha'])
    expect(apps[1]!.items.map((i) => i.id)).toEqual(['a2', 'a1'])
  })
  it('stays flat for one app or one-app mode', () => {
    expect(groupItemsByApp(group([item('a1', 'pa', 1), item('a2', 'pa', 2)]), names, true)).toBeNull()
    expect(groupItemsByApp(group([item('a1', 'pa', 1), item('b1', 'pb', 2)]), names, false)).toBeNull()
  })
})

describe('PipelineGroups in All apps mode', () => {
  let container: HTMLDivElement
  afterEach(() => container?.remove())

  it('an open group shows one block per app with its count and an Open link', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(PipelineGroups, {
            groups: [group([item('a1', 'pa', 1), item('b1', 'pb', 9), item('b2', 'pb', 2)])],
            projectNames: names,
            showApp: true,
            now: NOW,
            busyKey: null,
            results: new Map(),
            onAction: () => {},
          }),
        ),
      )
    })
    await act(async () => (container.querySelector('[data-testid="pipeline-group-ci_red-toggle"]') as HTMLButtonElement).click())
    const blocks = Array.from(container.querySelectorAll('[data-testid^="pipeline-app-group-ci_red-"]'))
    expect(blocks.map((b) => b.getAttribute('aria-label'))).toEqual(['Beta', 'Alpha'])
    expect(blocks[0]!.textContent).toContain('2')
    const open = blocks[0]!.querySelector('a[aria-label="Open Beta only"]')
    expect(open?.getAttribute('href')).toBe('/pipeline?project=pb&group=ci_red')
    act(() => root.unmount())
  })
})

describe('stuckSummary (Health: Run recovery now)', () => {
  it('names what is stuck, and says so when nothing is', () => {
    expect(stuckSummary({ strandedReports: 3, retryableFailed: 1, stalePending: 0 })).toBe('3 reports stuck before triage · 1 failed job with tries left')
    expect(stuckSummary({ strandedReports: 0, retryableFailed: 0, stalePending: 0 })).toBe('Nothing stuck before triage')
  })
})
