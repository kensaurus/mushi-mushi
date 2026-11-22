/**
 * @vitest-environment jsdom
 *
 * The agent trace groups calls by run and stacks each call on one wrapping
 * line, so a phone shows every column without scrolling sideways.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReportDetail } from './types'
import { AgentTracePanel, agentTraceTotalCost, groupTraceRuns } from './AgentTracePanel'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AgentTracePanel', () => {
  // Sweep 2026-11-18: "$0.0000 total" over a column of "—".
  it('says the cost was not captured when no row recorded one', () => {
    expect(agentTraceTotalCost([{ cost_usd: null }, { cost_usd: null }])).toBeNull()
    expect(agentTraceTotalCost([{ cost_usd: 0.01 }, { cost_usd: null }])).toBeCloseTo(0.01)
    const report = {
      llm_invocations: [{ id: 'i1', function_name: 'fast-filter', stage: 'stage1', used_model: 'm', status: 'success', latency_ms: 1, input_tokens: 1, output_tokens: 1, cost_usd: null, created_at: '2026-11-18T00:00:00Z' }],
    } as unknown as ReportDetail
    act(() => root.render(createElement(AgentTracePanel, { report })))
    expect(container.querySelector('[data-testid="agent-trace-total"]')?.textContent).toBe('Cost not captured')
  })

  // R2 sweep 2026-11-18: six rows from three runs, ungrouped; a Cost column of
  // dashes; at 390px Tokens and Status were off-screen.
  it('groups calls into runs, shows every call without a sideways scroller, and drops an empty cost', () => {
    const call = (id: string, at: string, fn: string) => ({ id, function_name: 'fast-filter', stage: fn, used_model: 'claude-haiku-4-5', status: 'success', latency_ms: 1, input_tokens: 600, output_tokens: 681, cost_usd: null, created_at: at })
    const calls = [
      call('a', '2026-11-18T12:38:12Z', 'stage1'),
      call('b', '2026-11-18T12:38:13Z', 'embedding'),
      call('c', '2026-11-18T12:45:08Z', 'stage1'),
      call('d', '2026-11-18T12:45:09Z', 'embedding'),
      call('e', '2026-11-18T13:50:14Z', 'stage1'),
      call('f', '2026-11-18T13:50:16Z', 'embedding'),
    ]
    expect(groupTraceRuns(calls).map((run) => run.map((c) => c.id))).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']])
    act(() => root.render(createElement(AgentTracePanel, { report: { llm_invocations: calls } as unknown as ReportDetail })))
    expect(container.querySelectorAll('[data-testid="agent-trace-run"]').length).toBe(3)
    expect(container.querySelectorAll('[data-testid="agent-trace-call"]').length).toBe(6)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('.overflow-x-auto')).toBeNull()
    expect(container.textContent).toContain('1,281 tokens')
    expect(container.textContent).not.toContain('\u2014')
  })
})
