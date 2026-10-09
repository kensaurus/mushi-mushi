/**
 * FILE: apps/admin/src/lib/fixRetry.test.ts
 * PURPOSE: /fixes rules from console QA group C: retry agent (241) and the
 *          Refresh-from-GitHub result (88).
 */

import { describe, expect, it } from 'vitest'
import {
  commonRetryAgent,
  describeCiRefresh,
  retryAgentFor,
  retryDispatchBody,
} from './fixRetry'

describe('retry agent (QA 241)', () => {
  it('defaults to the failed attempt’s own agent when it can run again', () => {
    expect(retryAgentFor('cursor_cloud')).toBe('cursor_cloud')
    expect(retryAgentFor('github_cloud_agent')).toBe('github_cloud_agent')
    expect(retryAgentFor('rest_fix_worker')).toBe('claude_code')
    // The GitHub Actions workflow agent has no dispatch path.
    expect(retryAgentFor('claude_code_agent')).toBe('auto')
    expect(retryAgentFor(null)).toBe('auto')
  })

  it('uses a shared agent for a batch, else the project default', () => {
    expect(commonRetryAgent(['cursor_cloud', 'cursor_cloud'])).toBe('cursor_cloud')
    expect(commonRetryAgent(['cursor_cloud', 'claude_code'])).toBe('auto')
  })

  it('sends the override only when one was chosen', () => {
    expect(JSON.parse(retryDispatchBody('r1', 'p1', 'cursor_cloud'))).toEqual({
      reportId: 'r1',
      projectId: 'p1',
      agentOverride: 'cursor_cloud',
    })
    expect(JSON.parse(retryDispatchBody('r1', 'p1', 'auto'))).toEqual({ reportId: 'r1', projectId: 'p1' })
  })
})

describe('describeCiRefresh (QA 88)', () => {
  it('confirms a sync with the CI state it read', () => {
    expect(describeCiRefresh({ ok: true, data: { check_run_conclusion: 'success' } })).toEqual({
      tone: 'success',
      title: 'Synced with GitHub',
      description: 'CI success.',
    })
    expect(describeCiRefresh({ ok: true, data: {} }).description).toBe('No CI run reported for this PR yet.')
  })

  it('reports a failed sync in plain English with the next step', () => {
    const failed = describeCiRefresh({ ok: false, error: { code: 'CI_SYNC_FAILED', message: 'ci-sync 401' } })
    expect(failed.tone).toBe('error')
    expect(failed.description).toMatch(/Check the GitHub connection in Integrations/)
    expect(describeCiRefresh({ ok: false, error: { code: 'CI_SYNC_TIMEOUT' } }).title).toMatch(/didn't answer in time/)
  })
})
