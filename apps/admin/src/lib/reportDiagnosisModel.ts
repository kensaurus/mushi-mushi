/**
 * FILE: apps/admin/src/lib/reportDiagnosisModel.ts
 * PURPOSE: Types and constants for the report page's diagnosis graph
 *          ("How Mushi reached this diagnosis"). Builders live in
 *          reportDiagnosisNodes.ts, assembly in reportDiagnosisGraph.ts.
 */

export type DiagnosisLane = 'evidence' | 'signal' | 'diagnosis' | 'check' | 'fix'

export const DIAGNOSIS_LANES: ReadonlyArray<{ id: DiagnosisLane; label: string; hint: string }> = [
  { id: 'evidence', label: 'Evidence', hint: 'What came in' },
  { id: 'signal', label: 'Signals', hint: 'What the fast filter read' },
  { id: 'diagnosis', label: 'Diagnosis', hint: 'What Mushi concluded' },
  { id: 'check', label: 'Checks', hint: 'How sure it is' },
  { id: 'fix', label: 'Fix', hint: 'What was tried, what is next' },
]

/** observed: a fact; ok / weak / failed: a claim and how it held up; pending: not there yet; open: a step for you. */
type DiagnosisNodeState = 'observed' | 'ok' | 'weak' | 'failed' | 'pending' | 'open' | 'done'

export interface DiagnosisNode {
  id: string
  lane: DiagnosisLane
  title: string
  /** One short line under the title: counts, model, date. */
  detail: string
  state: DiagnosisNodeState
  /** 0–1 when the claim carries a model confidence or judge score. */
  confidence: number | null
  /** Under NEEDS_LOOK_BELOW, failed, or missing input a fix depends on. */
  needsLook: boolean
  /** The plain-language reasoning shown in the side panel. */
  why: string
  /** The report field the node was read from, for people who want the raw value. */
  source: string
  /** Section id on the report page that holds the underlying evidence. */
  anchor?: string
  /** External link (pull request). */
  href?: string
}

export interface DiagnosisGraph {
  nodes: DiagnosisNode[]
  /** Directed: [from, to]; both ends exist in `nodes`. */
  edges: Array<[string, string]>
  /** The chain of reasoning, in order, as node ids. */
  path: string[]
  verdict: { tone: 'ok' | 'warn' | 'danger' | 'info'; label: string }
}

/** Claims below this confidence get a "needs a look" mark. */
export const NEEDS_LOOK_BELOW = 0.8

/** Section anchors on the report page (ReportDetailPage). */
export const DIAGNOSIS_ANCHORS = {
  diagnosis: 'report-diagnosis',
  userReport: 'report-user-report',
  console: 'report-console-logs',
  network: 'report-network',
  performance: 'report-performance',
  classification: 'report-classification',
} as const

/** First sentence, cut at a word near `max` characters. */
export function headline(value: string, max = 110): string {
  const first = value.split(/(?<=[.!?])\s/)[0] ?? value
  if (first.length <= max) return first
  const cut = first.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`
}
