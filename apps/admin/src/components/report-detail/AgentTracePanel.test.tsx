/**
 * @vitest-environment jsdom
 *
 * The agent-trace table has no links or buttons. On a narrow viewport it
 * scrolls sideways, so the scroller itself has to be a tab stop.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReportDetail } from './types'
import { AgentTracePanel } from './AgentTracePanel'

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
  it('puts the wide trace table in the tab order', () => {
    const report = {
      llm_invocations: [{
        id: 'i1',
        function_name: 'classify-report',
        stage: 'stage2',
        used_model: 'claude',
        status: 'success',
        latency_ms: 12,
        input_tokens: 10,
        output_tokens: 20,
        cost_usd: 0.01,
        created_at: '2026-10-19T02:14:09Z',
      }],
    } as unknown as ReportDetail
    act(() => root.render(createElement(AgentTracePanel, { report })))
    const region = container.querySelector('[aria-label="Agent trace"]')
    expect(region?.getAttribute('tabindex')).toBe('0')
    expect(region?.getAttribute('role')).toBe('region')
    expect(region?.querySelector('table')).not.toBeNull()
    expect(region?.className).toContain('overflow-x-auto')
  })
})
