/**
 * @vitest-environment jsdom
 *
 * Agent skills opens on what is running on this app (console journeys
 * 2026-10-27): skill runs (ADR 0042) with their round and bug, pipelines
 * with their step; with nothing running, the last run. The one action is
 * "Run a skill on a bug".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillRun } from '../../lib/skillRuns'

const state = vi.hoisted(() => ({ runs: [] as unknown[], pipelines: [] as unknown[] }))
vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: { runs: state.runs, skills: [] } })) }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { data: state.pipelines }, loading: false, error: null, reload: vi.fn(), isValidating: false, lastFetchedAt: null }),
}))

import { SkillsRunningNow, runningItems } from './SkillsRunningNow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const run = (over: Partial<SkillRun>): SkillRun => ({
  id: 'r1',
  project_id: 'p1',
  skill_slug: 'audit-accessibility',
  scope: 'the booking flow',
  rounds_max: 3,
  round: 2,
  auto_merge: true,
  status: 'active',
  stop_reason: null,
  current_report_id: '11111111-2222-3333-4444-555555555555',
  history: [],
  created_at: '2026-10-26T00:00:00Z',
  updated_at: '2026-10-27T01:00:00Z',
  ...over,
})

const pipeline = (over: Record<string, unknown>) => ({
  id: 'pl1',
  report_id: '99999999-2222-3333-4444-555555555555',
  root_skill_slug: 'workflow-fix-and-ship',
  chain_slugs: ['debug-error'],
  mode: 'handoff' as const,
  status: 'running',
  created_at: '2026-10-27T00:00:00Z',
  steps: [
    { step_index: 0, status: 'passed' },
    { step_index: 1, status: 'running' },
  ],
  ...over,
})

describe('runningItems', () => {
  it("lists this app's running work, newest first, with the round or step", () => {
    const items = runningItems({ projectId: 'p1', skillRuns: [run({}), run({ id: 'other', project_id: 'p2' })], pipelines: [pipeline({})] })
    expect(items.map((i) => [i.kind, i.where])).toEqual([
      ['skill_run', 'Round 2 of 3'],
      ['pipeline', 'Step 2 of 2 · waiting on your editor'],
    ])
  })

  it('shows only the last run when nothing is running', () => {
    const items = runningItems({
      projectId: 'p1',
      skillRuns: [run({ status: 'done', stop_reason: 'Nothing left.', updated_at: '2026-10-20T00:00:00Z' })],
      pipelines: [pipeline({ status: 'completed' })],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'pipeline', running: false, where: 'Done · 2 steps' })
  })
})

describe('SkillsRunningNow', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('links each run to its bug and offers one way to start more', async () => {
    state.runs = [run({})]
    state.pipelines = []
    const onRunOnBug = vi.fn()
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SkillsRunningNow, { projectId: 'p1', onRunOnBug })))
    })
    expect(host.textContent).toContain('Running now')
    const bug = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'Bug 11111111')!
    expect(bug.getAttribute('href')).toBe('/reports/11111111-2222-3333-4444-555555555555')
    const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Run a skill on a bug')!
    act(() => button.click())
    expect(onRunOnBug).toHaveBeenCalled()
  })

  it('says nothing has run yet on an app with no runs', async () => {
    state.runs = []
    state.pipelines = []
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SkillsRunningNow, { projectId: 'p1', onRunOnBug: () => {} })))
    })
    expect(host.textContent).toContain('Nothing has run on this app yet.')
  })
})
