/**
 * FILE: apps/admin/src/components/fixes/FixesFirstView.tsx
 * PURPOSE: What /fixes answers first (console journeys 2026-10-27): "which
 *          fixes can I merge, and which failed and why?"
 *
 *            1. The release train: the five stations and the train on the
 *               tracks, the same picture and counts as Home and /pipeline.
 *            2. Ready to merge: open fix PRs Opus said to merge about their
 *               latest commit, with CI green (countDefinitions
 *               `readyToMerge`). "Merge when ready" queues them (ADR 0041).
 *            3. Stopped, by reason: the reports auto-fix stopped on, one row
 *               per reason, each with its own Retry, which spends LLM budget,
 *               only where a retry can help. "Retry 8 unfixed" used to be
 *               the header's main button.
 */

import { Link } from 'react-router-dom'
import { Badge, Btn, Section } from '../ui'
import { IconAlertTriangle, IconCheck, IconReleases } from '../icons'
import { ReleaseStations, ReleaseTrainLine } from '../release/ReleaseStations'
import { stationsFromStages, trainNow } from '../../lib/releaseStations'
import { COUNT_HINTS, readyToMerge } from '../../lib/countDefinitions'
import { failureCause, fixCauseLabel, fixReportLabel, needsAttention } from '../../lib/fixReportTruth'
import { pluralize } from '../../lib/format'
import type { PipelineData } from '../../lib/pipeline'
import type { FixAttempt } from './types'

/** Causes a new run repeats: the agent's own verdict that this is not a code change. */
const RETRY_REPEATS = new Set(['needs_human', 'already_fixed', 'not_actionable', 'wrong_repo'])

/** Where a cause is fixed when it is a setting, not a retry. */
function causeFix(cause: string): { label: string; to: string } | null {
  if (cause.endsWith('_key_rejected')) return { label: 'Fix the key', to: cause.startsWith('github') ? '/integrations/config#platform-card-github' : '/settings?tab=byok' }
  return null
}

export interface StoppedReason {
  cause: string
  label: string
  /** Reports stopped for this reason (their latest attempt). */
  fixes: FixAttempt[]
  /** Of those, the ones a retry can clear now. */
  retryable: FixAttempt[]
  /** Why there is no Retry, when there is none. */
  noRetry: string | null
  fix: { label: string; to: string } | null
}

/** Stopped reports grouped by why, biggest first. */
export function stoppedReasons(fixes: FixAttempt[]): StoppedReason[] {
  const byCause = new Map<string, FixAttempt[]>()
  for (const f of fixes) {
    if (!needsAttention(f)) continue
    const cause = failureCause(f)
    byCause.set(cause, [...(byCause.get(cause) ?? []), f])
  }
  return [...byCause.entries()]
    .map(([cause, list]) => {
      const fix = causeFix(cause)
      const repeats = RETRY_REPEATS.has(cause)
      const retryable = repeats || fix ? [] : list.filter((f) => f.retryable === true)
      const noRetry = repeats
        ? 'A retry would stop the same way: the agent says this is not a code change.'
        : fix
          ? 'A retry fails the same way until the key works.'
          : retryable.length === 0
            ? 'None of these can be retried right now.'
            : null
      return { cause, label: fixCauseLabel(cause), fixes: list, retryable, noRetry, fix }
    })
    .sort((a, b) => b.fixes.length - a.fixes.length)
}

/** Ready to merge, one row per PR. */
export function readyFixes(fixes: FixAttempt[]): FixAttempt[] {
  const seen = new Set<string>()
  return fixes.filter((f) => {
    if (!readyToMerge(f) || !f.pr_url || seen.has(f.pr_url)) return false
    seen.add(f.pr_url)
    return true
  })
}

/** Fix attempts already in the merge queue, from the pipeline read (its items carry the queue row). */
export function queuedFixIds(pipeline: PipelineData | null): Set<string> {
  const out = new Set<string>()
  for (const stage of pipeline?.stages ?? []) for (const g of stage.groups) for (const i of g.items) if (i.queueId) out.add(i.id)
  return out
}

interface Props {
  fixes: FixAttempt[]
  pipeline: PipelineData | null
  projectId: string | null
  busy: boolean
  /** Queue these PRs to merge when ready (ADR 0041). */
  onQueue: (fixes: FixAttempt[]) => void
  /** Narrow the table below to one cause. */
  onShowCause: (cause: string) => void
  /** Open the retry confirm for these reports. */
  onRetry: (fixes: FixAttempt[], label: string) => void
}

export function FixesFirstView({ fixes, pipeline, projectId, busy, onQueue, onShowCause, onRetry }: Props) {
  const ready = readyFixes(fixes)
  const queued = queuedFixIds(pipeline)
  const toQueue = ready.filter((f) => !queued.has(f.id))
  const reasons = stoppedReasons(fixes)
  const stopped = reasons.reduce((n, r) => n + r.fixes.length, 0)
  const pipelineHref = projectId ? `/pipeline?project=${encodeURIComponent(projectId)}` : '/pipeline'

  return (
    <div className="space-y-3" data-testid="fixes-first-view">
      {pipeline && (
        <Section title="Release train" id="fixes-release" icon={<IconReleases />} action={<Link to={pipelineHref} className="text-xs text-link">Pipeline →</Link>}>
          <div className="space-y-3">
            <ReleaseStations stations={stationsFromStages(pipeline.stages)} href={pipelineHref} testId="fixes-release-stations" />
            <p className="text-xs text-fg-secondary">
              <ReleaseTrainLine train={trainNow(pipeline.trains)} href={pipelineHref} />
            </p>
          </div>
        </Section>
      )}

      <Section
        title={`Ready to merge${ready.length ? `: ${ready.length}` : ''}`}
        id="fixes-ready"
        icon={<IconCheck />}
        action={
          toQueue.length > 0 ? (
            <Btn size="sm" variant="primary" loading={busy} onClick={() => onQueue(toQueue)} data-testid="fixes-ready-queue-all">
              Merge {toQueue.length === 1 ? 'it' : `${toQueue.length}`} when ready
            </Btn>
          ) : undefined
        }
      >
        <p className="mb-2 text-2xs text-fg-muted">{COUNT_HINTS.readyToMerge} Merge when ready updates each branch, waits for CI and merges one PR per repo at a time.</p>
        {ready.length === 0 ? (
          <p className="text-xs text-fg-muted" data-testid="fixes-ready-empty">
            None right now. A fix lands here once Opus says merge about its latest commit and its CI passes.
          </p>
        ) : (
          <ul className="divide-y divide-edge-subtle" data-testid="fixes-ready-list">
            {ready.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`fixes-ready-${f.id}`}>
                <Link to={`/reports/${f.report_id}`} className="min-w-0 flex-1 basis-48 wrap-break-word text-xs font-medium text-fg hover:underline">
                  {fixReportLabel(f)}
                </Link>
                <a href={f.pr_url} target="_blank" rel="noreferrer" className="font-mono text-2xs text-fg-secondary hover:underline">
                  #{f.pr_number ?? '?'}
                </a>
                <Badge tone="ok">Opus: merge</Badge>
                <Badge tone="ok">CI passed</Badge>
                {queued.has(f.id) ? (
                  <span className="text-2xs text-fg-muted" data-testid={`fixes-ready-${f.id}-queued`}>In the merge queue</span>
                ) : (
                  <Btn size="sm" variant="ghost" disabled={busy} onClick={() => onQueue([f])} data-testid={`fixes-ready-${f.id}-queue`}>
                    Merge when ready
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {reasons.length > 0 && (
        <Section title={`Stopped: ${stopped} ${pluralize(stopped, 'report')}`} id="fixes-stopped" icon={<IconAlertTriangle />}>
          <p className="mb-2 text-2xs text-fg-muted">{COUNT_HINTS.stopped}</p>
          <ul className="divide-y divide-edge-subtle" data-testid="fixes-stopped-reasons">
            {reasons.map((r) => (
              <li key={r.cause} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`fixes-stopped-${r.cause}`}>
                <span className="w-8 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-danger-foreground">{r.fixes.length}</span>
                <button
                  type="button"
                  onClick={() => onShowCause(r.cause)}
                  className="min-w-0 flex-1 basis-40 text-left text-xs font-medium text-fg hover:underline"
                  title={`Show the ${r.fixes.length} stopped ${pluralize(r.fixes.length, 'report')} in the list below`}
                >
                  {r.label}
                </button>
                {r.retryable.length > 0 ? (
                  <Btn
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onRetry(r.retryable, r.label)}
                    title="Runs a coding agent again on each report; spends LLM budget. You confirm first."
                    data-testid={`fixes-stopped-${r.cause}-retry`}
                  >
                    Retry {r.retryable.length}
                  </Btn>
                ) : r.fix ? (
                  <Link to={r.fix.to} className="text-2xs font-medium text-brand hover:underline" title={r.noRetry ?? undefined}>
                    {r.fix.label} →
                  </Link>
                ) : (
                  <span className="basis-full pl-11 text-2xs text-fg-muted sm:basis-auto sm:pl-0" data-testid={`fixes-stopped-${r.cause}-no-retry`}>
                    {r.noRetry}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
