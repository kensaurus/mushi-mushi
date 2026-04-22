/**
 * FILE: apps/admin/src/components/report-detail/ReportPdcaStory.tsx
 * PURPOSE: Vertical PDCA story timeline rendered above <PdcaReceiptStrip>
 * on the report-detail page
 *
 *          PdcaReceiptStrip is a compact 4-up grid of "what state is each
 *          stage in" — useful for at-a-glance triage. This timeline is
 *          the storytelling cousin: it walks the user through what
 *          happened to *their* bug across Plan → Do → Check → Act, with
 *          per-stage timestamps, model identifiers, and judge scores.
 *
 *          Visual:
 *
 *            ●━━━━ Plan        Classified 2 min ago by Haiku → Sonnet
 *            ┃              "submit-button-broken" • severity: high
 *            ●━━━━ Do          Dispatched to claude-code · branch fix/123
 *            ┃              PR #482 opened
 *            ◐━━━━ Check       Judge agreed (94%) · CI running
 *            ┃              [thumbnail of screenshot diff if present]
 *            ○      Act         Awaiting merge
 *
 *          Re-uses derivation logic shape from PdcaReceiptStrip — every
 *          stage stamp + proof is computed from the same `report` shape so
 *          the two surfaces never disagree on what state the loop is in.
 */

import { Link } from 'react-router-dom'
import { PDCA_ORDER, PDCA_STAGES, type PdcaStageId } from '../../lib/pdca'
import { STAMP_VISUAL, type StageStamp } from '../../lib/pdcaStamp'
import { RelativeTime } from '../ui'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail, ReportFixAttempt } from './types'

type StoryState = StageStamp

interface StoryNode {
  id: PdcaStageId
  state: StoryState
  /** One-line headline summarising what happened at this stage. */
  headline: string
  /** Optional iso timestamp for "X ago" relative time. */
  at?: string | null
  /** Up to 3 chips with extra context (model name, branch, score). */
  details?: Array<string | null | undefined>
  /** Optional link out (PR, Langfuse trace, /fixes deep link). */
  link?: { href: string; label: string }
  /** Optional screenshot URL to render as a 56x40 thumbnail. */
  thumbnail?: string | null
}

interface Props {
  report: ReportDetail
  dispatchState: DispatchState
}

export function ReportPdcaStory({ report, dispatchState }: Props) {
  const nodes = buildStoryNodes(report, dispatchState)
  return (
    <ol
      aria-label="PDCA story for this report"
      className="relative mb-3 rounded-lg border border-edge-subtle bg-surface-raised/30 p-3 motion-safe:animate-mushi-fade-in"
    >
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">
          The story so far
        </h3>
        <span className="text-3xs text-fg-faint">Plan → Do → Check → Act</span>
      </header>
      {PDCA_ORDER.map((id, idx) => {
        const node = nodes[id]
        const isLast = idx === PDCA_ORDER.length - 1
        return <StoryRow key={id} node={node} isLast={isLast} />
      })}
    </ol>
  )
}

function StoryRow({ node, isLast }: { node: StoryNode; isLast: boolean }) {
  const meta = PDCA_STAGES[node.id]
  const v = STAMP_VISUAL[node.state]
  const isDone = node.state === 'done'
  const isIdle = node.state === 'idle'
  const detailsClean = (node.details ?? []).filter((d): d is string => Boolean(d && d.trim()))
  return (
    <li className={`relative pl-7 pb-3 last:pb-0 ${isIdle ? 'opacity-75' : ''}`}>
      {/* Vertical connector line. Coloured green for completed stages so the
          loop visually "fills in" top-down as work lands — gives the whole
          timeline a progress-bar feel. Skipped on last row. */}
      {!isLast && (
        <span
          aria-hidden="true"
          className={`absolute left-[10px] top-3.5 bottom-0 w-px ${
            isDone ? 'bg-ok/40' : 'bg-edge-subtle'
          }`}
        />
      )}
      {/* Stage dot — done gets a filled green disc with ✓, idle is a hollow
          dashed ring, pending pulses, failed is a filled red disc with ✕. */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
          isDone
            ? 'bg-ok text-ok-fg mushi-glow-ok'
            : node.state === 'failed'
              ? 'bg-danger text-white mushi-glow-danger'
              : node.state === 'pending'
                ? `ring-2 ${v.ring} ${v.dot} mushi-pulse`
                : `ring-2 ring-dashed ${v.ring} bg-transparent`
        }`}
      >
        {isDone ? '✓' : node.state === 'failed' ? '✕' : ''}
      </span>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={`inline-flex h-4 w-4 items-center justify-center rounded-sm font-semibold text-[10px] ${meta.badgeBg} ${meta.badgeFg}`}
          aria-hidden="true"
        >
          {meta.letter}
        </span>
        <span className={`text-xs font-semibold ${isIdle ? 'text-fg-muted' : 'text-fg'}`}>{meta.label}</span>
        <span className={`text-2xs font-semibold ${v.copy}`} aria-label={`Status: ${v.label}`}>
          {v.glyph} {v.label}
        </span>
        {node.at && (
          <span className="text-2xs text-fg-faint ml-auto">
            <RelativeTime value={node.at} />
          </span>
        )}
      </div>
      <p className={`mt-0.5 text-xs leading-snug ${isIdle ? 'text-fg-faint' : 'text-fg-secondary'}`}>{node.headline}</p>
      {(detailsClean.length > 0 || node.thumbnail || node.link) && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {node.thumbnail && (
            <a
              href={node.thumbnail}
              target="_blank"
              rel="noopener noreferrer"
              className="block h-10 w-14 overflow-hidden rounded-sm border border-edge-subtle hover:border-brand/50 motion-safe:transition-colors"
              title="Open screenshot in new tab"
            >
              <img
                src={node.thumbnail}
                alt="Screenshot proof"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </a>
          )}
          {detailsClean.map((d, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-sm border border-edge-subtle bg-surface-overlay/40 px-1.5 py-0.5 text-3xs font-mono text-fg-muted"
            >
              {d}
            </span>
          ))}
          {node.link && (
            node.link.href.startsWith('http') ? (
              <a
                href={node.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-2xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
              >
                {node.link.label} ↗
              </a>
            ) : (
              <Link
                to={node.link.href}
                className="text-2xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
              >
                {node.link.label} →
              </Link>
            )
          )}
        </div>
      )}
    </li>
  )
}

function buildStoryNodes(
  report: ReportDetail,
  dispatchState: DispatchState,
): Record<PdcaStageId, StoryNode> {
  const fix: ReportFixAttempt | undefined = report.fix_attempts?.[0]
  const judge = report.judge_eval ?? null
  const status = report.status?.toLowerCase() ?? ''
  const fixStatus = fix?.status?.toLowerCase() ?? ''
  const ciConclusion = fix?.check_run_conclusion?.toLowerCase() ?? null

  // PLAN — classification metadata
  const classified = Boolean(report.stage1_classification) || Boolean(report.classified_at)
  const planState: StoryState = report.processing_error
    ? 'failed'
    : classified
      ? 'done'
      : 'pending'
  const planHeadline = report.processing_error
    ? `Classification failed — ${report.processing_error}`
    : classified
      ? report.summary || `Classified as ${report.category}`
      : 'Report received — the LLM is classifying it now'
  const plan: StoryNode = {
    id: 'plan',
    state: planState,
    headline: planHeadline,
    at: report.classified_at ?? report.created_at,
    details: [
      report.severity ? `severity: ${report.severity}` : null,
      report.confidence != null ? `conf ${(report.confidence * 100).toFixed(0)}%` : null,
      report.stage1_model || null,
      report.stage1_latency_ms != null ? `${report.stage1_latency_ms}ms` : null,
    ],
  }

  // DO — dispatch metadata
  const liveStatus = dispatchState.status
  const inFlight =
    liveStatus === 'queueing' ||
    liveStatus === 'queued' ||
    liveStatus === 'running' ||
    fixStatus === 'in_progress' ||
    status === 'fixing'
  const dispatched = Boolean(fix) || liveStatus !== 'idle' || status === 'fixed'
  let doState: StoryState = 'idle'
  if (fix?.pr_url || (fix?.files_changed?.length ?? 0) > 0 || liveStatus === 'completed') {
    doState = 'done'
  } else if (fixStatus === 'failed' || liveStatus === 'failed') {
    doState = 'failed'
  } else if (inFlight || dispatched) {
    doState = 'pending'
  }
  const doHeadline = (() => {
    if (fix?.pr_url) {
      const fileCount = fix.files_changed?.length ?? 0
      return fileCount > 0
        ? `Fix dispatched — ${fileCount} file${fileCount === 1 ? '' : 's'} changed, draft PR opened`
        : 'Fix dispatched — draft PR opened'
    }
    if (liveStatus === 'completed' && dispatchState.prUrl) return 'Fix dispatched — PR opened just now'
    if (inFlight) return 'Auto-fix agent is drafting the PR right now'
    if (fixStatus === 'failed') return `Last attempt failed — ${fix?.error ?? 'see fixes page'}`
    if (dispatched) return 'Fix attempt recorded'
    return 'No fix dispatched yet — click "Send to auto-fix" to start'
  })()
  const doLink = fix?.pr_url
    ? { href: fix.pr_url, label: `PR${fix.pr_number ? ` #${fix.pr_number}` : ''}` }
    : dispatchState.prUrl
      ? { href: dispatchState.prUrl, label: 'Review PR' }
      : doState !== 'idle'
        ? { href: '/fixes', label: 'Open fix pipeline' }
        : undefined
  const doNode: StoryNode = {
    id: 'do',
    state: doState,
    headline: doHeadline,
    at: fix?.completed_at ?? fix?.started_at ?? fix?.created_at ?? null,
    details: [
      fix?.agent ? `via ${fix.agent}` : null,
      fix?.branch || null,
      fix?.lines_changed != null ? `${fix.lines_changed} loc` : null,
    ],
    link: doLink,
  }

  // CHECK — judge + CI
  let checkState: StoryState = 'idle'
  if (judge) checkState = judge.classification_agreed === false ? 'failed' : 'done'
  else if (ciConclusion === 'success') checkState = 'done'
  else if (ciConclusion === 'failure' || ciConclusion === 'timed_out') checkState = 'failed'
  else if (fix?.pr_url) checkState = 'pending'
  const checkHeadline = (() => {
    if (judge) {
      const verdict = judge.classification_agreed === false ? 'judge disagreed with the classifier' : 'judge agreed with the classifier'
      const trimmedReason = judge.judge_reasoning?.trim()
      return trimmedReason ? `${verdict} — ${trimmedReason}` : verdict
    }
    if (ciConclusion) return `Fix CI: ${ciConclusion.replace(/_/g, ' ')}`
    if (fix?.pr_url) return 'CI is running on the PR'
    return 'No judge or CI signal yet — runs once a fix is dispatched'
  })()
  const check: StoryNode = {
    id: 'check',
    state: checkState,
    headline: checkHeadline,
    at: judge?.created_at ?? null,
    details: [
      judge?.judge_score != null ? `judge ${(judge.judge_score * 100).toFixed(0)}%` : null,
      ciConclusion ? `CI ${ciConclusion.replace(/_/g, ' ')}` : null,
    ],
    thumbnail: report.screenshot_url ?? null,
  }

  // ACT — merge + close
  let actState: StoryState = 'idle'
  if (status === 'fixed') actState = 'done'
  else if (fixStatus === 'failed' || status === 'dismissed') actState = 'failed'
  else if (fix?.pr_url || ciConclusion === 'success') actState = 'pending'
  const actHeadline = (() => {
    if (status === 'fixed') return 'Loop closed — report marked fixed and routed back upstream'
    if (status === 'dismissed') return 'Loop closed — report dismissed (no fix needed)'
    if (actState === 'pending') return 'Awaiting merge — review the PR and click Open PR to ship'
    if (fixStatus === 'failed') return `Loop blocked — ${fix?.error ?? 'fix attempt failed'}`
    return 'Not yet — needs Plan + Do + Check first'
  })()
  const actLink = fix?.pr_url && actState !== 'done'
    ? { href: fix.pr_url, label: 'Review & merge' }
    : status === 'fixed'
      ? { href: '/integrations', label: 'See routing' }
      : undefined
  const act: StoryNode = {
    id: 'act',
    state: actState,
    headline: actHeadline,
    at: status === 'fixed' ? fix?.completed_at ?? null : null,
    link: actLink,
  }

  return { plan, do: doNode, check, act }
}
