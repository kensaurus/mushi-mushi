/**
 * FILE: apps/admin/src/components/report-detail/deriveRecommendation.test.ts
 * PURPOSE: Test every recovery branch in deriveRecommendation — the classifier
 *          that drives the "Recommended action" card on the report detail page.
 *
 *          Coverage targets:
 *          - Happy path: completed PR ready, in-progress statuses
 *          - Skipped paths: no_context, no_sandbox, unsupported_agent
 *          - failure_category enum branches: context_assembly, LLM, GitHub, sandbox
 *          - Meta chip shape: started-at, model, agent, files
 *          - Action target correctness: to vs href
 *          - nowMs injection for live-ticking elapsed time
 */

import { describe, it, expect, vi } from 'vitest'
import { deriveRecommendation, formatElapsed } from './deriveRecommendation'
import type { ReportDetail, FixAttemptFailureCategory } from './types'
import type { DispatchState } from '../../lib/dispatchFix'

// ── Minimal factories ────────────────────────────────────────────────────────

function makeReport(overrides: Partial<ReportDetail> = {}): ReportDetail {
  return {
    id: 'rep-1',
    project_id: 'proj-1',
    description: 'Something broke',
    status: 'classified',
    severity: 'high',
    category: 'bug',
    confidence: 0.8,
    created_at: new Date().toISOString(),
    fix_attempts: [],
    ...overrides,
  } as ReportDetail
}

function makeDispatchState(overrides: Partial<DispatchState> = {}): DispatchState {
  return {
    status: 'idle',
    prUrl: null,
    error: null,
    jobId: null,
    ...overrides,
  } as DispatchState
}

function makeFixAttempt(
  overrides: {
    status?: string
    failure_category?: FixAttemptFailureCategory | null
    started_at?: string | null
    error?: string | null
    llm_model?: string | null
    agent?: string | null
    files_changed?: string[]
  } = {},
) {
  return {
    id: 'attempt-1',
    status: 'failed',
    failure_category: null,
    started_at: null,
    completed_at: null,
    created_at: new Date(0).toISOString(),
    error: null,
    llm_model: null,
    agent: null,
    files_changed: [] as string[],
    pr_url: null,
    pr_number: null,
    branch: null,
    commit_sha: null,
    lines_changed: null,
    review_passed: null,
    check_run_status: null,
    check_run_conclusion: null,
    pr_state: null as null,
    ...overrides,
  }
}

// ── formatElapsed ────────────────────────────────────────────────────────────

describe('formatElapsed', () => {
  it('returns "0s" for negative values', () => {
    expect(formatElapsed(-1000)).toBe('0s')
  })
  it('formats seconds only', () => {
    expect(formatElapsed(47_000)).toBe('47s')
  })
  it('formats minutes and seconds', () => {
    expect(formatElapsed(3 * 60 * 1000 + 12 * 1000)).toBe('3m 12s')
  })
  it('formats whole minutes', () => {
    expect(formatElapsed(5 * 60 * 1000)).toBe('5m')
  })
})

// ── deriveRecommendation ─────────────────────────────────────────────────────

describe('deriveRecommendation', () => {
  const noOp = vi.fn()

  describe('completed + PR ready', () => {
    it('returns success tone with View PR CTA', () => {
      const rec = deriveRecommendation(
        makeReport(),
        makeDispatchState({ status: 'completed', prUrl: 'https://github.com/test/pr/1' }),
        0,
        noOp,
      )
      expect(rec.tone).toBe('success')
      expect(rec.cta?.href).toBe('https://github.com/test/pr/1')
      expect(rec.cta?.label).toBe('View PR')
    })
  })

  describe('in-progress dispatch statuses', () => {
    it.each(['queueing', 'queued', 'running'] as const)(
      'returns info tone for status=%s',
      (status) => {
        const rec = deriveRecommendation(
          makeReport(),
          makeDispatchState({ status }),
          0,
          noOp,
        )
        expect(rec.tone).toBe('info')
        expect(rec.title).toContain('fix')
      },
    )

    it('includes elapsed time chip when fix_attempt has started_at', () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ status: 'running', started_at: tenMinutesAgo })],
        status: 'fixing',
      })
      const rec = deriveRecommendation(
        report,
        makeDispatchState({ status: 'running' }),
        0,
        noOp,
        Date.now(), // nowMs
      )
      const startedChip = rec.meta?.find((m) => m.label === 'Started')
      expect(startedChip).toBeDefined()
      expect(startedChip?.value).toMatch(/10m|9m/) // ±1 minute tolerance
    })

    it('live-ticking: different nowMs produces different elapsed values', () => {
      const fixedStart = 1_000_000_000_000 // fixed epoch
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ status: 'running', started_at: new Date(fixedStart).toISOString() })],
        status: 'fixing',
      })
      const rec1 = deriveRecommendation(
        report,
        makeDispatchState({ status: 'running' }),
        0,
        noOp,
        fixedStart + 60_000, // 1 minute later
      )
      const rec2 = deriveRecommendation(
        report,
        makeDispatchState({ status: 'running' }),
        0,
        noOp,
        fixedStart + 120_000, // 2 minutes later
      )
      const started1 = rec1.meta?.find((m) => m.label === 'Started')?.value ?? ''
      const started2 = rec2.meta?.find((m) => m.label === 'Started')?.value ?? ''
      expect(started1).not.toBe(started2)
    })
  })

  describe('report terminal statuses', () => {
    it('fixed report → verify and close out', () => {
      const rec = deriveRecommendation(makeReport({ status: 'fixed' }), makeDispatchState(), 0, noOp)
      expect(rec.title).toContain('fix')
      expect(rec.tone).toBe('success')
    })

    it('dismissed report → neutral tone', () => {
      const rec = deriveRecommendation(makeReport({ status: 'dismissed' }), makeDispatchState(), 0, noOp)
      expect(rec.tone).toBe('neutral')
    })
  })

  describe('skipped_no_context', () => {
    it('recommends configuring codebase indexing', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ status: 'skipped_no_context' })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.tone).toBe('urgent')
      expect(rec.title).toContain('index')
      const actions = rec.actions ?? []
      const indexAction = actions.find((a) => a.to === '/integrations')
      expect(indexAction).toBeDefined()
    })

    it('no_relevant_code failure_category triggers the same branch', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ status: 'failed', failure_category: 'no_relevant_code' })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.tone).toBe('urgent')
      expect(rec.title).toContain('index')
    })
  })

  describe('context_assembly_failed', () => {
    it('recommends pipeline log + retry', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ failure_category: 'context_assembly_failed' })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.title).toContain('context')
      const retryAction = rec.actions?.find((a) => a.label?.toLowerCase().includes('retry'))
      expect(retryAction).toBeDefined()
    })
  })

  describe('skipped_no_sandbox', () => {
    it('links to pricing', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ status: 'skipped_no_sandbox' })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.tone).toBe('urgent')
      expect(rec.title).toContain('sandbox')
      const pricingLink = rec.actions?.find((a) => a.href?.includes('pricing'))
      expect(pricingLink).toBeDefined()
    })
  })

  describe('skipped_unsupported_agent', () => {
    it('links to integrations', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ status: 'skipped_unsupported_agent' })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.tone).toBe('urgent')
      const settingsLink = rec.actions?.find((a) => a.to === '/integrations')
      expect(settingsLink).toBeDefined()
    })
  })

  describe('LLM failure_category branches', () => {
    it.each([
      'llm_invalid_json',
      'llm_no_object',
      'llm_other_error',
    ] as FixAttemptFailureCategory[])('non-rate-limit LLM error %s → retry CTA', (cat) => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ failure_category: cat })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.tone).toBe('urgent')
      const retryAction = rec.actions?.find((a) => a.label?.toLowerCase().includes('retry'))
      expect(retryAction).toBeDefined()
    })

    it('llm_rate_limit → Anthropic rate limit title', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ failure_category: 'llm_rate_limit' })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.title).toContain('rate limit')
      const anthropicLink = rec.actions?.find((a) => a.href?.includes('anthropic.com'))
      expect(anthropicLink).toBeDefined()
    })
  })

  describe('GitHub failure_category branches', () => {
    it('github_403 → reconnect GitHub action', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ failure_category: 'github_403' })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.title).toContain('GitHub')
      const ghAction = rec.actions?.find((a) => a.to === '/integrations')
      expect(ghAction).toBeDefined()
    })

    it('github_404 → "repo not found" description', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ failure_category: 'github_404' })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.description.toLowerCase()).toContain('not found')
    })
  })

  describe('sandbox / validation failure_category branches', () => {
    it.each([
      'sandbox_timeout',
      'sandbox_error',
      'validation_rejected',
      'spec_violation',
      'scope_blocked',
    ] as FixAttemptFailureCategory[])('%s → pipeline log action', (cat) => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ failure_category: cat })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.tone).toBe('urgent')
      const pipelineAction = rec.actions?.find((a) => a.to === '/fixes')
      expect(pipelineAction).toBeDefined()
    })
  })

  describe('generic failed (unknown failure_category)', () => {
    it('returns urgent tone with retry action', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ status: 'failed', failure_category: 'unknown' })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.tone).toBe('urgent')
      const retryAction = rec.actions?.find((a) => a.label?.toLowerCase().includes('retry'))
      expect(retryAction).toBeDefined()
    })

    it('surfaces the error field from the attempt when present', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ status: 'failed', error: 'OOM in sandbox', failure_category: null })],
      })
      const rec = deriveRecommendation(report, makeDispatchState(), 0, noOp)
      expect(rec.description).toContain('OOM in sandbox')
    })
  })

  describe('meta chip shape', () => {
    it('includes model chip when llm_model is set', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({ status: 'running', started_at: new Date().toISOString(), llm_model: 'claude-sonnet-4' })],
        status: 'fixing',
      })
      const rec = deriveRecommendation(report, makeDispatchState({ status: 'running' }), 0, noOp)
      const modelChip = rec.meta?.find((m) => m.label === 'Model')
      expect(modelChip?.value).toBe('claude-sonnet-4')
    })

    it('includes truncated files chip when multiple files changed', () => {
      const report = makeReport({
        fix_attempts: [makeFixAttempt({
          status: 'running',
          started_at: new Date().toISOString(),
          files_changed: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        })],
        status: 'fixing',
      })
      const rec = deriveRecommendation(report, makeDispatchState({ status: 'running' }), 0, noOp)
      const filesChip = rec.meta?.find((m) => m.label === 'Files')
      expect(filesChip?.value).toContain('+2 more')
    })
  })
})
