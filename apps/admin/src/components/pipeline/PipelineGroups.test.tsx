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
import { PipelineGroups, actionSections, groupSignalTone } from './PipelineGroups'
import { appBadgeName } from './TrainHistory'

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

function mount(groups: PipelineGroup[] = [group], topGroupId?: string | null): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(PipelineGroups, { groups, projectNames: new Map(), showApp: false, now: NOW, busyKey: null, results: new Map(), onAction: () => undefined, topGroupId }),
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

describe('PipelineGroups marks', () => {
  // ▲ only for what failed; a slow or waiting group takes ◆ (fresh-eyes review, 2026-11-18).
  it('marks slow and waiting groups ◆ (warn) and failed ones ▲ (danger)', () => {
    expect(groupSignalTone({ id: 'ci_slow', tone: 'stuck' })).toBe('warn')
    expect(groupSignalTone({ id: 'agent_slow', tone: 'stuck' })).toBe('warn')
    expect(groupSignalTone({ id: 'conflict_stuck', tone: 'stuck' })).toBe('warn')
    expect(groupSignalTone({ id: 'ci_red', tone: 'stuck' })).toBe('danger')
    expect(groupSignalTone({ id: 'held_ci_failed', tone: 'stuck' })).toBe('danger')
    expect(groupSignalTone({ id: 'ci_running', tone: 'moving' })).toBe('info')
    expect(groupSignalTone({ id: 'deployed', tone: 'done' })).toBe('ok')
  })

  it('draws the mark and the left edge in the same tone', () => {
    const host = mount()
    const card = q(host, 'pipeline-group-review_changes')!
    expect(card.getAttribute('data-tone')).toBe('danger')
    expect(card.className).toContain('border-l-danger')
    expect(q(host, 'pipeline-group-review_changes-toggle')!.querySelector('svg[data-tone="danger"]')).not.toBeNull()
  })
})

const g = (id: string, actions: PipelineGroup['actions'], count = 2): PipelineGroup => ({ ...group, id, label: `${count} PRs: ${id}`, count, actions, items: [item(`${id}-1`), item(`${id}-2`)] })

describe('PipelineGroups by action (round-2 review, 2026-11-18)', () => {
  it('puts groups that take the same fix under one heading, keeping list order, and leaves a lone one alone', () => {
    const groups = [g('held_a', ['update_branch', 'close'], 5), g('review_a', ['re_review'], 4), g('held_b', ['update_branch'], 3), g('triage', [], 2)]
    expect(actionSections(groups).map((s) => [s.action, s.groups.map((x) => x.id)])).toEqual([
      ['update_branch', ['held_a', 'held_b']],
      [null, ['review_a']],
      [null, ['triage']],
    ])
  })

  it('one heading button runs the fix on every group, and the groups under it keep only More', () => {
    const calls: unknown[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(PipelineGroups, { groups: [g('held_a', ['update_branch', 'close']), g('held_b', ['update_branch'])], projectNames: new Map(), showApp: false, now: NOW, busyKey: null, results: new Map(), onAction: (p) => calls.push(p) }),
        ),
      ),
    )
    cleanup.push(() => {
      act(() => root.unmount())
      host.remove()
    })
    const run = q(host, 'pipeline-action-section-update_branch-run')!
    expect(run.textContent).toBe('Update branch (4)')
    expect(q(host, 'pipeline-group-held_a-update_branch')).toBeNull()
    expect(q(host, 'pipeline-group-held_a-more-actions')).not.toBeNull()
    act(() => run.click())
    expect(calls).toEqual([expect.objectContaining({ action: 'update_branch', fixIds: ['held_a-1', 'held_a-2', 'held_b-1', 'held_b-2'] })])
  })

  it('draws ▲ on one row only: the group to start with; other failed rows keep their red edge', () => {
    const host = mount([g('a', ['re_review']), g('b', ['update_branch']), g('ci_slow', ['rerun_ci'])], 'b')
    const glyph = (id: string) => q(host, `pipeline-group-${id}-toggle`)!.querySelector('svg[data-tone]')
    expect(glyph('b')?.getAttribute('data-tone')).toBe('danger')
    expect(glyph('a')).toBeNull()
    expect(q(host, 'pipeline-group-a')!.className).toContain('border-l-danger')
    // Slow keeps its ◆: it is a different state, not a second bottleneck.
    expect(glyph('ci_slow')?.getAttribute('data-tone')).toBe('warn')
    expect(host.querySelectorAll('svg[data-tone="danger"]').length).toBe(1)
  })
})

describe('Release train app badge', () => {
  it('shows the app name only when the repo slug does not already say it', () => {
    expect(appBadgeName('kensaurus/glot.it', 'glot.it')).toBeNull()
    expect(appBadgeName('kensaurus/help-her-take-photo', 'Help Her Take Photo')).toBeNull()
    expect(appBadgeName('kensaurus/solo-boss-cloud-documentation', 'solo-boss-cloud')).toBe('solo-boss-cloud')
    expect(appBadgeName('o/r', undefined)).toBeNull()
  })
})
