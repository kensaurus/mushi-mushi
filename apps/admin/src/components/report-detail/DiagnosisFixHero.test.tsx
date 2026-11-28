/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/DiagnosisFixHero.test.tsx
 * PURPOSE: Report detail shows the Stage-2 diagnosis (root cause, suggested
 *          fix, repro steps) — before 2026-10-02 it showed only the one-line
 *          summary, so report c0e99783's analysis never reached the page.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportDetail } from './types'

vi.mock('./FixWithAgentPanel', () => ({ FixWithAgentPanel: () => null }))

import { DiagnosisFixHero, Stage2AbsentNote, inlineMarkdown } from './DiagnosisFixHero'

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

function report(overrides: Partial<ReportDetail>): ReportDetail {
  return {
    id: 'c0e99783-a48f-43bf-9fd9-84708dec1a3c',
    category: 'confusing',
    severity: 'medium',
    summary: 'Lesson card shows the wrong duration',
    component: 'FeaturedLessonCard',
    confidence: 0.82,
    stage1_classification: { category: 'confusing' },
    processing_error: null,
    ...overrides,
  } as ReportDetail
}

function render(r: ReportDetail): string {
  // Operator view: the model line is asserted below. The outside view has its own test.
  act(() => root.render(createElement(MemoryRouter, null, createElement(DiagnosisFixHero, { report: r, showInternals: true }))))
  return container.textContent ?? ''
}

describe('DiagnosisFixHero', () => {
  it('renders root cause, suggested fix, repro steps and model metadata from stage 2', () => {
    const text = render(
      report({
        stage2_model: 'claude-sonnet-4-6',
        stage2_analysis: {
          rootCause: 'The minutes prop is stale.',
          suggestedFix: 'Read lesson.estimatedMinutes.',
          reproductionSteps: ['Open Home', 'Click Start'],
          confidence: 0.82,
        },
      }),
    )
    expect(text).toContain('Diagnosis')
    expect(text).toContain('Why it broke')
    expect(text).toContain('The minutes prop is stale.')
    expect(text).toContain('Suggested fix')
    expect(text).toContain('Read lesson.estimatedMinutes.')
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
    expect(text).toContain('Model: claude-sonnet-4-6')
    expect(text).toContain('82% confidence')
  })

  // Re-audit 2026-11-11: "Model: precomputed" on a builder's first sample report.
  it('outside operator accounts hides the model name, and calls the sample a sample', () => {
    const stage2 = { rootCause: 'The minutes prop is stale.', confidence: 0.82 }
    act(() => root.render(createElement(MemoryRouter, null, createElement(DiagnosisFixHero, { report: report({ stage2_model: 'claude-sonnet-4-6', stage2_analysis: stage2 }) }))))
    expect(container.textContent).not.toContain('Model:')
    expect(container.textContent).not.toContain('claude-sonnet-4-6')
    act(() => root.render(createElement(MemoryRouter, null, createElement(DiagnosisFixHero, { report: report({ stage2_model: 'precomputed', stage2_analysis: stage2 }) }))))
    expect(container.textContent).toContain('Sample explanation (written in advance)')
    expect(container.textContent).not.toContain('precomputed')
  })

  it('renders model text as text, never HTML', () => {
    render(report({ stage2_analysis: { rootCause: '<img src=x onerror=alert(1)>' } }))
    expect(container.querySelector('img')).toBeNull()
  })

  // Sweep 2026-11-18: with no title the page heading is the summary, so this card does not repeat it.
  it('says the summary only when the page heading does not', () => {
    expect(render(report({ stage2_analysis: null }))).not.toContain('Lesson card shows the wrong duration')
    expect(render(report({ stage2_analysis: null, title: 'Lesson time is wrong' }))).toContain('Lesson card shows the wrong duration')
  })

  it('is honest when only the stage-1 classifier ran', () => {
    const text = render(report({ stage2_analysis: null, title: 'Lesson time is wrong' }))
    expect(text).toContain('Lesson card shows the wrong duration')
    // ADR 0069: one plain line pointing at the fix prompt; no settings link in the diagnosis card.
    expect(container.querySelector('[data-testid="stage2-absent-hero"]')?.textContent).toContain('No full diagnosis for this bug yet.')
    expect(container.querySelector('[data-testid="stage2-absent"]')).toBeNull()
    expect(text).not.toContain('Change threshold')
    expect(text).not.toContain('classifier confident')
    expect(text).not.toContain('Why it broke')
  })

  // Journey walk 2026-11-28: "Likely in <x>" sat beside "no stack trace or file to change".
  it('names where the bug likely is only when an agent has a code location to start from', () => {
    expect(render(report({ stage2_analysis: null, component: 'app/words page' }))).not.toContain('Likely in')
    expect(render(report({ stage2_analysis: null, component: 'supabase/functions/delete-account' }))).toContain('Likely in')
    expect(render(report({ stage2_analysis: null, component: 'src/features/chat/ChatInput.tsx' }))).toContain('Likely in')
  })

  // The settings link moved to the LLM classification section (ADR 0069); it still explains itself.
  it('Stage2AbsentNote says why behind the info hint and links to the threshold', () => {
    act(() => root.render(createElement(MemoryRouter, null, createElement(Stage2AbsentNote, { report: report({ stage2_analysis: null }) }))))
    const text = container.textContent ?? ''
    expect(text).toContain('Quick summary only.')
    // The why sits behind the info hint; the line itself is one sentence and a link.
    expect(container.querySelector('[data-testid="stage2-absent"] [aria-label*="did not run"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stage2-absent"] a')?.textContent).toBe('Change threshold')
  })

  it('Stage2AbsentNote points at AI keys when only the rule-based sort ran', () => {
    act(() => root.render(createElement(MemoryRouter, null, createElement(Stage2AbsentNote, { report: report({ stage2_analysis: null, stage1_model: 'heuristic' }) }))))
    expect(container.querySelector('[data-testid="stage2-absent"] a')?.textContent).toBe('Check AI keys')
  })
})

describe('inlineMarkdown', () => {
  it('renders **bold** and `code` as elements and leaves everything else as plain text', () => {
    act(() => root.render(createElement('p', null, ...inlineMarkdown('1. **Duration mismatch**: read `lesson.estimatedMinutes` <b>not html</b>'))))
    expect(container.querySelector('strong')?.textContent).toBe('Duration mismatch')
    expect(container.querySelector('code')?.textContent).toBe('lesson.estimatedMinutes')
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toBe('1. Duration mismatch: read lesson.estimatedMinutes <b>not html</b>')
  })
})
