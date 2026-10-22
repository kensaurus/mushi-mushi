/** GET /v1/admin/ci/placement shaped like kensaurus on 2026-10-22 (ADR 0037). */
import type { CiPlacement, CiRunnerPolicy, PlacementPreview } from '../../../lib/ciPlacementTypes'

export const PROJECT = '1000000a-0000-4000-8000-000000000000'
export const ORG = '0000000a-0000-4000-8000-000000000000'

export function policyFixture(over: Partial<CiRunnerPolicy> = {}): CiRunnerPolicy {
  return {
    organizationId: ORG,
    noPaidHostedOnPrivate: true,
    hostedAllowedRepos: ['AtPeak-Co-Ltd/pck', 'kensaurus/mushi-mushi'],
    externalControllers: [{ name: 'kci dispatcher', owner: 'sbc-visual', repos: ['kensaurus/tsumagoi'], note: null }],
    standbyRunners: ['kensaurus-local-*'],
    sourceNote: 'CI-AGREEMENT.md, 2026-10-22',
    updatedAt: '2026-10-22T10:00:00Z',
    ...over,
  }
}

export function placementFixture(over: Partial<CiPlacement> = {}): CiPlacement {
  return {
    projectId: PROJECT,
    organizationId: ORG,
    policy: policyFixture(),
    policyWritable: true,
    tokenStored: true,
    repos: [
      {
        repo: 'kensaurus/yen-yen',
        visibility: 'private',
        workflowsRead: true,
        controller: null,
        variables: [{ name: 'LINUX_RUNNER', jobs: 21, fallbacks: ['ubuntu-24.04'], allowed: true, current: { exists: false, value: null, updatedAt: null } }],
        labels: [
          { label: 'kensaurus-local', runners: 1, online: 1 },
          { label: 'kensaurus-local-yen-yen-1', runners: 1, online: 1 },
        ],
      },
      {
        repo: 'kensaurus/tsumagoi',
        visibility: 'private',
        workflowsRead: true,
        controller: { name: 'kci dispatcher', owner: 'sbc-visual', repos: ['kensaurus/tsumagoi'], note: null },
        variables: [{ name: 'LINUX_RUNNER', jobs: 8, fallbacks: ['ubuntu-latest'], allowed: true, current: { exists: true, value: 'kensaurus-local', updatedAt: '2026-10-21T15:11:00Z' } }],
        labels: [],
      },
    ],
    requests: [],
    watches: [],
    canDecide: true,
    canRequest: true,
    ...over,
  }
}

export function previewFixture(over: Partial<PlacementPreview> = {}): PlacementPreview {
  return {
    repo: 'kensaurus/yen-yen',
    projectId: PROJECT,
    visibility: 'private',
    variable: 'LINUX_RUNNER',
    action: 'set_actions_variable',
    current: { exists: false, value: null, updatedAt: null },
    next: { value: 'kensaurus-local', target: { kind: 'self_hosted', label: 'kensaurus-local' } },
    now: { target: { kind: 'github_hosted', label: 'ubuntu-24.04' } },
    jobs: {
      moves: [{ workflow: 'CI', workflowPath: '.github/workflows/ci.yml', job: 'Lint', fallback: 'ubuntu-24.04', mainStays: true, dependabotStays: true }],
      stays: [{ workflow: 'CI', workflowPath: '.github/workflows/ci.yml', job: 'Visual', why: 'pinned_hosted', detail: 'Pinned to GitHub: pixel baselines' }],
    },
    target: { label: 'kensaurus-local', runners: 1, online: 1, busy: 0, waitP95s: 191 },
    cost: { monthCostDelta: -4.2, currency: 'USD', note: 'Estimated from the cost comparison.' },
    policy: { allowed: true, code: null, reason: null, controller: null },
    warnings: ['Jobs already queued keep the runner they asked for; the change applies to new runs.'],
    payload: { repo: 'kensaurus/yen-yen', name: 'LINUX_RUNNER', value: 'kensaurus-local', expected: { exists: false, value: null, updatedAt: null }, jobs: [{ workflow: 'CI', job: 'Lint' }], expectedLabels: ['kensaurus-local'] },
    blocked: null,
    ...over,
  }
}
