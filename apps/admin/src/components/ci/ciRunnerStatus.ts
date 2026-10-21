/**
 * FILE: apps/admin/src/components/ci/ciRunnerStatus.ts
 * PURPOSE: One status word + dot per runner, shared by the /ci map card and
 *          its drawer, so the two never disagree.
 */

import type { CiRunnerNodeData } from './ciMapLayout'

const RUNNER_STATUS = {
  busy: { word: 'Busy', dot: 'bg-info', why: 'Running a job now.' },
  online: { word: 'Idle', dot: 'bg-ok', why: 'Online and waiting for a job.' },
  offline: { word: 'Offline', dot: 'bg-danger', why: 'GitHub lists it as offline: the machine or its runner service is down.' },
  // GitHub did not list it (no Administration: read, or it was removed); the
  // last-job line says when it was last seen working.
  unknown: {
    word: 'Status unknown',
    short: 'Unknown',
    dot: 'bg-fg-faint',
    why: 'GitHub did not list this runner, so Mushi knows it only from its jobs. Give the GitHub token Administration: read to see idle and offline runners.',
  },
  on_demand: { word: 'On demand', dot: 'bg-ok', why: 'GitHub starts a fresh machine for each job and deletes it afterwards.' },
} as const

export type RunnerStatusMeta = { word: string; dot: string; why: string; short?: string }

export function runnerStatus(d: Pick<CiRunnerNodeData, 'busy' | 'status' | 'runnerKind'>): RunnerStatusMeta {
  if (d.busy) return RUNNER_STATUS.busy
  if (d.runnerKind === 'github_hosted') return RUNNER_STATUS.on_demand
  return RUNNER_STATUS[d.status]
}
