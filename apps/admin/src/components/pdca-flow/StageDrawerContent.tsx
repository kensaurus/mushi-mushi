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
import { Btn, RelativeTime, Loading } from '../ui'
import { useFlowUndo } from '../flow-primitives/useFlowUndo'

interface StageDrawerContentProps {
  stageId: PdcaStageId
  stage?: PdcaStage | null
  onClose: () => void
}

export function StageDrawerContent({ stageId, stage, onClose }: StageDrawerContentProps) {
  if (stageId === 'plan') return <PlanDrawer stage={stage} onClose={onClose} />
  if (stageId === 'do') return <DoDrawer stage={stage} onClose={onClose} />
  if (stageId === 'check') return <CheckDrawer stage={stage} onClose={onClose} />
  return <ActDrawer stage={stage} onClose={onClose} />
}

/* ─────────────────────────── PLAN ──────────────────────────────────────── */

interface ReportRow {
  id: string
  summary?: string | null
  severity?: string | null
  category?: string | null
  status?: string | null
  created_at: string
}

function PlanDrawer({ stage, onClose }: { stage?: PdcaStage | null; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const undo = useFlowUndo()
  const meta = PDCA_STAGES.plan

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<{ reports: ReportRow[] }>(
      '/v1/admin/reports?status=new&sort=created_at&dir=desc&limit=6',
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
    async (reportId: string) => {
      setBusyId(reportId)
      try {
        const res = await apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: JSON.stringify({ reportId }),
        })
        if (res.ok) {
          toast.success('Fix dispatched', 'Moved to the Do stage.')
          setReports((prev) => prev.filter((r) => r.id !== reportId))
        } else {
          toast.error('Dispatch failed', res.error?.message)
        }
      } finally {
        setBusyId(null)
      }
    },
    [toast],
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
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
          Newest reports
        </h4>
        {loading ? (
          <Loading text="Fetching reports…" />
        ) : reports.length === 0 ? (
          <p className="text-2xs text-fg-muted py-3">
            No new reports waiting. Your triage queue is clean.
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
                  <Btn
                    size="sm"
                    variant="primary"
                    loading={busyId === r.id}
                    onClick={() => void dispatchFix(r.id)}
                  >
                    Dispatch fix
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => dismissReport(r.id)}>
                    Dismiss
                  </Btn>
                  <Link
                    to={`/reports/${r.id}`}
                    onClick={onClose}
                    className="ml-auto text-brand hover:underline text-2xs"
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
  const failed = useMemo(
    () => fixes.filter((f) => f.status === 'failed').slice(0, 3),
    [fixes],
  )

  const retry = useCallback(
    async (reportId: string, fixId: string) => {
      setBusyId(fixId)
      try {
        const res = await apiFetch('/v1/admin/fixes/dispatch', {
          method: 'POST',
          body: JSON.stringify({ reportId }),
        })
        if (res.ok) {
          toast.success('Fix re-dispatched')
        } else {
          toast.error('Re-dispatch failed', res.error?.message)
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
          toast.error('Cancel failed', res.error?.message)
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
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
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
                          className="text-brand hover:underline"
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
            <section className="mt-3" aria-label="Recently failed fixes">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
                Recently failed
              </h4>
              <ul className="space-y-1.5">
                {failed.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-md border border-danger/30 bg-danger-muted/10 p-2 text-2xs"
                  >
                    <p className="text-danger font-mono leading-snug line-clamp-2">
                      {f.error ?? 'Unknown failure'}
                    </p>
                    <div className="mt-1 flex gap-1">
                      <Btn
                        size="sm"
                        variant="ghost"
                        loading={busyId === f.id}
                        onClick={() => void retry(f.report_id, f.id)}
                      >
                        Retry
                      </Btn>
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
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
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

      <FooterCta label="Open Fixes pipeline" onClick={() => { onClose(); navigate('/fixes') }} />
    </>
  )
}

/* ─────────────────────────── CHECK ─────────────────────────────────────── */

interface JudgeEval {
  id: string
  score?: number | null
  passed?: boolean | null
  created_at: string
  report_id?: string
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
      const res = await apiFetch<{ dispatched: number }>('/v1/admin/judge/run', { method: 'POST' })
      if (res.ok) {
        toast.success(
          `Judge run dispatched${res.data?.dispatched ? ` · ${res.data.dispatched} batched` : ''}`,
        )
      } else {
        toast.error('Judge run failed', res.error?.message)
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
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
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
                  className={`inline-flex items-center justify-center w-9 rounded-sm py-0.5 font-mono font-semibold text-2xs ${
                    e.passed === true
                      ? 'bg-ok-muted text-ok'
                      : e.passed === false
                        ? 'bg-danger-muted text-danger'
                        : 'bg-warn-muted text-warn'
                  }`}
                >
                  {e.score ?? '—'}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-fg-muted font-mono truncate block">
                    {e.report_id ? e.report_id.slice(0, 10) + '…' : e.id.slice(0, 10)}
                  </span>
                  <RelativeTime value={e.created_at} className="text-fg-faint tabular-nums" />
                </div>
                {e.report_id && (
                  <Link
                    to={`/reports/${e.report_id}`}
                    onClick={onClose}
                    className="text-brand hover:underline"
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

interface IntegrationPlatformRow {
  kind: string
  connected?: boolean
  lastStatus?: string | null
  lastAt?: string | null
}

function ActDrawer({ stage, onClose }: { stage?: PdcaStage | null; onClose: () => void }) {
  const navigate = useNavigate()
  const [integrations, setIntegrations] = useState<IntegrationPlatformRow[]>([])
  const [loading, setLoading] = useState(true)
  const meta = PDCA_STAGES.act

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<{ integrations: IntegrationPlatformRow[] }>('/v1/admin/integrations/platform')
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) setIntegrations(res.data.integrations ?? [])
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <SummaryStripe stage={stage} toneBadgeClass={meta.badgeBg} letterClass={meta.badgeFg} />

      <section className="mt-3" aria-label="Integrations health">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1.5">
          Integrations
        </h4>
        {loading ? (
          <Loading text="Fetching integrations…" />
        ) : integrations.length === 0 ? (
          <p className="text-2xs text-fg-muted">No integrations connected yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {integrations.slice(0, 8).map((i) => (
              <li
                key={i.kind}
                className="rounded-md border border-edge-subtle bg-surface-raised/50 p-2 text-2xs flex items-center gap-2"
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                    i.connected ? 'bg-ok' : 'bg-fg-faint'
                  }`}
                  aria-hidden="true"
                />
                <span className="font-mono text-fg capitalize flex-1">{i.kind}</span>
                <span className="text-fg-faint">
                  {i.connected ? i.lastStatus ?? 'connected' : 'disconnected'}
                </span>
                {i.lastAt && (
                  <span className="text-fg-faint tabular-nums">
                    <RelativeTime value={i.lastAt} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <FooterCta label="Open integrations" onClick={() => { onClose(); navigate('/integrations') }} />
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
        <span className="ml-auto text-warn truncate max-w-[10rem]" title={stage.bottleneck}>
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
        className="text-2xs text-brand hover:underline font-medium inline-flex items-center gap-1"
      >
        {label} <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}
