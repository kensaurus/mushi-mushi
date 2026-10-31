// SPDX-License-Identifier: MIT
/** What a fresh-eyes run writes and sends: a readable timeline, the console snapshot, the report body. */
import { describe, expect, it } from 'vitest'
import { findingBody, runSnapshot, timelineMarkdown } from './fresh-eyes-report.js'
import type { FreshEyesFinding, FreshEyesResult } from './fresh-eyes.js'

const result: FreshEyesResult = {
  runId: '20261027-210000-ab12',
  dir: '/tmp/run',
  goal: 'get my first bug explained',
  startUrl: 'https://x.test/',
  model: 'grok-4.7-high-fast',
  dryRun: true,
  hasAccount: false,
  startedAt: '2026-10-27T21:00:00.000Z',
  finishedAt: '2026-10-27T21:20:00.000Z',
  sessions: [
    {
      index: 1,
      outcome: 'stalled',
      stall: { step: 3, screen: '/admin/login', reason: 'signup_wall', detail: 'The visitor has no account and the next step needs one.' },
      ttfvSeconds: null,
      appSeconds: 3.2,
      readSeconds: 70,
      modelSeconds: 120,
      backtracks: 1,
      opinions: [],
      steps: [
        { n: 0, action: 'Open https://x.test/', path: '/', screen: '/', modelMs: 0, appMs: 1200, readMs: 60_000, outcome: 'ok', shot: 's1-step00.png' },
        { n: 1, action: 'Click the link "Get started | free"', path: '/admin/login', screen: '/admin/login', modelMs: 40_000, appMs: 2000, readMs: 10_000, outcome: 'ok', backtrack: true, requirements: ['inbox'], shot: 's1-step01.png' },
      ],
    },
  ],
  ttfvSeconds: null,
  steps: 2,
  reached: 0,
  stalledAt: { screen: '/admin/login', reason: 'signup_wall', sessions: 1 },
  findings: [],
  refused: [],
  blocked: 4,
  warnings: [],
}

const finding: FreshEyesFinding = {
  fingerprint: 'abcdef0123456789',
  kind: 'fresh-eyes',
  rule: 'fresh-eyes-signup-wall',
  severity: 'medium',
  path: '/admin/login',
  screen: '/admin/login',
  viewports: ['desktop'],
  summary: 'A first-time visitor cannot get past the sign-in wall at /admin/login without an account',
  evidence: ['Start signed out at https://x.test/', 'Step 1: Click the link "Get started"'],
  expected: 'e',
  doneWhen: 'd',
  foundBy: 'Found by mushi-ux fresh-eyes.',
  basis: 'measured',
  sessions: [1, 2],
}

describe('timelineMarkdown', () => {
  it('leads with the numbers and keeps table cells intact', () => {
    const md = timelineMarkdown(result)
    expect(md).toContain('Reached the goal: 0 of 1')
    expect(md).toContain('Time to first value (median of sessions that reached it): not reached')
    expect(md).toContain('Most sessions stalled at /admin/login: stopped at a sign-in wall')
    expect(md).toContain('model think time 120 s (not counted)')
    expect(md).toContain('Get started / free')
    expect(md).toContain('backtrack; needs: inbox; [shot](shots/s1-step01.png)')
  })
})

describe('runSnapshot', () => {
  it('sends ttfv, steps and the timeline; finished_at only when done', () => {
    const running = runSnapshot(result, 'running', '0.3.0')
    expect(running.finished_at).toBeNull()
    expect(runSnapshot(result, 'done', null).finished_at).toBe(result.finishedAt)
    const sessions = running.sessions as Array<{ steps: Array<Record<string, unknown>> }>
    expect(sessions[0]!.steps[1]).toMatchObject({ app_ms: 2000, model_ms: 40_000, read_ms: 10_000, backtrack: true, requirements: ['inbox'], shot: 's1-step01.png' })
    expect(running.stalled_at).toEqual(result.stalledAt)
  })
})

describe('findingBody', () => {
  it('carries the fingerprint, steps and how it was found', () => {
    const b = findingBody(finding, result)
    expect(b.fingerprint).toBe('abcdef0123456789')
    expect(b.basis).toBe('measured')
    expect(String(b.title)).toBe('/admin/login: A first-time visitor cannot get past the sign-in wall at /admin/login without an account')
    expect(String(b.description)).toContain('Seen in session(s) 1, 2 of fresh-eyes run 20261027-210000-ab12.')
    expect(String(b.description)).toContain('- Step 1: Click the link "Get started"')
  })
})
