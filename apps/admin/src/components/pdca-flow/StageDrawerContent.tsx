/**
 * FILE: apps/admin/src/components/pdca-flow/StageDrawerContent.tsx
 * PURPOSE: Per-stage drawer body rendered inside <StageDrawer>. Each stage
 *          gets its own panel with progressive-disclosure content:
 *            • Plan  — newest reports list, dispatch / dismiss / open
 *            • Do    — in-flight fixes, retry / cancel / open PR / trace
 *            • Check — judge scores, run-now, open Judge page
 *            • Act   — integrations health + quick "open rule" link
 *
 *          Keeps all drawer logic in one file because the panels share a
 *          lot of boilerplate (fetch-on-open, loading state, error toast)
 *          and splitting them would force duplicated plumbing for little
 *          readability gain.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { PDCA_STAGES } from '../../lib/pdca'
import type { PdcaStageId } from '../../lib/pdca'
import type { PdcaStage } from '../dashboard/types'
import type { FixAttempt, DispatchJob } from '../fixes/types'
import { credentialAdvice, failureHeadline, fixReportLabel, needsAttention } from '../../lib/fixReportTruth'
import { Btn, RelativeTime, Loading } from '../ui'
import { useFlowUndo } from '../flow-primitives/useFlowUndo'
import { CHIP_TONE } from '../../lib/chipTone'
import { useActiveProjectId } from '../ProjectSwitcher'
import { useDispatchPreflight } from '../../lib/useDispatchPreflight'
import { DispatchFixPreflight } from '../reports/DispatchFixPreflight'
import { describeJudgeRun, type JudgeRunResponse } from '../../lib/judgeRun'
import { actionErrorText } from '../../lib/actionErrorText'
import { ConfirmDialog } from '../ConfirmDialog'
import type { IntegrationStatus } from '../dashboard/types'

interface StageDrawerContentProps {
  stageId: PdcaStageId
  stage?: PdcaStage | null
  onClose: () => void
  /** The dashboard's integration health (one definition with its KPI and banner). */
  integrations?: IntegrationStatus[]
}

export function StageDrawerContent({ stageId, stage, onClose, integrations }: StageDrawerContentProps) {
  if (stageId === 'plan') return <PlanDrawer stage={stage} onClose={onClose} />
  if (stageId === 'do') return <DoDrawer stage={stage} onClose={onClose} />
  if (stageId === 'check') return <CheckDrawer stage={stage} onClose={onClose} />
  return <ActDrawer stage={stage} onClose={onClose} integrations={integrations} />
}

/* ─────────────────────────── PLAN ──────────────────────────────────────── */

interface ReportRow {
  id: string
  project_id?: string | null
  summary?: string | null
  severity?: string | null
  category?: string | null
  status?: string | null
  confidence?: number | null
  unique_users?: number | null
  dedup_count?: number | null
  created_at: string
}

function PlanDrawer({ stage, onClose }: { stage?: PdcaStage | null; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  // Same confirm + prerequisites gate as the reports table. This drawer's
  // "Dispatch fix" used to POST straight away — the one dispatch entry point
  // that skipped both, so autofix-off or a missing repo surfaced only as an
  // error toast after the request, and a click queued an LLM run and a draft
  // PR with no chance to read what would happen.
  const activeProjectId = useActiveProjectId()
  const preflight = useDispatchPreflight(activeProjectId)
  const [reports, setReports] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const undo = useFlowUndo()
  const meta = PDCA_STAGES.plan

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<{ reports: ReportRow[] }>(
      // `open` — every report still waiting on a decision, the same set the
      // dashboard's Bug queue lists. `new` alone lasts only the second
      // classification takes, so this drawer read "Your bug queue is clean"
      // over 18 classified reports (2026-09-23).
      '/v1/admin/reports?status=open&sort=created_at&dir=desc&limit=6',
    )
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) setReports(res.data.reports ?? [])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const dispatchFix = useCallback(
    async (report: ReportRow) => {
      setBusyId(report.id)
      try {
        // The route requires projectId: the report's own project, which can
        // differ from the header's project when several are in scope.
        const res = await apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: JSON.stringify({ reportId: report.id, projectId: report.project_id ?? activeProjectId }),
        })
        if (res.ok) {
          toast.success('Fix dispatched', 'Moved to the Do stage.')
          setReports((prev) => prev.filter((r) => r.id !== report.id))
        } else {
          toast.error('Dispatch failed', actionErrorText(res.error))
        }
      } finally {
        setBusyId(null)
      }
    },
    [toast, activeProjectId],
  )

  const dismissReport = useCallback(
    (reportId: string) => {
      const original = reports.find((r) => r.id === reportId)
      if (!original) return
      undo.trigger({
        message: 'Report dismissed',
        description: 'Undo within 5 seconds to restore it.',
        onOptimistic: () =>
          setReports((prev) => prev.filter((r) => r.id !== reportId)),
        onRollback: () =>
          setReports((prev) => {
            if (prev.some((r) => r.id === reportId)) return prev
            return [original, ...prev]
          }),
        run: async () => {
          const res = await apiFetch(`/v1/admin/reports/${reportId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'dismissed' }),
          })
          return { ok: res.ok, error: res.error?.message }
        },
      })
    },
    [reports, undo],
  )

  return (
    <>
      <SummaryStripe stage={stage} toneBadgeClass={meta.badgeBg} letterClass={meta.badgeFg} />

      <section className="mt-3" aria-label="Newest reports waiting for triage">
        <h4 className="text-3xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
          Newest reports
        </h4>
        {loading ? (
          <Loading text="Fetching reports…" />
        ) : reports.length === 0 ? (
          <p className="text-2xs text-fg-muted py-3">
            No open reports waiting. Your bug queue is clean.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {reports.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-edge-subtle bg-surface-raised/50 p-2 text-2xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-fg leading-tight font-medium line-clamp-2">
                      {r.summary ?? '(no summary yet)'}
                    </p>
                    <p className="text-fg-faint mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {r.severity && <span className="uppercase">{r.severity}</span>}
                      {r.category && <span>· {r.category}</span>}
                      <span>
                        · <RelativeTime value={r.created_at} />
                      </span>
                    </p>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <DispatchFixPreflight
                    busy={busyId === r.id}
                    severity={r.severity ?? null}
                    blastRadius={(r.unique_users ?? 0) > 0 ? (r.unique_users ?? 0) : (r.dedup_count ?? 1)}
                    confidence={r.confidence ?? null}
                    onConfirm={() => void dispatchFix(r)}
                    onOpenDetail={() => {
                      onClose()
                      navigate(`/reports/${r.id}`)
                    }}
                    preflight={preflight}
                    repoUrl={preflight.repoUrl}
                  />
                  <Btn size="sm" variant="ghost" onClick={() => dismissReport(r.id)}>
                    Dismiss
                  </Btn>
                  <Link
                    to={`/reports/${r.id}`}
                    onClick={onClose}
                    className="ml-auto text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity text-2xs"
                  >
                    Open →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FooterCta label="Open full triage" onClick={() => { onClose(); navigate('/reports') }} />
    </>
  )
}

/* ─────────────────────────── DO ────────────────────────────────────────── */

function DoDrawer({ stage, onClose }: { stage?: PdcaStage | null; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [fixes, setFixes] = useState<FixAttempt[]>([])
  const [dispatches, setDispatches] = useState<DispatchJob[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Retry queues a new fix run (AI spend + a draft PR), so it asks first,
  // like every other dispatch entry point.
  const [confirmRetry, setConfirmRetry] = useState<FixAttempt | null>(null)
  const meta = PDCA_STAGES.do

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      apiFetch<{ fixes: FixAttempt[] }>('/v1/admin/fixes'),
      apiFetch<{ dispatches: DispatchJob[] }>('/v1/admin/fixes/dispatches'),
    ])
      .then(([fRes, dRes]) => {
        if (cancelled) return
        if (fRes.ok && fRes.data) setFixes(fRes.data.fixes ?? [])
        if (dRes.ok && dRes.data) setDispatches(dRes.data.dispatches ?? [])
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const inFlight = useMemo(
    () => fixes.filter((f) => f.status === 'running' || f.status === 'queued').slice(0, 6),
    [fixes],
  )
  // Still-unfixed reports whose last attempt stopped — never an earlier
  // attempt on a report a later PR fixed (lib/fixReportTruth.ts).
  const failed = useMemo(() => fixes.filter(needsAttention).slice(0, 3), [fixes])

  const retry = useCallback(
    async (reportId: string, fixId: string, projectId: string | undefined) => {
      setBusyId(fixId)
      try {
        // The route requires projectId; without it every retry here was a 400.
        const res = await apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: JSON.stringify({ reportId, projectId }),
        })
        if (res.ok) {
          toast.success('Fix re-dispatched')
        } else {
          toast.error('Re-dispatch failed', actionErrorText(res.error))
        }
      } finally {
        setBusyId(null)
      }
    },
    [toast],
  )

  const cancelDispatch = useCallback(
    async (dispatchId: string) => {
      setBusyId(dispatchId)
      try {
        const res = await apiFetch(`/v1/admin/fixes/dispatches/${dispatchId}/cancel`, {
          method: 'POST',
        })
        if (res.ok) {
          toast.success('Dispatch cancelled')
          setDispatches((prev) =>
            prev.map((d) =>
              d.id === dispatchId ? { ...d, status: 'cancelled' } : d,
            ),
          )
        } else {
          toast.error('Cancel failed', actionErrorText(res.error))
        }
      } finally {
        setBusyId(null)
      }
    },
    [toast],
  )

  return (
    <>
      <SummaryStripe stage={stage} toneBadgeClass={meta.badgeBg} letterClass={meta.badgeFg} />

      {loading ? (
        <Loading text="Fetching fix attempts…" />
      ) : (
        <>
          <section className="mt-3" aria-label="Fixes currently in flight">
            <h4 className="text-3xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
              In flight · {inFlight.length}
            </h4>
            {inFlight.length === 0 ? (
              <p className="text-2xs text-fg-muted">Nothing in flight. The agent is idle.</p>
            ) : (
              <ul className="space-y-1.5">
                {inFlight.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-md border border-edge-subtle bg-surface-raised/50 p-2 text-2xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-fg-muted">
                        {f.agent} · {f.status}
                      </span>
                      <RelativeTime value={f.started_at} className="text-fg-faint tabular-nums" />
                    </div>
                    {f.summary && (
                      <p className="text-fg-secondary leading-snug mt-0.5 line-clamp-2">
                        {f.summary}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                      {f.pr_url && (
                        <a
                          href={f.pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity"
                        >
                          Open PR →
                        </a>
                      )}
                      {f.langfuse_trace_id && (
                        <Link
                          to={`/intelligence`}
                          onClick={onClose}
                          className="text-fg-muted hover:underline"
                        >
                          Trace
                        </Link>
                      )}
                      <Link
                        to={`/fixes`}
                        onClick={onClose}
                        className="ml-auto text-fg-muted hover:text-fg"
                      >
                        Details
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {failed.length > 0 && (
            <section className="mt-3" aria-label="Reports where auto-fix stopped">
              <h4 className="text-3xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
                Auto-fix stopped
              </h4>
              <ul className="space-y-1.5">
                {failed.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-md border border-danger/30 bg-danger-muted/10 p-2 text-2xs"
                  >
                    <p className="text-fg-secondary font-medium leading-snug line-clamp-1">{fixReportLabel(f)}</p>
                    <p className="text-danger leading-snug line-clamp-2">
                      {credentialAdvice(f)?.message ?? failureHeadline(f)?.title ?? 'The last attempt stopped without an error message.'}
                    </p>
                    <div className="mt-1 flex gap-1">
                      {f.retryable === true ? (
                        <Btn
                          size="sm"
                          variant="ghost"
                          loading={busyId === f.id}
                          onClick={() => setConfirmRetry(f)}
                        >
                          Retry
                        </Btn>
                      ) : null}
                      <Link
                        to={`/reports/${f.report_id}`}
                        onClick={onClose}
                        className="ml-auto self-center text-fg-muted hover:text-fg"
                      >
                        Report →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {dispatches.some((d) => d.status === 'queued' || d.status === 'running') && (
            <section className="mt-3" aria-label="Queued dispatches">
              <h4 className="text-3xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
                Queue
              </h4>
              <ul className="space-y-1.5">
                {dispatches
                  .filter((d) => d.status === 'queued' || d.status === 'running')
                  .slice(0, 4)
                  .map((d) => (
                    <li
                      key={d.id}
                      className="rounded-md border border-edge-subtle bg-surface-raised/50 p-2 text-2xs flex items-center gap-2"
                    >
                      <span className="font-mono text-fg-faint flex-1 truncate">{d.id.slice(0, 8)}</span>
                      <span className="text-fg-muted">{d.status}</span>
                      <Btn
                        size="sm"
                        variant="ghost"
                        loading={busyId === d.id}
                        onClick={() => void cancelDispatch(d.id)}
                      >
                        Cancel
                      </Btn>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}

      {confirmRetry ? (
        <ConfirmDialog
          title="Retry the auto-fix?"
          body={`This queues a new fix run for "${fixReportLabel(confirmRetry)}". It spends AI budget and opens a draft pull request for you to review.`}
          confirmLabel="Retry fix"
          loading={busyId === confirmRetry.id}
          onCancel={() => setConfirmRetry(null)}
          onConfirm={async () => {
            await retry(confirmRetry.report_id, confirmRetry.id, confirmRetry.project_id)
            setConfirmRetry(null)
          }}
        />
      ) : null}

      <FooterCta label="Open Fixes pipeline" onClick={() => { onClose(); navigate('/fixes') }} />
    </>
  )
}

/* ─────────────────────────── CHECK ─────────────────────────────────────── */

/** One row of GET /v1/admin/judge/evaluations (api/routes/judge.ts). */
interface JudgeEval {
  id: string
  judge_score?: number | null
  classification_agreed?: boolean | null
  report_summary?: string | null
  created_at: string
  report_id?: string
}

/** 0-1 judge score as a whole percentage; a dash when the judge gave none. */
function judgeScoreLabel(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(Number(score))) return '—'
  return `${Math.round(Number(score) * 100)}%`
}

function CheckDrawer({ stage, onClose }: { stage?: PdcaStage | null; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [evals, setEvals] = useState<JudgeEval[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const meta = PDCA_STAGES.check

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<{ evaluations: JudgeEval[] }>(
      '/v1/admin/judge/evaluations?limit=6&sort=recent',
    )
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) setEvals(res.data.evaluations ?? [])
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const runJudge = useCallback(async () => {
    setRunning(true)
    try {
      const res = await apiFetch<JudgeRunResponse>('/v1/admin/judge/run', { method: 'POST' })
      if (res.ok) {
        // Nothing eligible is not a success: say so instead of "dispatched".
        const outcome = describeJudgeRun(res.data)
        if (outcome.kind === 'nothing') toast.info(outcome.title, outcome.description)
        else toast.success(outcome.title, outcome.description)
      } else {
        toast.error('Judge run failed', actionErrorText(res.error))
      }
    } finally {
      setRunning(false)
    }
  }, [toast])

  return (
    <>
      <SummaryStripe stage={stage} toneBadgeClass={meta.badgeBg} letterClass={meta.badgeFg} />

      <div className="mt-3 flex items-center gap-2">
        <Btn variant="primary" size="sm" loading={running} onClick={runJudge} data-primary>
          Run judge now
        </Btn>
        <span className="text-2xs text-fg-muted">Rescore every fix awaiting verification.</span>
      </div>

      <section className="mt-3" aria-label="Recent judge evaluations">
        <h4 className="text-3xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
          Recent scores
        </h4>
        {loading ? (
          <Loading text="Fetching evaluations…" />
        ) : evals.length === 0 ? (
          <p className="text-2xs text-fg-muted">No evaluations yet. Ship a fix to unlock the judge.</p>
        ) : (
          <ul className="space-y-1.5">
            {evals.map((e) => (
              <li
                key={e.id}
                className="rounded-md border border-edge-subtle bg-surface-raised/50 p-2 text-2xs flex items-center gap-2"
              >
                <span
                  className={`inline-flex items-center justify-center w-10 rounded-sm py-0.5 font-mono font-semibold text-2xs ${
                    e.classification_agreed === true
                      ? CHIP_TONE.okSubtle
                      : e.classification_agreed === false
                        ? CHIP_TONE.dangerSubtle
                        : CHIP_TONE.warnSubtle
                  }`}
                  title={
                    e.classification_agreed === true
                      ? 'The judge agreed with the classification'
                      : e.classification_agreed === false
                        ? 'The judge disagreed with the classification'
                        : 'The judge did not say whether it agreed'
                  }
                >
                  {judgeScoreLabel(e.judge_score)}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-fg truncate block" title={e.report_id ?? undefined}>
                    {e.report_summary?.trim() || 'Untitled report'}
                  </span>
                  <RelativeTime value={e.created_at} className="text-fg-faint tabular-nums" />
                </div>
                {e.report_id && (
                  <Link
                    to={`/reports/${e.report_id}`}
                    onClick={onClose}
                    className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity"
                  >
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <FooterCta label="Open Judge" onClick={() => { onClose(); navigate('/judge') }} />
    </>
  )
}

/* ─────────────────────────── ACT ───────────────────────────────────────── */

function ActDrawer({
  stage,
  onClose,
  integrations,
}: {
  stage?: PdcaStage | null
  onClose: () => void
  integrations?: IntegrationStatus[]
}) {
  const navigate = useNavigate()
  const meta = PDCA_STAGES.act
  // The dashboard's own health rollup (GET /v1/admin/dashboard `integrations`),
  // so the drawer, the KPI and the banner can never disagree. It used to read
  // `data.integrations` from /integrations/platform, which has no such field,
  // and always said "No integrations connected yet."
  const rows = integrations ?? []

  return (
    <>
      <SummaryStripe stage={stage} toneBadgeClass={meta.badgeBg} letterClass={meta.badgeFg} />

      <section className="mt-3" aria-label="Integrations health">
        <h4 className="text-3xs font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
          Integrations
        </h4>
        {rows.length === 0 ? (
          <p className="text-2xs text-fg-muted">
            No health checks in the last 14 days. Connect an integration and its checks show here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.slice(0, 8).map((i) => {
              const severity = i.severity ?? (i.lastStatus === 'ok' ? 'ok' : 'amber')
              return (
                <li
                  key={i.kind}
                  className="rounded-md border border-edge-subtle bg-surface-raised/50 p-2 text-2xs flex items-center gap-2"
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                      severity === 'ok' ? 'bg-ok' : severity === 'red' ? 'bg-danger' : 'bg-warn'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-fg capitalize flex-1">{i.kind.replace(/_/g, ' ')}</span>
                  <span className="text-fg-faint">
                    {severity === 'ok' ? 'Healthy' : severity === 'red' ? 'Failing' : 'Degraded'}
                  </span>
                  {i.lastAt && (
                    <span className="text-fg-faint tabular-nums">
                      <RelativeTime value={i.lastAt} />
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <FooterCta label="Open integrations" onClick={() => { onClose(); navigate('/integrations/config') }} />
    </>
  )
}

/* ─────────────────────────── shared UI ─────────────────────────────────── */

function SummaryStripe({
  stage,
  toneBadgeClass,
  letterClass,
}: {
  stage?: PdcaStage | null
  toneBadgeClass: string
  letterClass: string
}) {
  if (!stage) return null
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised/30 px-2.5 py-1.5 flex items-center gap-2.5 text-2xs">
      <span className={`inline-flex items-center gap-1 ${toneBadgeClass} ${letterClass} rounded-sm px-1.5 py-0.5 font-semibold uppercase tracking-wider`}>
        Stage
      </span>
      <span className="text-xl font-mono font-semibold text-fg leading-none tabular-nums">
        {stage.count}
      </span>
      <span className="text-fg-muted">{stage.countLabel}</span>
      {stage.bottleneck && (
        <span className="ml-auto text-warn truncate max-w-40" title={stage.bottleneck}>
          {stage.bottleneck}
        </span>
      )}
    </div>
  )
}

function FooterCta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="mt-4 pt-3 border-t border-edge/50 flex items-center justify-between">
      <span className="text-2xs text-fg-faint">Press <kbd className="font-mono bg-surface-overlay px-1 py-0.5 rounded-sm">Esc</kbd> to close.</span>
      <button
        type="button"
        onClick={onClick}
        className="text-2xs text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity font-medium inline-flex items-center gap-1"
      >
        {label} <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}
