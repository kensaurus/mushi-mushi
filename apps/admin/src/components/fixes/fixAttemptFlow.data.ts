/**
 * FILE: apps/admin/src/components/fixes/fixAttemptFlow.data.ts
 * PURPOSE: Derive React Flow nodes + edges representing a single
 *          FixAttempt's PDCA journey. The row reads:
 *
 *            Report → Dispatch → Draft PR → Judge score → Merge/Notify
 *
 *          Each stage maps to a PDCA letter (P/D/D/C/A) so colour + meaning
 *          stay consistent with the main pipeline. Status per stage is
 *          derived from the FixAttempt fields — we never invent data.
 */

import type { Edge, Node } from '@xyflow/react'
import type { PdcaStageId } from '../../lib/pdca'
import type { FixAttempt } from './types'
import { STAGE_HEX } from '../flow-primitives/flowTokens'

export type FixStageStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped'

export interface FixStageNodeData extends Record<string, unknown> {
  stageKey: string
  pdcaStage: PdcaStageId
  letter: string
  label: string
  sublabel?: string
  status: FixStageStatus
  href?: string | null
  external?: boolean
}

export interface FixEdgeData extends Record<string, unknown> {
  fromColor: string
  toColor: string
  active: boolean
}

const NODE_Y = 40
const NODE_GAP = 170

const STAGE_ORDER: Array<{ key: string; pdca: PdcaStageId; letter: string; label: string }> = [
  { key: 'report', pdca: 'plan', letter: 'P', label: 'Report' },
  { key: 'dispatch', pdca: 'do', letter: 'D', label: 'Dispatch' },
  { key: 'pr', pdca: 'do', letter: 'D', label: 'Draft PR' },
  { key: 'judge', pdca: 'check', letter: 'C', label: 'Judge' },
  { key: 'act', pdca: 'act', letter: 'A', label: 'Ship' },
]

export function buildFixAttemptNodes(fix: FixAttempt): Node<FixStageNodeData>[] {
  const statuses = deriveStatuses(fix)
  return STAGE_ORDER.map((s, i) => ({
    id: `${fix.id}:${s.key}`,
    type: 'fixStage',
    position: { x: i * NODE_GAP, y: NODE_Y },
    draggable: false,
    connectable: false,
    selectable: false,
    data: {
      stageKey: s.key,
      pdcaStage: s.pdca,
      letter: s.letter,
      label: s.label,
      sublabel: subLabelFor(s.key, fix),
      status: statuses[s.key] ?? 'pending',
      href: hrefFor(s.key, fix),
      external: s.key === 'pr' && !!fix.pr_url,
    },
  }))
}

export function buildFixAttemptEdges(fix: FixAttempt): Edge<FixEdgeData>[] {
  const statuses = deriveStatuses(fix)
  return STAGE_ORDER.slice(0, -1).map((s, i) => {
    const next = STAGE_ORDER[i + 1]
    const active =
      (statuses[s.key] === 'done' && (statuses[next.key] === 'active' || statuses[next.key] === 'done')) ||
      statuses[s.key] === 'active'
    return {
      id: `${fix.id}:${s.key}->${next.key}`,
      source: `${fix.id}:${s.key}`,
      target: `${fix.id}:${next.key}`,
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

function deriveStatuses(fix: FixAttempt): Record<string, FixStageStatus> {
  const status = fix.status?.toLowerCase()
  const ci = fix.check_run_conclusion?.toLowerCase()
  const reviewPassed = fix.review_passed
  const hasPr = !!fix.pr_url
  const failed = status === 'failed'

  const report: FixStageStatus = 'done'
  const dispatch: FixStageStatus =
    status === 'queued' ? 'active' : status === 'running' ? 'done' : failed ? 'failed' : 'done'
  const pr: FixStageStatus =
    status === 'running'
      ? 'active'
      : hasPr
        ? 'done'
        : failed
          ? 'failed'
          : dispatch === 'done'
            ? 'pending'
            : 'pending'
  const judge: FixStageStatus =
    reviewPassed === true
      ? 'done'
      : reviewPassed === false
        ? 'failed'
        : pr === 'done'
          ? 'active'
          : 'pending'
  const act: FixStageStatus =
    ci === 'success'
      ? 'done'
      : ci === 'failure' || ci === 'timed_out'
        ? 'failed'
        : judge === 'done'
          ? 'pending'
          : 'pending'

  return { report, dispatch, pr, judge, act }
}

function subLabelFor(key: string, fix: FixAttempt): string | undefined {
  switch (key) {
    case 'report':
      return `#${fix.report_id.slice(0, 6)}`
    case 'dispatch':
      return fix.llm_model ? fix.llm_model : fix.agent
    case 'pr':
      return fix.pr_number ? `#${fix.pr_number}` : fix.branch ? truncate(fix.branch, 20) : undefined
    case 'judge':
      return fix.review_passed === true ? 'passed' : fix.review_passed === false ? 'flagged' : undefined
    case 'act':
      return fix.check_run_conclusion ?? fix.check_run_status ?? undefined
  }
  return undefined
}

function hrefFor(key: string, fix: FixAttempt): string | null {
  switch (key) {
    case 'report':
      return `/reports/${fix.report_id}`
    case 'dispatch':
      return '/fixes'
    case 'pr':
      return fix.pr_url ?? null
    case 'judge':
      return '/judge'
    case 'act':
      return '/integrations'
  }
  return null
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}
