/**
 * FILE: apps/admin/src/components/report-detail/PdcaReceiptStrip.tsx
 * PURPOSE: Compact PDCA receipt for a single report. Sister to
 *          components/fixes/PdcaReceipt — same 4-stage shape but rendered as
 *          a horizontal strip with 1-line proof per stage so it fits under
 *          the report-detail PageHeader without crowding the triage bar.
 *
 *          Stage mapping (audit P0):
 *            Plan  = report received + classified (classification judge shown here)
 *            Do    = fix attempt dispatched (or finished, or blocked_setup)
 *            Check = CI on the fix PR (only meaningful after DO is done/pending)
 *            Act   = PR merged AND report status = fixed
 *
 *          IMPORTANT: the classification judge (judge_eval) evaluates whether
 *          the LLM's severity/category call was accurate. It is a PLAN-phase
 *          signal, NOT a Check signal. Only surface judge data in Check when a
 *          fix was actually dispatched so the CI feedback is relevant.
 */

import { PDCA_ORDER, PDCA_STAGES, type PdcaStageId } from '../../lib/pdca'
import { STAMP_VISUAL, type StageStamp } from '../../lib/pdcaStamp'
import { ActionPill } from './ReportSurface'
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
            className={`relative overflow-hidden px-2.5 py-2 rounded-md border ${v.shell}`}
            data-stamp={r.stamp}
          >
            <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wider">
              <span
                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm font-semibold text-3xs ${meta.badgeBg} ${meta.badgeFg}`}
              >
                {meta.letter}
              </span>
              <span className={r.stamp === 'idle' ? 'text-fg-faint' : 'text-fg-muted'}>{meta.label}</span>
              <Stamp stamp={r.stamp} />
            </div>
            {/* Proof text: long file-paths must break anywhere (no spaces) and
                be capped at 3 lines so they never escape the card boundary. */}
            <p
              title={r.proof}
              className={`mt-1 text-2xs leading-snug [overflow-wrap:anywhere] line-clamp-3 ${
                r.stamp === 'idle' ? 'text-fg-faint' : 'text-fg-secondary'
              }`}
            >
              {r.proof}
            </p>
            {r.link && (
              r.link.href.startsWith('http') ? (
                <ActionPill href={r.link.href} tone="brand" className="mt-1.5">
                  {r.link.label} ↗
                </ActionPill>
              ) : (
                <ActionPill to={r.link.href} tone="brand" className="mt-1.5">
                  {r.link.label} →
                </ActionPill>
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
      className={`ml-auto flex items-center gap-1 text-3xs font-semibold ${v.copy}`}
      aria-label={`Status: ${v.label}`}
    >
      <span aria-hidden="true" className="font-mono text-3xs leading-none">{v.glyph}</span>
      {v.label}
    </span>
  )
}

function buildStripReceipts(
  report: ReportDetail,
  dispatchState: DispatchState,
): Record<PdcaStageId, StageReceipt> {
  const fix: ReportFixAttempt | undefined = report.fix_attempts?.[0]
  // judge_eval = classification quality judge (did LLM classify accurately?)
  // This is a PLAN-phase signal, not a CHECK/fix-quality signal.
  const classificationJudge = report.judge_eval ?? null
  const status = report.status?.toLowerCase() ?? ''
  const fixStatus = fix?.status?.toLowerCase() ?? ''
  const ciConclusion = fix?.check_run_conclusion?.toLowerCase() ?? null
  const liveStatus = dispatchState.status

  // PLAN — report received + classified. Surface classification judge score here
  // (it evaluates accuracy of the LLM's category/severity call).
  const classified = Boolean(report.stage1_classification) || Boolean(report.classified_at)
  const planStamp: StageStamp = report.processing_error
    ? 'failed'
    : classified
      ? 'done'
      : 'pending'
  const planProof = (() => {
    if (report.processing_error) return `Classification failed — ${report.processing_error}`
    if (!classified) return 'Received — classification still running'
    const base = `Received & classified${report.severity ? ` (${report.severity})` : ''}`
    if (classificationJudge?.judge_score != null) {
      const score = (classificationJudge.judge_score * 100).toFixed(0)
      const agreed = classificationJudge.classification_agreed !== false
      return `${base} · classifier judge ${agreed ? 'agreed' : 'flagged'} (${score}%)`
    }
    return base
  })()
  const plan: StageReceipt = { id: 'plan', stamp: planStamp, proof: planProof }

  // DO — agentic fix dispatched? Use the persisted fix_attempt first, then the
  // live dispatchState (in case the user just dispatched on this page).
  const inFlight =
    liveStatus === 'queueing' ||
    liveStatus === 'queued' ||
    liveStatus === 'running' ||
    fixStatus === 'in_progress' ||
    status === 'fixing'
  const fixWasAttempted = Boolean(fix) || (liveStatus !== 'idle' && liveStatus !== 'failed') || status === 'fixed'
  const blockedSetup = liveStatus === 'completed_no_pr' || fixStatus === 'completed_no_pr'

  let doStamp: StageStamp = 'idle'
  if (fix?.pr_url || (liveStatus === 'completed' && dispatchState.prUrl)) doStamp = 'done'
  else if (blockedSetup) doStamp = 'pending'  // amber — fix generated but setup missing
  else if (fixStatus === 'failed' || liveStatus === 'failed') doStamp = 'failed'
  else if (inFlight || fixWasAttempted) doStamp = 'pending'

  const doProof = (() => {
    if (fix?.pr_url) {
      const fileCount = fix.files_changed?.length ?? 0
      return `Fix dispatched — ${fileCount > 0 ? `${fileCount} file${fileCount === 1 ? '' : 's'} changed` : 'PR opened'}`
    }
    if (liveStatus === 'completed' && dispatchState.prUrl) return 'Fix dispatched — PR opened just now'
    if (blockedSetup) return 'Fix generated — GitHub App not installed (connect repo to push PR)'
    if (inFlight) return `Fix in flight (${fix?.agent ?? 'auto-fix agent'})`
    if (fixStatus === 'failed') return `Last attempt failed — ${fix?.error ?? 'see fixes page'}`
    if (liveStatus === 'failed') return `Dispatch failed — ${dispatchState.error ?? 'see fixes page'}`
    if (fixWasAttempted) return 'Fix attempt recorded'
    return 'No fix dispatched yet'
  })()
  const doLink = fix?.pr_url
    ? { href: fix.pr_url, label: `PR${fix.pr_number ? ` #${fix.pr_number}` : ''}` }
    : dispatchState.prUrl
      ? { href: dispatchState.prUrl, label: 'Review PR' }
      : blockedSetup
        ? { href: '/repo', label: 'Connect repo' }
        : doStamp !== 'idle'
          ? { href: '/fixes', label: 'Open fix pipeline' }
          : undefined
  const doReceipt: StageReceipt = { id: 'do', stamp: doStamp, proof: doProof, link: doLink }

  // CHECK — CI on the fix PR, or the fix-quality judge (after DO completes).
  // Only meaningful once a fix was actually dispatched. The classification
  // judge lives in PLAN — do NOT bleed it here when no fix was attempted.
  const fixAttempted = Boolean(fix) || liveStatus === 'completed' || liveStatus === 'completed_no_pr'
  let checkStamp: StageStamp = 'idle'
  if (fixAttempted) {
    if (ciConclusion === 'success') checkStamp = 'done'
    else if (ciConclusion === 'failure' || ciConclusion === 'timed_out') checkStamp = 'failed'
    else if (fix?.pr_url) checkStamp = 'pending'
    // completed_no_pr: no PR so no CI — stay idle for check
  }
  const checkProof = (() => {
    if (!fixAttempted) return 'Waiting for a fix to be dispatched'
    if (ciConclusion === 'success') return 'Fix CI passed'
    if (ciConclusion === 'failure') return 'Fix CI failed'
    if (ciConclusion === 'timed_out') return 'Fix CI timed out'
    if (fix?.pr_url) return 'CI running on the PR'
    if (blockedSetup) return 'No PR to check — connect repo first'
    return 'No CI signal yet'
  })()
  const check: StageReceipt = { id: 'check', stamp: checkStamp, proof: checkProof }

  // ACT — report is fixed AND a PR was merged.
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
