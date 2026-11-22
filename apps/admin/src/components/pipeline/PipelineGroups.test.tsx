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
import { PipelineGroups, actionSections, groupAgeBucket, groupSignalTone, sectionBlocks, sectionOf, sectionRun } from './PipelineGroups'
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
    // The one group to start with also carries a "Start here" label before its title.
    expect(toggle.textContent).toBe(`Start here: ${group.label}`)
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

describe('PipelineGroups round-3 review (2026-11-19)', () => {
  it('puts lone groups that follow an action section under their own "Other" heading', () => {
    const groups = [g('lead', ['re_review'], 9), g('held_a', ['update_branch'], 5), g('held_b', ['update_branch'], 3), g('triage', [], 2), g('rejected', [], 1)]
    expect(sectionBlocks(groups).map((b) => [b.kind, b.kind === 'other' ? b.headed : null, b.groups.map((x) => x.id)])).toEqual([
      ['other', false, ['lead']],
      ['action', null, ['held_a', 'held_b']],
      ['other', true, ['triage', 'rejected']],
    ])
    const host = mount(groups)
    const other = q(host, 'pipeline-other-section')!
    expect(other.textContent).toContain('Other: 2 groups, 3 items')
    expect(other.contains(q(host, 'pipeline-group-triage'))).toBe(true)
    expect(q(host, 'pipeline-action-section-update_branch')!.contains(q(host, 'pipeline-group-triage'))).toBe(false)
  })

  it('the section heading counts what its button runs on', () => {
    const a = g('held_a', ['update_branch'], 5)
    a.items = [{ ...item('held_a-1'), blocked: { update_branch: 'Not a PR' } }, item('held_a-2')]
    a.count = 2
    const host = mount([a, g('held_b', ['update_branch'], 2)])
    expect(q(host, 'pipeline-action-section-update_branch-run')!.textContent).toBe('Update branch (3)')
    expect(q(host, 'pipeline-action-section-update_branch-head')!.textContent).toBe("Update branch: 2 groups, 3 items (1 more can't take it now)")
  })
})

describe('PipelineGroups age grading and sections (2026-11-22)', () => {
  const DAY = 86_400_000
  const aged = (id: string, days: number): PipelineGroup => ({ ...g(id, ['re_review']), oldestAt: new Date(NOW - days * DAY).toISOString() })

  it('buckets a group by its oldest item, else by the oldest server bucket', () => {
    expect(groupAgeBucket({ oldestAt: new Date(NOW - 1 * DAY).toISOString() }, NOW)).toBe(0)
    expect(groupAgeBucket({ oldestAt: new Date(NOW - 5 * DAY).toISOString() }, NOW)).toBe(1)
    expect(groupAgeBucket({ oldestAt: new Date(NOW - 12 * DAY).toISOString() }, NOW)).toBe(2)
    expect(groupAgeBucket({ oldestAt: new Date(NOW - 45 * DAY).toISOString() }, NOW)).toBe(3)
    expect(groupAgeBucket({ oldestAt: null, ages: [4, 2, 0, 0] }, NOW)).toBe(1)
    expect(groupAgeBucket({ oldestAt: null }, NOW)).toBe(0)
  })

  it('grades the left edge by age (neutral, amber, red, deep red) and always prints the age', () => {
    const host = mount([aged('fresh', 1), aged('week', 5), aged('month', 12), aged('ancient', 45)], 'month')
    const card = (id: string) => q(host, `pipeline-group-${id}`)!
    expect(card('fresh').className).toContain('border-l-edge')
    expect(card('week').className).toContain('border-l-warn')
    expect(card('month').className).toContain('border-l-danger/60')
    expect(card('ancient').className).toMatch(/(^|\s)border-l-danger(\s|$)/)
    expect(card('fresh').getAttribute('data-age')).toBe('0–3 d')
    expect(card('ancient').getAttribute('data-age')).toBe('30 d+')
    expect(q(host, 'pipeline-group-ancient-age')!.textContent).toBe('oldest 45 d')
  })

  it('emphasises only the group to start with: a ring and a visible "Start here" label', () => {
    const host = mount([aged('a', 12), aged('b', 45), aged('c', 2)], 'a')
    expect(host.querySelectorAll('[data-start-here="true"]').length).toBe(1)
    expect(q(host, 'pipeline-group-a')!.className).toContain('ring-2')
    expect(q(host, 'pipeline-group-b')!.className).not.toContain('ring-2')
    expect(q(host, 'pipeline-group-a-start-here')!.textContent).toContain('Start here')
    expect(q(host, 'pipeline-group-b-start-here')).toBeNull()
  })

  it('never gathers groups under a closing action, and puts the agent no-PR groups under "Agent couldn\'t fix"', () => {
    const groups = [
      { ...g('agent_failed', ['dismiss'], 34), label: '34 reports: the agent failed, no PR opened' },
      g('ci_red', ['rerun_ci'], 10),
      { ...g('agent_failed_person', ['dismiss'], 3), label: '3 reports: the agent says a person must do it, no PR opened' },
      g('held', ['close'], 2),
      g('held_b', ['close'], 1),
    ]
    const blocks = sectionBlocks(groups)
    expect(blocks.map((b) => (b.kind === 'action' ? `action:${b.action}` : b.kind === 'reason' ? `reason:${b.label}` : `other:${b.headed}`))).toEqual([
      "reason:Agent couldn't fix",
      'other:true',
    ])
    expect(blocks[0]!.groups.map((x) => x.id)).toEqual(['agent_failed', 'agent_failed_person'])
    const host = mount(groups, 'agent_failed')
    expect(q(host, 'pipeline-agent-outcome-section')!.textContent).toContain("Agent couldn't fix: 2 groups, 37 reports, no PR opened")
    expect(q(host, 'pipeline-action-section-dismiss')).toBeNull()
    expect(q(host, 'pipeline-action-section-close')).toBeNull()
    expect(host.textContent).not.toMatch(/Not a code bug: \d+ groups/)
  })

  it('one lone agent group stays a plain row, with no heading over it', () => {
    expect(sectionBlocks([g('agent_failed', ['dismiss']), g('ci_red', ['rerun_ci'])]).map((b) => b.kind)).toEqual(['other'])
  })

  it('a section whose fix the status line runs shows no second button, and sectionRun counts what both run on', () => {
    const groups = [g('ci_a', ['rerun_ci'], 5), g('ci_b', ['rerun_ci'], 3)]
    expect(sectionRun(groups).ids).toEqual(['ci_a-1', 'ci_a-2', 'ci_b-1', 'ci_b-2'])
    expect(sectionOf(groups, 'ci_b')?.action).toBe('rerun_ci')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(PipelineGroups, { groups, projectNames: new Map(), showApp: false, now: NOW, busyKey: null, results: new Map(), onAction: () => undefined, topGroupId: 'ci_a', heroRunsSection: true }),
        ),
      ),
    )
    cleanup.push(() => {
      act(() => root.unmount())
      host.remove()
    })
    expect(q(host, 'pipeline-action-section-rerun_ci-run')).toBeNull()
    expect(q(host, 'pipeline-action-section-rerun_ci-above')!.textContent).toBe('Runs from Start here, above')
  })
})
