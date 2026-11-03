/**
 * @vitest-environment jsdom
 *
 * A failed pre-push attempt on the report page: the checks, branch, commit
 * and the push command are visible, and neither form of the colour code is.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DispatchState } from '../../lib/dispatchFix'
import { RecommendedAction } from '../ui/metrics'
import { deriveRecommendation } from './deriveRecommendation'
import type { ReportDetail } from './types'

const ESC = '\u001b[38;2;56;56;56m'
const RESET = '\u001b[0m'
const BRANCH = 'bugfix/MUSHI-71500346-local-cursor'
const SHA = 'abc1234def5678'

const idle = { status: 'idle', prUrl: null, error: null, jobId: null } as unknown as DispatchState

function report(): ReportDetail {
  const error = [
    'mushi work: git push failed: \\u001b[38;2;56;56;56mhook steps failed: test.unit, mobile-test.\\u001b[0m',
    `${ESC}🥊 test.unit${RESET}`,
    'FAIL a.test.ts',
  ].join('\n')
  return {
    id: 'rep-1',
    project_id: 'proj-1',
    description: 'push hook',
    status: 'classified',
    severity: 'high',
    category: 'bug',
    confidence: 0.8,
    created_at: '2026-11-04T00:00:00Z',
    fix_attempts: [{
      id: 'attempt-1',
      status: 'failed',
      failure_category: null,
      agent: 'local_cursor',
      llm_model: 'composer-2.5',
      error,
      branch: BRANCH,
      commit_sha: SHA,
      pr_url: null,
      pr_number: null,
      pr_state: null,
      files_changed: [],
      lines_changed: null,
      review_passed: null,
      check_run_status: null,
      check_run_conclusion: null,
      started_at: null,
      completed_at: null,
      created_at: '2026-11-04T00:00:00Z',
    }],
  } as unknown as ReportDetail
}

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

describe('a failed pre-push attempt on the report', () => {
  it('shows the checks, branch, commit and how to push, with no colour codes', () => {
    const rec = deriveRecommendation(report(), idle, 0, () => {})
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(RecommendedAction, {
        title: rec.title,
        description: rec.description,
        tone: rec.tone,
        meta: rec.meta,
        actions: rec.actions,
      })))
    })
    const text = container.textContent ?? ''
    expect(text).toContain('test.unit, mobile-test')
    expect(text).toContain('Fix test.unit, mobile-test')
    expect(text).toContain(BRANCH)
    expect(text).toContain(SHA.slice(0, 7))
    expect(text).toContain(SHA)
    expect(text).toContain('Local Cursor · composer-2.5')
    expect(text).toContain('Push the saved branch')
    expect(text.indexOf('Push the saved branch')).toBeLessThan(text.indexOf('Cloud dispatch anyway'))
    expect(container.innerHTML).not.toContain('\\u001b')
    expect(container.innerHTML).not.toMatch(/\u001b/)
    expect(text).not.toContain('mcp')
  })
})
