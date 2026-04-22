/**
 * FILE: apps/admin/src/components/report-detail/PdcaReceiptStrip.tsx
 * PURPOSE: Compact PDCA receipt for a single report. Sister to
 *          components/fixes/PdcaReceipt — same 4-stage shape but rendered as
 *          a horizontal strip with 1-line proof per stage so it fits under
 *          the report-detail PageHeader without crowding the triage bar.
 *
 *          Stage mapping (audit P0):
 *            Plan  = report received + (classified | pending)
 *            Do    = fix attempt dispatched (or finished)
 *            Check = judge eval ran on the classification
 *            Act   = PR merged AND report status = fixed
 */

import { Link } from 'react-router-dom'
import { PDCA_ORDER, PDCA_STAGES, type PdcaStageId } from '../../lib/pdca'
import { STAMP_VISUAL, type StageStamp } from '../../lib/pdcaStamp'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail, ReportFixAttempt } from './types'

interface StageReceipt {
  id: PdcaStageId
  stamp: StageStamp
  proof: string
  link?: { href: string; label: string }
}

interface Props {
  report: ReportDetail
  dispatchState: DispatchState
  className?: string
}

export function PdcaReceiptStrip({ report, dispatchState, className = '' }: Props) {
  const receipts = buildStripReceipts(report, dispatchState)
  return (
    <ol
      className={`grid grid-cols-2 lg:grid-cols-4 gap-2 ${className}`}
      aria-label="PDCA receipt for this report"
    >
      {PDCA_ORDER.map((id) => {
        const meta = PDCA_STAGES[id]
        const r = receipts[id]
        const v = STAMP_VISUAL[r.stamp]
        return (
          <li
            key={id}
            className={`relative px-2.5 py-2 rounded-md border ${v.shell}`}
            data-stamp={r.stamp}
          >
            <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wider">
              <span
                className={`inline-flex h-4 w-4 items-center justify-center rounded-sm font-semibold text-[10px] ${meta.badgeBg} ${meta.badgeFg}`}
              >
                {meta.letter}
              </span>
              <span className={r.stamp === 'idle' ? 'text-fg-faint' : 'text-fg-muted'}>{meta.label}</span>
              <Stamp stamp={r.stamp} />
            </div>
            <p className={`mt-1 text-2xs leading-snug line-clamp-2 ${r.stamp === 'idle' ? 'text-fg-faint' : 'text-fg-secondary'}`}>{r.proof}</p>
            {r.link && (
              r.link.href.startsWith('http') ? (
                <a
                  href={r.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-2xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
                >
                  {r.link.label}
                </a>
              ) : (
                <Link
                  to={r.link.href}
                  className="mt-1 inline-block text-2xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
                >
                  {r.link.label}
                </Link>
              )
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Stamp({ stamp }: { stamp: StageStamp }) {
  const v = STAMP_VISUAL[stamp]
  return (
    <span
      className={`ml-auto flex items-center gap-1 text-[10px] font-semibold ${v.copy}`}
      aria-label={`Status: ${v.label}`}
    >
      <span aria-hidden="true" className="font-mono text-[11px] leading-none">{v.glyph}</span>
      {v.label}
    </span>
  )
}

function buildStripReceipts(
  report: ReportDetail,
  dispatchState: DispatchState,
): Record<PdcaStageId, StageReceipt> {
  const fix: ReportFixAttempt | undefined = report.fix_attempts?.[0]
  const judge = report.judge_eval ?? null
  const status = report.status?.toLowerCase() ?? ''
  const fixStatus = fix?.status?.toLowerCase() ?? ''
  const ciConclusion = fix?.check_run_conclusion?.toLowerCase() ?? null

  // PLAN — report exists; classification done if stage1_classification or
  // classified_at is set. If classification failed, surface the failure here.
  const classified = Boolean(report.stage1_classification) || Boolean(report.classified_at)
  const planStamp: StageStamp = report.processing_error
    ? 'failed'
    : classified
      ? 'done'
      : 'pending'
  const planProof = report.processing_error
    ? `Classification failed — ${report.processing_error}`
    : classified
      ? `Received & classified${report.severity ? ` (${report.severity})` : ''}`
      : 'Received — classification still running'
  const plan: StageReceipt = { id: 'plan', stamp: planStamp, proof: planProof }

  // DO — agentic fix dispatched? Use the persisted fix_attempt first, then the
  // live dispatchState (in case the user just dispatched on this page).
  const liveStatus = dispatchState.status
  const inFlight =
    liveStatus === 'queueing' || liveStatus === 'queued' || liveStatus === 'running' || fixStatus === 'in_progress' || status === 'fixing'
  const dispatched = Boolean(fix) || liveStatus !== 'idle' || status === 'fixed'
  let doStamp: StageStamp = 'idle'
  if (fix?.pr_url || fix?.files_changed?.length || liveStatus === 'completed') doStamp = 'done'
  else if (fixStatus === 'failed' || liveStatus === 'failed') doStamp = 'failed'
  else if (inFlight || dispatched) doStamp = 'pending'
  const doProof = (() => {
    if (fix?.pr_url) {
      const fileCount = fix.files_changed?.length ?? 0
      return `Fix dispatched — ${fileCount > 0 ? `${fileCount} file${fileCount === 1 ? '' : 's'} changed` : 'PR opened'}`
    }
    if (liveStatus === 'completed' && dispatchState.prUrl) return 'Fix dispatched — PR opened just now'
    if (inFlight) return `Fix in flight (${fix?.agent ?? 'auto-fix agent'})`
    if (fixStatus === 'failed') return `Last attempt failed — ${fix?.error ?? 'see fixes page'}`
    if (dispatched) return 'Fix attempt recorded'
    return 'No fix dispatched yet'
  })()
  const doLink = fix?.pr_url
    ? { href: fix.pr_url, label: `PR${fix.pr_number ? ` #${fix.pr_number}` : ''}` }
    : dispatchState.prUrl
      ? { href: dispatchState.prUrl, label: 'Review PR' }
      : doStamp !== 'idle'
        ? { href: '/fixes', label: 'Open fix pipeline' }
        : undefined
  const doReceipt: StageReceipt = { id: 'do', stamp: doStamp, proof: doProof, link: doLink }

  // CHECK — judge evaluated the classification (independent grader). If the
  // CI conclusion on the linked fix is conclusive, surface that too.
  let checkStamp: StageStamp = 'idle'
  if (judge) checkStamp = judge.classification_agreed === false ? 'failed' : 'done'
  else if (ciConclusion === 'success') checkStamp = 'done'
  else if (ciConclusion === 'failure' || ciConclusion === 'timed_out') checkStamp = 'failed'
  else if (fix?.pr_url) checkStamp = 'pending'
  const checkProof = (() => {
    if (judge) {
      const score = judge.judge_score != null ? `score ${(judge.judge_score * 100).toFixed(0)}%` : 'judge score n/a'
      const verdict = judge.classification_agreed === false ? 'judge disagreed' : 'judge agreed'
      return `Judge evaluated — ${verdict} (${score})`
    }
    if (ciConclusion) return `Fix CI: ${ciConclusion.replace(/_/g, ' ')}`
    if (fix?.pr_url) return 'CI running on the PR'
    return 'No judge or CI signal yet'
  })()
  const check: StageReceipt = { id: 'check', stamp: checkStamp, proof: checkProof }

  // ACT — report is fixed AND a PR was merged. We use report.status === 'fixed'
  // as the canonical signal; the merged PR is the proof.
  let actStamp: StageStamp = 'idle'
  if (status === 'fixed') actStamp = 'done'
  else if (fixStatus === 'failed' || status === 'dismissed') actStamp = 'failed'
  else if (fix?.pr_url || ciConclusion === 'success') actStamp = 'pending'
  const actProof = (() => {
    if (status === 'fixed') return 'Loop closed — report marked fixed'
    if (status === 'dismissed') return 'Loop closed — report dismissed (no fix)'
    if (actStamp === 'pending') return 'Awaiting merge / mark-as-fixed'
    if (fixStatus === 'failed') return `Loop blocked — ${fix?.error ?? 'fix attempt failed'}`
    return 'Not yet — needs fix + check first'
  })()
  const actLink = fix?.pr_url && actStamp === 'pending'
    ? { href: fix.pr_url, label: 'Review & merge' }
    : undefined
  const act: StageReceipt = { id: 'act', stamp: actStamp, proof: actProof, link: actLink }

  return { plan, do: doReceipt, check, act }
}
