/**
 * @vitest-environment jsdom
 */

/**
 * /fixes disagreed with itself and with Home (console sweep, 2026-10-28):
 *   - "Ready to merge: None right now" while Home and /pipeline listed
 *     "6 PRs: approved and green, not queued to merge". Their checks had
 *     passed with a few skipped, which the PR's summary stores as "skipped".
 *   - "Stopped: 47 reports" under a status line saying "Stopped 48": the
 *     reasons only covered the newest 200 attempts loaded on the page.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FixesFirstView } from './FixesFirstView'
import type { FixAttempt } from './types'
import type { PipelineData } from '../../lib/pipeline'

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

function attempt(over: Partial<FixAttempt> & { id: string }): FixAttempt {
  return { report_id: `r-${over.id}`, agent: 'cursor_cloud', status: 'completed', started_at: '2026-10-27T00:00:00Z', ...over } as FixAttempt
}

const approvedSkippedSummary = attempt({
  id: 'fix-839',
  pr_url: 'https://github.com/kensaurus/mushi-mushi/pull/839',
  pr_number: 839,
  pr_state: 'open',
  commit_sha: '3dba53b',
  check_run_conclusion: 'skipped',
  review_verdict: 'merge',
  review_head_sha: '3dba53b',
  report_title: 'Pass rate label is wrong',
} as Partial<FixAttempt> & { id: string })

function pipelineWith(groups: Array<{ id: string; items: string[] }>): PipelineData {
  return {
    stages: [{ id: 'train', label: 'Release train', count: 0, stuck: 0, oldestAt: null, groups: groups.map((g) => ({ id: g.id, stage: 'train', tone: 'stuck', label: '', count: g.items.length, oldestAt: null, actions: [], settings: null, items: g.items.map((id) => ({ id })) })) }],
    trains: [],
  } as unknown as PipelineData
}

async function render(fixes: FixAttempt[], pipeline: PipelineData | null, stoppedTotal?: number) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(FixesFirstView, { fixes, pipeline, projectId: 'p1', stoppedTotal, busy: false, onQueue: vi.fn(), onShowCause: vi.fn(), onRetry: vi.fn() }),
      ),
    )
  })
}

describe('FixesFirstView', () => {
  it('lists a PR /pipeline counts approved and green, even with a skipped check summary', async () => {
    await render([approvedSkippedSummary], pipelineWith([{ id: 'not_queued', items: ['fix-839'] }]))
    expect(container.querySelector('[data-testid="fixes-ready-empty"]')).toBeNull()
    expect(container.querySelector('[data-testid="fixes-ready-fix-839"]')?.textContent).toContain('Pass rate label is wrong')
    expect(container.textContent).toContain('Ready to merge: 1')
  })

  it('does not list it when /pipeline does not count it ready', async () => {
    await render([approvedSkippedSummary], pipelineWith([{ id: 'hold', items: ['fix-839'] }]))
    expect(container.querySelector('[data-testid="fixes-ready-empty"]')).not.toBeNull()
  })

  it('titles Stopped with the status line total and says what the reasons cover', async () => {
    const stopped = attempt({ id: 'f1', report_fix_state: 'failed', is_latest_attempt: true, status: 'failed', error: 'boom' } as Partial<FixAttempt> & { id: string })
    await render([stopped], null, 2)
    expect(container.textContent).toContain('Stopped: 2 reports')
    expect(container.textContent).toContain('The reasons below cover the 1 in the newest attempts loaded on this page.')
  })
})
