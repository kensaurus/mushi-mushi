/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/ReportDiagnosisGraph.test.tsx
 * PURPOSE: The diagnosis graph renders every node as a button in its lane,
 *          opens on the first claim that needs a look, and a step in the path
 *          list, a node, or a "Based on" link all move the side panel.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReportDetail } from './types'
import { ReportDiagnosisGraph } from './ReportDiagnosisGraph'

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

const REPORT = {
  id: 'r1',
  project_id: 'p1',
  description: 'Checkout total shows NaN after applying a coupon.',
  category: 'bug',
  severity: 'high',
  summary: 'Checkout total NaN',
  component: 'src/cart/Total.tsx',
  confidence: 0.62,
  status: 'classified',
  environment: { url: 'https://app.test/checkout', userAgent: 'Mozilla/5.0' },
  console_logs: [{ level: 'error', message: 'TypeError: total is undefined', timestamp: 1 }],
  network_logs: null,
  performance_metrics: null,
  screenshot_url: null,
  created_at: '2026-10-19T02:14:09Z',
  stage1_model: 'claude-haiku-4-5',
  stage1_classification: { symptom: 'Total shows NaN', confidence: 0.9, category: 'bug', severity: 'high' },
  stage2_analysis: {
    rootCause: 'The coupon reducer returns undefined when the code is unknown.',
    suggestedFix: 'Default the discount to 0.',
    reproductionSteps: ['Add an item', 'Apply coupon XYZ'],
    confidence: 0.62,
  },
  judge_eval: null,
  fix_attempts: [],
} as unknown as ReportDetail

function render(): void {
  act(() => root.render(createElement(ReportDiagnosisGraph, { report: REPORT })))
}

function panelTitle(): string {
  return container.querySelector('aside h4')?.textContent ?? ''
}

function click(el: Element | null | undefined): void {
  if (!el) throw new Error('element not found')
  act(() => (el as HTMLElement).click())
}

describe('ReportDiagnosisGraph', () => {
  it('shows the heading, the verdict and how many claims need a look', () => {
    render()
    const text = container.textContent ?? ''
    expect(text).toContain('How Mushi reached this diagnosis')
    expect(text).toContain('Likely cause, not confirmed')
    expect(text).toMatch(/\d+ things? to check/)
  })

  it('renders every lane and every node as a button', () => {
    render()
    for (const lane of ['Evidence', 'Signals', 'Diagnosis', 'Checks', 'Fix']) {
      expect(container.querySelector(`section[aria-label^="${lane}:"]`), lane).not.toBeNull()
    }
    expect(container.querySelector('[data-node-id="console"]')?.textContent).toContain('1 console error')
    expect(container.querySelector('[data-node-id="cause"]')?.tagName).toBe('BUTTON')
  })

  it('opens on the root cause, the first marked claim on the path', () => {
    render()
    expect(panelTitle()).toContain('Root cause: The coupon reducer returns undefined')
    expect(container.querySelector('[data-node-id="cause"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('aside')?.textContent).toContain('from stage2_analysis.rootCause')
  })

  it('a path step, a node and a "Based on" link each move the panel', () => {
    render()
    const steps = Array.from(container.querySelectorAll('ol[aria-label="Path to the diagnosis"] button'))
    click(steps.find((b) => b.textContent?.startsWith('Symptom')))
    expect(panelTitle()).toContain('Symptom: Total shows NaN')

    click(container.querySelector('[data-node-id="fixdir"]'))
    expect(panelTitle()).toContain('Suggested fix')

    const basedOn = Array.from(container.querySelectorAll('aside button')).find((b) => b.textContent === 'Root cause')
    click(basedOn)
    expect(panelTitle()).toContain('Root cause')
  })

  it('links a claim to its evidence section on the page', () => {
    render()
    click(container.querySelector('[data-node-id="console"]'))
    expect(container.querySelector('aside a[href="#report-console-logs"]')).not.toBeNull()
  })
})
