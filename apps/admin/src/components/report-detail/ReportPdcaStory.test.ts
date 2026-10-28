import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { buildStoryNodes, ReportPdcaStory } from './ReportPdcaStory'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** True when `label` sits inside an opacity-75 fade (the wash that fails 4.5:1). */
function faded(host: HTMLElement, label: string): boolean {
  const el = [...host.querySelectorAll('span, p')].find((n) => n.textContent?.trim() === label)
  let node: Element | null = el ?? null
  while (node) {
    if (typeof node.className === 'string' && node.className.includes('opacity-75')) return true
    node = node.parentElement
  }
  return el == null
}
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail } from './types'

const idle = { status: 'idle', prUrl: null, error: null } as unknown as DispatchState

function report(overrides: Partial<ReportDetail>): ReportDetail {
  return {
    id: 'r1',
    project_id: 'p1',
    status: 'new',
    category: 'bug',
    severity: 'high',
    summary: 'Login button does nothing on iPad Safari',
    confidence: 0.72,
    created_at: '2026-10-04T00:00:00Z',
    classified_at: null,
    stage1_classification: null,
    processing_error: null,
    fix_attempts: [],
    ...overrides,
  } as ReportDetail
}

describe('ReportPdcaStory plan stage', () => {
  // REPORT A2: the test report showed "Plan ⧗ In flight" next to its 72% diagnosis.
  it('a classified test report with a stage-2 diagnosis and no stage-1 object reads as done', () => {
    const nodes = buildStoryNodes(
      report({ status: 'classified', stage2_analysis: { rootCause: 'Safari drops the session cookie' } }),
      idle,
    )
    expect(nodes.plan.state).toBe('done')
    expect(nodes.plan.headline).toBe('Login button does nothing on iPad Safari')
  })

  it('a report nobody classified yet is pending', () => {
    expect(buildStoryNodes(report({}), idle).plan.state).toBe('pending')
  })

  it('an auto-fix block stamp on a classified report is not a failed plan', () => {
    const nodes = buildStoryNodes(
      report({ status: 'classified', stage1_classification: { category: 'bug' }, processing_error: 'autofix_blocked: x' }),
      idle,
    )
    expect(nodes.plan.state).toBe('done')
  })

  it('a classifier error on an unclassified report is a failed plan', () => {
    expect(buildStoryNodes(report({ processing_error: 'schema mismatch' }), idle).plan.state).toBe('failed')
  })
})

describe('Check and Act labels stay at full contrast', () => {
  it('does not fade idle Check and Act rows', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ReportPdcaStory, { report: report({}), dispatchState: idle })))
    })
    expect(faded(host, 'Check')).toBe(false)
    expect(faded(host, 'Act')).toBe(false)
    expect(faded(host, 'Plan')).toBe(false)
    await act(async () => root.unmount())
    host.remove()
  })
})
