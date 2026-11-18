/**
 * @vitest-environment jsdom
 *
 * A stuck group's header on a phone (preview of #1166 at 390 px, 2026-11-18): the title sat
 * beside its age and actions, one letter wide. The title is now its own full-width element and
 * the header is one column below 640 px. jsdom applies no CSS, so this pins the classes and
 * the structure; the width itself is checked live.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { PipelineGroup, PipelineItem } from '../../lib/pipeline'
import { PipelineGroups } from './PipelineGroups'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-11-18T12:00:00Z')

const item = (id: string): PipelineItem => ({
  id,
  projectId: 'p1',
  reportId: `r-${id}`,
  title: `Report ${id}`,
  repo: 'o/r',
  prNumber: 1,
  prUrl: 'https://github.com/o/r/pull/1',
  queueId: null,
  since: '2026-10-20T12:00:00Z',
  lastError: null,
  lastEventAt: null,
  lastEventLabel: null,
  failingChecks: [],
  review: null,
  queueDetail: null,
  blocked: {},
})

const group: PipelineGroup = {
  id: 'review_changes',
  stage: 'review',
  tone: 'stuck',
  label: '21 PRs: the review asked for changes; no agent is making them',
  count: 2,
  oldestAt: '2026-11-01T12:00:00Z',
  actions: ['re_review', 'close'],
  settings: { label: 'Review follow-ups setting', to: '/settings' },
  items: [item('a'), item('b')],
}

let cleanup: Array<() => void> = []
afterEach(() => {
  cleanup.forEach((f) => f())
  cleanup = []
})

function mount(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(PipelineGroups, { groups: [group], projectNames: new Map(), showApp: false, now: NOW, busyKey: null, results: new Map(), onAction: () => undefined }),
      ),
    ),
  )
  cleanup.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return host
}

const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

describe('PipelineGroups header row', () => {
  it('stacks below the breakpoint: one column on the header, two from sm up', () => {
    const host = mount()
    const card = q(host, 'pipeline-group-review_changes')!
    const head = q(host, 'pipeline-group-review_changes-head')!
    expect(head.parentElement).toBe(card)
    expect(head.className.split(/\s+/)).toEqual(expect.arrayContaining(['grid', 'grid-cols-1', 'sm:grid-cols-[minmax(0,1fr)_auto]']))
    // No container on the card: its layout containment would stack an open More menu under the next card.
    expect(card.className).not.toMatch(/@container/)
    expect(head.className).not.toMatch(/(^|\s)flex-1(\s|$)/)
  })

  it('puts the title alone in its own cell, and the age, setting link and actions together in the next', () => {
    const host = mount()
    const head = q(host, 'pipeline-group-review_changes-head')!
    const toggle = q(host, 'pipeline-group-review_changes-toggle')!
    const side = q(host, 'pipeline-group-review_changes-side')!
    expect(Array.from(head.children)).toEqual([toggle, side])
    expect(toggle.textContent).toBe(group.label)
    expect(toggle.className).not.toMatch(/(^|\s)flex-1(\s|$)/)
    expect(side.textContent).toContain('oldest 17 d')
    expect(side.contains(q(host, 'pipeline-group-review_changes-settings'))).toBe(true)
    expect(side.contains(q(host, 'pipeline-group-review_changes-re_review'))).toBe(true)
    expect(side.contains(q(host, 'pipeline-group-review_changes-more-actions'))).toBe(true)
  })
})
