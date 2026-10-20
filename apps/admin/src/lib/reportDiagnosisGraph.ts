/**
 * FILE: apps/admin/src/lib/reportDiagnosisGraph.ts
 * PURPOSE: The report page's "How Mushi reached this diagnosis" graph, as
 *          data. Each node is one claim Mushi made or one piece of evidence it
 *          read, placed in one of five lanes (evidence → signals → diagnosis →
 *          checks → fix), with its confidence, a "needs a look" mark below
 *          0.8, the plain-language reasoning and the field it came from.
 *
 *          Everything is read from the ReportDetail payload the page already
 *          loads; the row is model output and may be partial, so every field
 *          is read defensively. Pure and side-effect free, so the component
 *          stays UI-only and the rules are unit-tested.
 *
 *          Types and constants: reportDiagnosisModel.ts. Lane builders:
 *          reportDiagnosisNodes.ts. This file wires the edges, the path and
 *          the verdict.
 *
 *          Console audit 2026-10-20: "The story so far" said *where* a report
 *          was in Plan → Do → Check → Act but not *why* Mushi believed its
 *          diagnosis, or which claim was weak. A newcomer could not tell a
 *          confident root cause from a guess.
 */

import { NEEDS_LOOK_BELOW, type DiagnosisGraph, type DiagnosisNode } from './reportDiagnosisModel'
import { checkNodes, diagnosisNodes, evidenceNodes, fixNodes, signalNodes } from './reportDiagnosisNodes'
import type { ReportDetail } from '../components/report-detail/types'

function verdictFor(report: ReportDetail, byId: Map<string, DiagnosisNode>): DiagnosisGraph['verdict'] {
  const status = (report.status ?? '').toLowerCase()
  const cause = byId.get('cause')
  const judge = byId.get('judge')
  if (status === 'verified') return { tone: 'ok', label: 'Fixed and verified' }
  if (status === 'fixed' || byId.get('attempt')?.state === 'done') return { tone: 'ok', label: 'Fixed' }
  if (cause?.state === 'failed') return { tone: 'danger', label: 'Diagnosis failed' }
  if (cause?.state === 'pending') return { tone: 'info', label: 'Diagnosis in progress' }
  if (judge?.title.startsWith('Judge disagrees')) return { tone: 'warn', label: 'Judge disagrees: check the triage' }
  const confident = cause?.confidence != null && cause.confidence >= NEEDS_LOOK_BELOW
  if (confident && judge?.state === 'ok') return { tone: 'ok', label: 'Diagnosis confirmed by the judge' }
  if (confident) return { tone: 'info', label: 'Confident diagnosis, not graded yet' }
  return { tone: 'warn', label: 'Likely cause, not confirmed' }
}

export function buildDiagnosisGraph(report: ReportDetail): DiagnosisGraph {
  const diagnosis = diagnosisNodes(report)
  const nodes = [
    ...evidenceNodes(report),
    ...signalNodes(report),
    ...diagnosis,
    ...checkNodes(report),
    ...fixNodes(report, diagnosis.some((n) => n.id === 'cause' && (n.state === 'ok' || n.state === 'weak'))),
  ]
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const has = (id: string) => byId.has(id)

  const raw: Array<[string, string]> = []
  const firstClaim = has('symptom') ? 'symptom' : 'cause'
  raw.push(['report', firstClaim])
  for (const ev of ['browser', 'console', 'network', 'perf', 'screenshot', 'sentry']) raw.push([ev, has('cause') ? 'cause' : firstClaim])
  raw.push(['symptom', 'cause'], ['similar', 'cause'], ['code', 'cause'], ['code', 'component'])
  raw.push(['cause', 'component'], ['cause', 'fixdir'], ['component', 'fixdir'])
  raw.push(['cause', 'judge'], ['component', 'judge'], ['symptom', 'repro'], ['cause', 'repro'])
  raw.push(['fixdir', 'attempt'], ['repro', 'attempt'], ['attempt', 'next'], ['judge', 'next'])
  if (!has('attempt')) raw.push(['fixdir', 'next'], ['repro', 'next'])
  const seen = new Set<string>()
  const edges = raw.filter(([a, b]) => {
    const key = `${a}>${b}`
    if (!has(a) || !has(b) || a === b || seen.has(key)) return false
    seen.add(key)
    return true
  })

  const path = ['report', 'symptom', 'cause', 'component', 'judge', 'repro', 'attempt', 'next'].filter(has)
  return { nodes, edges, path, verdict: verdictFor(report, byId) }
}

/** The node to open first: the first marked node on the path, else the root cause. */
export function initialDiagnosisSelection(graph: DiagnosisGraph): string | null {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  return graph.path.find((id) => byId.get(id)?.needsLook) ?? (byId.has('cause') ? 'cause' : graph.path[0] ?? null)
}
