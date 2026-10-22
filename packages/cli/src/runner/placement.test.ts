/**
 * renderPlacement / renderPreview: where each repo's CI runs and the dry run
 * of a change (ADR 0037), including external controllers, a missing token,
 * a blocked change with its reason, and pending requests.
 */
import { describe, expect, it } from 'vitest'
import { renderPlacement, renderPreview, targetText } from './placement.js'

describe('renderPlacement', () => {
  it('shows the agreement, each repo\'s variables and labels, controllers and pending requests', () => {
    const text = renderPlacement({
      policy: { noPaidHostedOnPrivate: true, sourceNote: 'CI-AGREEMENT.md' },
      tokenStored: true,
      repos: [
        { repo: 'kensaurus/yen-yen', visibility: 'private', workflowsRead: true, variables: [{ name: 'LINUX_RUNNER', jobs: 21, fallbacks: ['ubuntu-24.04'], allowed: true, current: { exists: false, value: null } }], labels: [{ label: 'kensaurus-local', runners: 1, online: 1 }] },
        { repo: 'kensaurus/tsumagoi', visibility: 'private', workflowsRead: true, controller: { name: 'kci dispatcher', owner: 'sbc-visual' }, variables: [{ name: 'LINUX_RUNNER', jobs: 8, current: { exists: true, value: 'kensaurus-local' } }] },
        { repo: 'kensaurus/x', workflowsRead: true, variables: [{ name: 'EXPO_RUNNER', jobs: 1, allowed: false, current: null }] },
      ],
      requests: [{ id: 'abcdef12-0000', action: 'set_actions_variable', status: 'pending_approval', payload: { repo: 'kensaurus/yen-yen', name: 'LINUX_RUNNER', value: 'kensaurus-local' } }],
      watches: [{ repo: 'kensaurus/glot.it', variable: 'LINUX_RUNNER', status: 'alert', jobs_seen: 3, unexpected: 1, slow: 0 }],
    }).join('\n')
    expect(text).toContain('CI agreement: no paid GitHub-hosted minutes on private repos (CI-AGREEMENT.md)')
    expect(text).toContain('vars.LINUX_RUNNER not set  (21 jobs, else ubuntu-24.04)')
    expect(text).toContain('Runner labels: kensaurus-local 1/1 online')
    expect(text).toContain('Managed by kci dispatcher (sbc-visual): read-only here.')
    expect(text).toContain('vars.EXPO_RUNNER value unknown  (1 job)  [Mushi does not change this one]')
    expect(text).toContain('abcdef12  pending_approval  kensaurus/yen-yen LINUX_RUNNER → kensaurus-local')
    expect(text).toContain('Watching kensaurus/glot.it LINUX_RUNNER: alert, 3/10 jobs, 1 on another runner')
  })

  it('says when no agreement or token is recorded', () => {
    const text = renderPlacement({ policy: null, tokenStored: false, repos: [] }).join('\n')
    expect(text).toContain('not recorded')
    expect(text).toContain('No GitHub token is stored')
  })
})

describe('renderPreview', () => {
  it('shows what moves, what stays and why, the target, cost and warnings', () => {
    const text = renderPreview({
      repo: 'kensaurus/yen-yen',
      variable: 'LINUX_RUNNER',
      current: { exists: false, value: null, updatedAt: null },
      next: { value: 'kensaurus-local', target: { kind: 'self_hosted', label: 'kensaurus-local' } },
      now: { target: { kind: 'github_hosted', label: 'ubuntu-24.04' } },
      jobs: { moves: [{ workflow: 'CI', job: 'Lint' }], stays: [{ workflow: 'CI', job: 'Visual', detail: 'Pinned to GitHub: pixel baselines' }] },
      target: { label: 'kensaurus-local', runners: 1, online: 1, busy: 0, waitP95s: 191 },
      cost: { monthCostDelta: -4.2, currency: 'USD', note: 'Estimated.' },
      warnings: ['Jobs already queued keep the runner they asked for.'],
      blocked: null,
    }).join('\n')
    expect(text).toContain('kensaurus/yen-yen: vars.LINUX_RUNNER not set → “kensaurus-local”')
    expect(text).toContain('GitHub-hosted (ubuntu-24.04) → self-hosted “kensaurus-local”')
    expect(text).toContain('Moves (1): CI · Lint')
    expect(text).toContain('Stays: CI · Visual — Pinned to GitHub: pixel baselines')
    expect(text).toContain('1/1 runner online with “kensaurus-local”, wait p95 191 s')
    expect(text).toContain('Cost: −$4.20 a month (estimated)')
    expect(text).toContain('! Jobs already queued')
    expect(text).toContain('Ready to request')
  })

  it('shows a blocked change with its reason', () => {
    const text = renderPreview({ repo: 'a/b', variable: 'LINUX_RUNNER', current: null, next: { value: null, target: { kind: 'github_hosted', label: null } }, blocked: { code: 'POLICY_NO_PAID_HOSTED', message: 'Your CI agreement says no.' } }).join('\n')
    expect(text).toContain('vars.LINUX_RUNNER unreadable → removed')
    expect(text).toContain('Cannot request: Your CI agreement says no. (POLICY_NO_PAID_HOSTED)')
    expect(targetText(null)).toBe('?')
  })
})
