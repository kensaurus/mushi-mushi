/**
 * Derive React Flow nodes for a report's end-to-end CI/CD-style pipeline:
 * Submit → Classify → Dispatch → Draft PR → Ship
 */

import type { Edge, Node } from '@xyflow/react'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail, ReportFixAttempt } from './types'
import { pickPrimaryFixAttempt } from '../../lib/mergeFix'
import { STAGE_HEX } from '../flow-primitives/flowTokens'
import type { FixEdgeData, FixStageNodeData, FixStageStatus } from '../fixes/fixAttemptFlow.data'

const NODE_Y = 40
const NODE_GAP = 148
const NODE_W = 132
const NODE_H = 84

const STAGES: Array<{ key: string; pdca: 'plan' | 'do' | 'check' | 'act'; letter: string; label: string }> = [
  { key: 'submit', pdca: 'plan', letter: 'P', label: 'Submit' },
  { key: 'classify', pdca: 'plan', letter: 'P', label: 'Classify' },
  { key: 'dispatch', pdca: 'do', letter: 'D', label: 'Dispatch' },
  { key: 'pr', pdca: 'do', letter: 'D', label: 'Draft PR' },
  { key: 'ship', pdca: 'act', letter: 'A', label: 'Ship' },
]

export function buildReportPipelineNodes(
  report: ReportDetail,
  dispatchState: DispatchState,
): Node<FixStageNodeData>[] {
  const statuses = deriveReportPipelineStatuses(report, dispatchState)
  const fix = pickPrimaryFixAttempt(report.fix_attempts)
  return STAGES.map((s, i) => ({
    id: `${report.id}:${s.key}`,
    type: 'fixStage',
    position: { x: i * NODE_GAP, y: NODE_Y },
    width: NODE_W,
    height: NODE_H,
    draggable: false,
    connectable: false,
    selectable: false,
    data: {
      stageKey: s.key,
      pdcaStage: s.pdca,
      letter: s.letter,
      label: s.label,
      sublabel: sublabelFor(s.key, report, dispatchState, fix),
      status: statuses[s.key] ?? 'pending',
      href: hrefFor(s.key, report, fix),
      external: s.key === 'pr' && !!fix?.pr_url,
    },
  }))
}

export function buildReportPipelineEdges(
  report: ReportDetail,
  dispatchState: DispatchState,
): Edge<FixEdgeData>[] {
  const statuses = deriveReportPipelineStatuses(report, dispatchState)
  return STAGES.slice(0, -1).map((s, i) => {
    const next = STAGES[i + 1]
    const active =
      (statuses[s.key] === 'done' && (statuses[next.key] === 'active' || statuses[next.key] === 'done')) ||
      statuses[s.key] === 'active'
    return {
      id: `${report.id}:${s.key}->${next.key}`,
      source: `${report.id}:${s.key}`,
      target: `${report.id}:${next.key}`,
      type: 'pdcaGradient',
      sourceHandle: 'out',
      targetHandle: 'in',
      animated: active,
      data: {
        fromColor: STAGE_HEX[s.pdca],
        toColor: STAGE_HEX[next.pdca],
        sourceColor: STAGE_HEX[s.pdca],
        targetColor: STAGE_HEX[next.pdca],
        sourceStageId: s.pdca,
        flowing: statuses[s.key] === 'active',
        active,
      },
    }
  })
}

function deriveReportPipelineStatuses(
  report: ReportDetail,
  dispatchState: DispatchState,
): Record<string, FixStageStatus> {
  const fix = pickPrimaryFixAttempt(report.fix_attempts)
  const status = report.status?.toLowerCase() ?? ''
  const fixStatus = fix?.status?.toLowerCase() ?? ''
  const live = dispatchState.status
  const classified = Boolean(report.classified_at || report.stage1_classification)
  const hasPr = Boolean(fix?.pr_url || dispatchState.prUrl)

  const submit: FixStageStatus = 'done'

  let classify: FixStageStatus = 'pending'
  if (report.processing_error) classify = 'failed'
  else if (classified) classify = 'done'
  else classify = 'active'

  let dispatch: FixStageStatus = 'pending'
  if (live === 'queueing' || live === 'queued' || live === 'running') dispatch = 'active'
  else if (hasPr || live === 'completed' || status === 'fixing' || status === 'fixed' || fix) dispatch = 'done'
  else if (live === 'failed' || (fixStatus === 'failed' && !hasPr)) dispatch = 'failed'

  let pr: FixStageStatus = 'pending'
  if (hasPr) pr = 'done'
  else if (dispatch === 'active') pr = 'pending'
  else if (dispatch === 'done') pr = 'active'
  else if (fixStatus === 'failed') pr = 'failed'

  let ship: FixStageStatus = 'pending'
  if (status === 'fixed') ship = 'done'
  else if (status === 'dismissed') ship = 'skipped'
  else if (hasPr) ship = 'active'

  return { submit, classify, dispatch, pr, ship }
}

function sublabelFor(
  key: string,
  report: ReportDetail,
  dispatchState: DispatchState,
  fix: ReportFixAttempt | undefined,
): string | undefined {
  switch (key) {
    case 'submit':
      return `#${report.id.slice(0, 6)}`
    case 'classify':
      return report.severity ?? report.category ?? undefined
    case 'dispatch':
      if (dispatchState.status === 'running') return 'agent running'
      return fix?.agent ?? undefined
    case 'pr':
      return fix?.pr_number ? `#${fix.pr_number}` : fix?.branch ? fix.branch.slice(0, 18) : undefined
    case 'ship':
      return report.status === 'fixed' ? 'fixed' : fix?.check_run_conclusion ?? undefined
  }
  return undefined
}

function hrefFor(
  key: string,
  report: ReportDetail,
  fix: ReportFixAttempt | undefined,
): string | null {
  switch (key) {
    case 'submit':
    case 'classify':
      return null
    case 'dispatch':
      return '/fixes'
    case 'pr':
      return fix?.pr_url ?? null
    case 'ship':
      return fix?.pr_url && report.status !== 'fixed' ? fix.pr_url : '/integrations/config'
  }
  return null
}
