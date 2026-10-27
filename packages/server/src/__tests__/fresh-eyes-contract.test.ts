/**
 * FILE: fresh-eyes-contract.test.ts
 * PURPOSE: What `mushi-ux fresh-eyes --sync --file` sends (packages/ux
 *          fresh-eyes-report.ts) parses under the server's schemas
 *          (_shared/fresh-eyes.ts), also for a noisy run: 40 signals on a
 *          step, 60 findings, long notes. A payload the server refuses would
 *          lose the whole run and every finding after it.
 */

import { describe, expect, it } from 'vitest'
import { findingBody, runSnapshot } from '../../../ux/src/fresh-eyes-report.ts'
import type { FreshEyesFinding, FreshEyesResult } from '../../../ux/src/fresh-eyes.ts'
import { FreshEyesFindingBody, FreshEyesSnapshot } from '../../supabase/functions/_shared/fresh-eyes.ts'

const finding = (i: number, over: Partial<FreshEyesFinding> = {}): FreshEyesFinding => ({
  fingerprint: i.toString(16).padStart(16, '0'),
  kind: 'fresh-eyes',
  rule: 'fresh-eyes-needs-third-party-account',
  severity: 'low',
  path: '/a'.repeat(200),
  screen: '/a'.repeat(200),
  viewports: ['desktop'],
  summary: 'x'.repeat(400),
  evidence: Array(20).fill('Step: '.padEnd(500, 'y')),
  expected: 'e'.repeat(800),
  doneWhen: 'd'.repeat(800),
  foundBy: 'f'.repeat(600),
  basis: 'measured',
  sessions: [1, 2, 3],
  ...over,
})

function noisyRun(): FreshEyesResult {
  return {
    runId: '20261027-210000-ab12',
    dir: '/tmp/run',
    goal: 'g'.repeat(400),
    startUrl: 'https://kensaur.us/mushi-mushi/',
    model: 'grok-4.7-high-fast',
    dryRun: false,
    hasAccount: true,
    startedAt: '2026-10-27T21:00:00.000Z',
    finishedAt: '2026-10-27T21:20:00.000Z',
    sessions: [1, 2, 3].map((index) => ({
      index,
      outcome: 'stalled' as const,
      stall: { step: 5, screen: '/s'.repeat(200), reason: index === 3 ? ('model_unavailable' as const) : ('model_gave_up' as const), detail: 'z'.repeat(500) },
      ttfvSeconds: null,
      appSeconds: 12.3,
      readSeconds: 70,
      modelSeconds: 400,
      backtracks: 2,
      opinions: [],
      steps: Array.from({ length: 150 }, (_, n) => ({
        n,
        action: `Click the button "${'b'.repeat(400)}"`,
        path: `/p?${'q'.repeat(600)}`,
        screen: '/s'.repeat(200),
        modelMs: 40_000,
        appMs: 1234,
        readMs: n === 0 ? 60_000 : 0,
        outcome: 'ok' as const,
        note: 'n'.repeat(500),
        opinion: { category: 'gave_up' as const, why: 'w'.repeat(200) },
        backtrack: true,
        deadEnd: false,
        requirements: ['terminal' as const, 'terminal' as const, 'inbox' as const],
        signals: Array(40).fill('console-error') as Array<'console-error'>,
        shot: `s${index}-step${String(n).padStart(2, '0')}.png`,
      })),
    })),
    ttfvSeconds: null,
    steps: 149,
    reached: 0,
    stalledAt: { screen: '/s'.repeat(200), reason: 'model_gave_up', sessions: 3 },
    findings: Array.from({ length: 60 }, (_, i) => finding(i)),
    refused: [],
    blocked: 0,
    warnings: [],
  }
}

describe('fresh-eyes CLI payload vs server schemas', () => {
  it('a noisy run still parses as a snapshot, running and done', () => {
    for (const status of ['running', 'done'] as const) {
      const parsed = FreshEyesSnapshot.safeParse(runSnapshot(noisyRun(), status, '0.3.0'))
      expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true)
    }
  })

  it('every finding body the CLI makes parses, for every rule it can produce', () => {
    const rules = ['fresh-eyes-page-error', 'fresh-eyes-server-error', 'fresh-eyes-signup-wall', 'fresh-eyes-captcha', 'fresh-eyes-dead-end', 'fresh-eyes-needs-api-key', 'fresh-eyes-too-many-choices', 'fresh-eyes-unclear-copy', 'fresh-eyes-gave-up']
    for (const [i, rule] of rules.entries()) {
      const body = findingBody(finding(i, { rule, basis: rule.includes('choices') || rule.includes('copy') || rule.includes('gave') ? 'opinion' : 'measured' }), noisyRun())
      const parsed = FreshEyesFindingBody.safeParse(body)
      expect(parsed.success, `${rule}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 2))}`).toBe(true)
    }
  })
})
