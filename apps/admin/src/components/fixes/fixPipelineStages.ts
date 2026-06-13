/**
 * Maps a FixAttempt to PipelineStrip stages using the same derivation as
 * FixAttemptFlow — one source of truth, no React Flow in long lists.
 */

import type { PipelineStageState } from '../ui'
import type { FixAttempt } from './types'
import { isFixMerged } from '../../lib/mergeFix'
import { deriveStatuses, type FixStageStatus } from './fixAttemptFlow.data'

const STAGE_META = [
  { key: 'report', label: 'Report' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'pr', label: 'PR' },
  { key: 'judge', label: 'Judge' },
  { key: 'act', label: 'Ship' },
] as const

function mapStageStatus(status: FixStageStatus): PipelineStageState {
  switch (status) {
    case 'done':
      return 'done'
    case 'active':
      return 'active'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

export function buildFixPipelineStages(fix: FixAttempt): Array<{ label: string; state: PipelineStageState }> {
  const statuses = deriveStatuses(fix)
  return STAGE_META.map(({ key, label }) => ({
    label,
    state: mapStageStatus(statuses[key] ?? 'pending'),
  }))
}

/** Left stripe tone for at-a-glance row scan (Linear / GitHub PR list pattern). */
export function fixStatusStripeClass(fix: FixAttempt): string {
  if (isFixMerged(fix)) return 'bg-ok'
  const status = fix.status?.toLowerCase()
  if (status === 'failed') return 'bg-danger'
  if (status === 'queued' || status === 'running') return 'bg-info motion-safe:animate-pulse'
  const ci = fix.check_run_conclusion?.toLowerCase()
  if (ci === 'success') return 'bg-ok'
  if (ci === 'failure' || ci === 'timed_out') return 'bg-warn'
  if (fix.pr_url && status === 'completed') return 'bg-brand'
  return 'bg-edge-subtle'
}
