/**
 * FILE: apps/admin/src/components/fixes/PdcaReceipt.tsx
 * PURPOSE: At-a-glance PDCA receipt for a single auto-fix attempt. Translates
 *          the technical timeline (dispatched / branch / commit / pr / ci /
 *          completed) into the four canonical PDCA stages users actually
 *          recognise: Plan → Do → Check → Act. Each stage shows a stamp
 *          (pending / done / failed) and a one-line proof.
 *
 *          Audit P0 from 2026-04-19: every fix should *show* the loop closing
 *          for the user, not just emit a green status pill.
 */

import { PDCA_ORDER, PDCA_STAGES, type PdcaStageId } from '../../lib/pdca'
import type { FixAttempt } from './types'
import type { FixTimelineEvent } from '../FixGitGraph'

interface PdcaReceiptProps {
  fix: FixAttempt
  timeline?: FixTimelineEvent[]
  className?: string
}

type StageStamp = 'done' | 'pending' | 'failed' | 'idle'

interface StageReceipt {
  id: PdcaStageId
  stamp: StageStamp
  proof: string
  link?: { href: string; label: string }
}

export function PdcaReceipt({ fix, timeline, className = '' }: PdcaReceiptProps) {
  const receipts = buildReceipts(fix, timeline ?? [])
  return (
    <ol
      className={`grid grid-cols-2 lg:grid-cols-4 gap-2 ${className}`}
      aria-label="PDCA receipt for this fix attempt"
    >
      {PDCA_ORDER.map((id) => {
        const meta = PDCA_STAGES[id]
        const r = receipts[id]
        return (
          <li
            key={id}
            className={`relative px-2.5 py-2 rounded-md border ${stampShell(r.stamp)} bg-surface-raised/40`}
          >
            <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wider">
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-sm font-semibold text-[10px] ${meta.badgeBg} ${meta.badgeFg}`}>
                {meta.letter}
              </span>
              <span className="text-fg-muted">{meta.label}</span>
              <Stamp stamp={r.stamp} />
            </div>
            <p className="mt-1 text-2xs text-fg-secondary leading-snug line-clamp-2">{r.proof}</p>
            {r.link && (
              <a
                href={r.link.href}
                target={r.link.href.startsWith('http') ? '_blank' : undefined}
                rel={r.link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="mt-1 inline-block text-2xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
              >
                {r.link.label}
              </a>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function stampShell(stamp: StageStamp): string {
  switch (stamp) {
    case 'done':
      return 'border-ok/30'
    case 'pending':
      return 'border-info/30'
    case 'failed':
      return 'border-danger/30'
    default:
      return 'border-edge-subtle opacity-60'
  }
}

const STAMP_STYLE: Record<StageStamp, { dot: string; label: string; copy: string }> = {
  done: { dot: 'bg-ok', label: 'Closed', copy: 'text-ok' },
  pending: { dot: 'bg-info animate-pulse', label: 'In flight', copy: 'text-info' },
  failed: { dot: 'bg-danger', label: 'Failed', copy: 'text-danger' },
  idle: { dot: 'bg-fg-faint/60', label: 'Not yet', copy: 'text-fg-faint' },
}

function Stamp({ stamp }: { stamp: StageStamp }) {
  const s = STAMP_STYLE[stamp]
  return (
    <span
      className={`ml-auto flex items-center gap-1 text-[10px] font-medium ${s.copy}`}
      aria-label={`Status: ${s.label}`}
    >
      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

function buildReceipts(
  fix: FixAttempt,
  timeline: FixTimelineEvent[]
): Record<PdcaStageId, StageReceipt> {
  // Two evidence sources: (a) lazily-loaded timeline events, and (b) fields on
  // the FixAttempt record itself which we always have. The receipt should not
  // misreport a stage as "pending" just because the timeline hasn't been
  // expanded — the FixAttempt record is the source of truth for state.
  const has = (kind: FixTimelineEvent['kind']) => timeline.find((e) => e.kind === kind)
  const branched = has('branch') ?? null
  const committed = has('commit') ?? null
  const prOpened = has('pr_opened') ?? null
  const ciResolved = has('ci_resolved') ?? null
  const completed = has('completed') ?? null
  const failedEvent = has('failed') ?? null

  const status = fix.status?.toLowerCase() ?? ''
  const hasBranch = !!fix.branch || !!branched
  const hasPr = !!fix.pr_url || !!prOpened
  const hasFiles = (fix.files_changed?.length ?? 0) > 0 || !!committed
  const ciConclusion = fix.check_run_conclusion?.toLowerCase() ?? null
  const isFailed = status === 'failed' || !!failedEvent
  const isCompleted = status === 'completed' || !!completed

  // PLAN — the report was classified and Mushi decided to dispatch a fix.
  // If the fix exists at all, planning happened; we only stay "pending" when
  // we genuinely don't know yet (in practice: never).
  const plan: StageReceipt = {
    id: 'plan',
    stamp: 'done',
    proof: `Dispatched to ${fix.agent} from report ${fix.report_id.slice(0, 8)}…`,
    link: { href: `/reports/${fix.report_id}`, label: 'Open source report' },
  }

  // DO — agent ran, branch + commit landed, PR opened.
  let doStamp: StageStamp = 'idle'
  if (hasPr || hasFiles) doStamp = 'done'
  else if (hasBranch) doStamp = 'pending'
  else if (isFailed) doStamp = 'failed'
  const filesText = fix.files_changed?.length
    ? `${fix.files_changed.length} file${fix.files_changed.length === 1 ? '' : 's'}`
    : 'no files yet'
  const linesText = fix.lines_changed != null ? ` · ${fix.lines_changed} lines` : ''
  const doReceipt: StageReceipt = {
    id: 'do',
    stamp: doStamp,
    proof: hasPr
      ? `PR opened on ${fix.branch ?? 'branch'} (${filesText}${linesText})`
      : hasFiles
        ? `Commit landed (${filesText}${linesText})`
        : hasBranch
          ? `Branch ${fix.branch ?? '(unnamed)'} created — agent working`
          : isFailed
            ? `Agent did not finish — ${fix.error ?? 'see error below'}`
            : 'Agent has not started yet',
    link: fix.pr_url ? { href: fix.pr_url, label: `PR${fix.pr_number ? ` #${fix.pr_number}` : ''}` } : undefined,
  }

  // CHECK — CI ran. Hard failures (CI red, timeouts) are 'failed'. The
  // agent's own self-flagged "needs review" signal is *not* a failure — it's
  // a request for human attention, so we keep the stamp 'pending' but note it
  // in the proof. This avoids over-flagging fixes that may still merge fine.
  let checkStamp: StageStamp = 'idle'
  if (ciConclusion === 'success') checkStamp = 'done'
  else if (ciConclusion === 'failure' || ciConclusion === 'timed_out') checkStamp = 'failed'
  else if (ciResolved || hasPr) checkStamp = 'pending'
  else if (isFailed && !hasPr) checkStamp = 'idle'
  const reviewSuffix = fix.review_passed === false ? ' · agent flagged for review' : ''
  const checkProof = ciConclusion
    ? `CI: ${ciConclusion.replace(/_/g, ' ')}${reviewSuffix}`
    : hasPr
      ? `CI running on the PR${reviewSuffix}`
      : 'No PR to verify yet'
  const check: StageReceipt = { id: 'check', stamp: checkStamp, proof: checkProof }

  // ACT — merged + report closed.
  let actStamp: StageStamp = 'idle'
  if (isCompleted && !isFailed && ciConclusion === 'success') actStamp = 'done'
  else if (isFailed) actStamp = 'failed'
  else if (ciConclusion === 'success' || hasPr) actStamp = 'pending'
  const actProof = actStamp === 'done'
    ? 'Loop closed — report resolved by this fix'
    : isFailed
      ? `Loop blocked — ${fix.error ?? 'fix attempt failed'}`
      : actStamp === 'pending'
        ? 'Awaiting merge'
        : 'Not yet — needs Do + Check first'
  const act: StageReceipt = {
    id: 'act',
    stamp: actStamp,
    proof: actProof,
    link: fix.pr_url && actStamp === 'pending' ? { href: fix.pr_url, label: 'Review & merge' } : undefined,
  }

  return { plan, do: doReceipt, check, act }
}

/**
 * Helper export for cases where a caller wants the raw stamp map (e.g. to
 * render a compact strip elsewhere). Re-using this avoids divergent logic if
 * we add new pipeline statuses.
 */
export type { StageStamp, StageReceipt }
