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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportDetail } from './types'

vi.mock('./CursorAgentLaunch', () => ({ CursorAgentLaunch: () => null }))

import { DiagnosisFixHero, inlineMarkdown } from './DiagnosisFixHero'

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
  act(() => root.render(createElement(DiagnosisFixHero, { report: r })))
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

  it('renders model text as text, never HTML', () => {
    render(report({ stage2_analysis: { rootCause: '<img src=x onerror=alert(1)>' } }))
    expect(container.querySelector('img')).toBeNull()
  })

  it('is honest when only the stage-1 classifier ran', () => {
    const text = render(report({ stage2_analysis: null }))
    expect(text).toContain('Lesson card shows the wrong duration')
    expect(text).toContain('Full diagnosis not run (classifier confident)')
    expect(text).not.toContain('Why it broke')
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
