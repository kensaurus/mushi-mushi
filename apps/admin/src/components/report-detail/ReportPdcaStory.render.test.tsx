/**
 * Report 3a5cb64c (2026-11-22): the story printed a raw Node stack as a
 * step's text and showed the judge's grade of the triage as "Fix checked —
 * Failed". The raw text now sits behind "Technical details" and the grade
 * reads "Diagnosis grade" on the step it grades.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ReportPdcaStory } from './ReportPdcaStory'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail } from './types'

const idle = { status: 'idle', prUrl: null, error: null } as unknown as DispatchState
const STACK = "mushi work: git commit failed: […] at wrapModuleLoad (node:internal/modules/cjs/loader:261:19) / code: 'MODULE_NOT_FOUND'"

const report = {
  id: 'r1',
  project_id: 'p1',
  status: 'classified',
  category: 'bug',
  created_at: '2026-11-17T16:38:08.824Z',
  classified_at: null,
  stage1_classification: null,
  processing_error: null,
  judge_eval: { id: 'j1', judge_score: 0.42, classification_agreed: false, judge_reasoning: 'Component is missing.', created_at: '2026-11-17T16:40:00.000Z' },
  fix_attempts: [
    {
      id: 'a1',
      status: 'failed',
      agent: 'mcp',
      pr_url: null,
      pr_number: null,
      branch: null,
      commit_sha: null,
      files_changed: null,
      lines_changed: null,
      review_passed: false,
      check_run_status: null,
      check_run_conclusion: null,
      pr_state: null,
      llm_model: null,
      failure_category: null,
      error: STACK,
      started_at: '2026-11-20T05:38:11.677Z',
      completed_at: '2026-11-20T05:41:01.003Z',
      created_at: '2026-11-20T05:38:11.677Z',
    },
  ],
} as unknown as ReportDetail

const html = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ReportPdcaStory, { report, dispatchState: idle })))

describe('ReportPdcaStory rendering', () => {
  it('shows the raw error only inside a closed "Technical details" disclosure, in monospace', () => {
    const out = html()
    const details = out.match(/<details[^>]*data-testid="story-technical-do"[^>]*>([\s\S]*?)<\/details>/)
    expect(details).not.toBeNull()
    expect(details![0]).not.toContain(' open')
    expect(details![1]).toContain('Technical details')
    const pre = details![1].match(/<pre class="([^"]*)"/)?.[1] ?? ''
    expect(pre).toContain('font-mono')
    expect(pre).toContain('max-h-40')
    // Outside the disclosure only the plain line appears.
    expect(out.replace(details![0], '')).not.toContain('node:internal')
    expect(out).toContain('pre-commit check failed (missing dependency)')
  })

  it('shows the judge as the diagnosis grade, not as a failed fix check', () => {
    const out = html()
    expect(out).toContain('data-testid="story-diagnosis-grade"')
    expect(out).toContain('Diagnosis grade:')
    expect(out).toContain('42%, the judge disagreed with the triage')
    expect(out).not.toContain('Loop blocked')
  })
})
