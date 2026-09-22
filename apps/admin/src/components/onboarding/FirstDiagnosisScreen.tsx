/**
 * FILE: apps/admin/src/components/onboarding/FirstDiagnosisScreen.tsx
 * PURPOSE: Onboarding screen 2 — "See your first diagnosis".
 *
 *          One button sends a realistic synthetic report through the admin
 *          test-report endpoint, the screen polls the report row until the
 *          classifier has written a diagnosis, then renders it inline
 *          (title, severity, summary, root cause, link to the full report).
 *          Once the aha has landed we show the SDK install snippet and the
 *          Cursor MCP connect button underneath, plus the tour trigger.
 *
 *          `FirstDiagnosisInline` is the compact variant the Overview and
 *          Reports empty states embed — same machine, no install block.
 *
 *          Decisions live in `lib/firstDiagnosis.ts` (pure reducer, tested);
 *          this file owns timers, network, and rendering.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getMcpClient } from '@mushi-mushi/mcp/clients'
import { apiFetch, invalidateApiCache } from '../../lib/supabase'
import { trackAdHoc, trackSelf } from '../../lib/track'
import { useOnlineStatus } from '../../lib/onlineStatus'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL } from '../../lib/env'
import { SEVERITY_TRAFFIC_BADGE, severityTrafficLabel } from '../../lib/severityTraffic'
import { CATEGORY_LABELS } from '../../lib/tokens'
import { reportDetailPath } from '../../lib/reportUrl'
import { LINK_ACCENT } from '../../lib/chipTone'
import {
  FIRST_DIAGNOSIS_INITIAL,
  FIRST_DIAGNOSIS_POLL_INTERVAL_MS,
  firstDiagnosisCopy,
  isPolling,
  reduceFirstDiagnosis,
  trackedReportId,
  type Diagnosis,
  type FirstDiagnosisState,
  type PolledReport,
} from '../../lib/firstDiagnosis'
import { Badge, Btn, Card, CodeValue, ResultChip } from '../ui'
import { ContainedBlock, SignalChip } from '../report-detail/ReportSurface'
import { SdkInstallCard } from '../SdkInstallCard'
import { ClientConnectButton } from '../ClientConnectButton'
import { startFirstRunTour } from '../FirstRunTour'
import { reportDiagnosisViewed } from './diagnosisViewed'

const CURSOR_SETUP_COMMAND = 'npx mushi-mushi setup --ide cursor'

// ─── Hook ────────────────────────────────────────────────────────────────────

interface UseFirstDiagnosisOptions {
  projectId: string
  /** Fires once per diagnosed report — callers refetch setup / lists. */
  onDiagnosed?: (reportId: string) => void
}

function useFirstDiagnosis({ projectId, onDiagnosed }: UseFirstDiagnosisOptions) {
  const [state, dispatch] = useReducer(reduceFirstDiagnosis, FIRST_DIAGNOSIS_INITIAL)
  const { online } = useOnlineStatus()
  const trackedRef = useRef<string | null>(null)
  const onDiagnosedRef = useRef(onDiagnosed)
  onDiagnosedRef.current = onDiagnosed

  // Browser connectivity → machine. `went_offline` is a no-op outside the
  // sending / polling phases; `back_online` only resumes a parked poll.
  const wasOnline = useRef(online)
  useEffect(() => {
    if (wasOnline.current === online) return
    wasOnline.current = online
    if (online) dispatch({ type: 'back_online', at: Date.now() })
    else dispatch({ type: 'went_offline' })
  }, [online])

  const send = useCallback(async () => {
    dispatch({ type: 'send' })
    const res = await apiFetch<{ reportId: string; projectName: string }>(
      `/v1/admin/projects/${projectId}/test-report`,
      { method: 'POST' },
    )
    if (res.ok && res.data?.reportId) {
      // `test_report_sent` is emitted server-side by the test-report route
      // (dedup per report); the console only records the diagnosis being seen.
      dispatch({ type: 'send_ok', reportId: res.data.reportId, at: Date.now() })
    } else {
      dispatch({
        type: 'send_failed',
        code: res.error?.code ?? 'ERROR',
        message: res.error?.message ?? 'Could not send the test report.',
      })
    }
  }, [projectId])

  // Poll while queued / classifying. Every reducer step returns a fresh
  // object, so the effect re-arms itself after each tick until a terminal
  // phase (diagnosed / failed / quota / offline / timed out) is reached.
  useEffect(() => {
    if (!isPolling(state)) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const res = await apiFetch<PolledReport>(`/v1/admin/reports/${state.reportId}`, {
        cache: 'no-store',
      })
      if (cancelled) return
      if (res.ok && res.data) {
        dispatch({ type: 'poll_ok', report: res.data, at: Date.now() })
      } else {
        dispatch({
          type: 'poll_failed',
          code: res.error?.code ?? 'ERROR',
          message: res.error?.message ?? 'Poll failed',
          at: Date.now(),
        })
      }
    }, FIRST_DIAGNOSIS_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [state])

  // The inline diagnosis IS the report being opened — count it as the
  // Habit event, record the activation step `diagnosis_viewed` (once per
  // project, server-deduped) and let the page refetch (setup steps, report
  // lists).
  useEffect(() => {
    if (state.phase !== 'diagnosed') return
    if (trackedRef.current === state.reportId) return
    trackedRef.current = state.reportId
    trackSelf('report_opened', { report_id: state.reportId, project_id: projectId, via: 'first_diagnosis' })
    reportDiagnosisViewed(projectId, state.reportId)
    invalidateApiCache('/v1/admin/reports')
    invalidateApiCache('/v1/admin/setup')
    onDiagnosedRef.current?.(state.reportId)
  }, [state, projectId])

  const keepWaiting = useCallback(() => dispatch({ type: 'keep_waiting', at: Date.now() }), [])
  const retryConnection = useCallback(() => dispatch({ type: 'back_online', at: Date.now() }), [])

  return { state, send, keepWaiting, retryConnection }
}

// ─── Diagnosis card ──────────────────────────────────────────────────────────

function DiagnosisCard({
  diagnosis,
  projectId,
  onTour,
}: {
  diagnosis: Diagnosis
  projectId: string
  onTour: () => void
}) {
  const severityLabel = severityTrafficLabel(diagnosis.severity)
  const severityClass =
    (diagnosis.severity && SEVERITY_TRAFFIC_BADGE[diagnosis.severity]) ??
    'bg-surface-overlay border border-edge-subtle text-fg-muted'
  const categoryLabel = diagnosis.category
    ? (CATEGORY_LABELS[diagnosis.category] ?? diagnosis.category)
    : null
  const showSummary = Boolean(diagnosis.summary) && diagnosis.summary !== diagnosis.title

  return (
    <Card className="p-4 border-ok/30 bg-ok/5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2" data-testid="first-diagnosis-card">
        <div className="min-w-0 flex-1">
          <SignalChip tone="ok" className="uppercase tracking-wider text-3xs">
            Your first diagnosis
          </SignalChip>
          <h3 className="mt-1.5 text-sm font-semibold text-fg text-pretty">{diagnosis.title}</h3>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {severityLabel && <Badge className={severityClass}>{severityLabel}</Badge>}
          {categoryLabel && <Badge tone="neutral">{categoryLabel}</Badge>}
        </div>
      </div>

      {showSummary && (
        <ContainedBlock tone="muted">
          <p className="text-xs leading-relaxed text-fg-secondary">{diagnosis.summary}</p>
        </ContainedBlock>
      )}

      {diagnosis.rootCause && (
        <div>
          <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">Likely root cause</p>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">{diagnosis.rootCause}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Link
          to={reportDetailPath(diagnosis.reportId, projectId)}
          className={`text-xs underline underline-offset-2 ${LINK_ACCENT}`}
        >
          Open the full report →
        </Link>
        <Btn size="sm" variant="ghost" onClick={onTour}>
          Take the 2-minute tour
        </Btn>
      </div>
    </Card>
  )
}

// ─── Phase row (status chip + the right recovery action) ─────────────────────

function PhaseRow({
  state,
  onSend,
  onKeepWaiting,
  onRetryConnection,
  projectId,
}: {
  state: FirstDiagnosisState
  onSend: () => void
  onKeepWaiting: () => void
  onRetryConnection: () => void
  projectId: string
}) {
  const copy = firstDiagnosisCopy(state)
  if (!copy || state.phase === 'diagnosed') return null
  const reportId = trackedReportId(state)

  return (
    <div className="space-y-2" aria-live="polite">
      <ResultChip tone={copy.tone}>
        <span className="font-medium">{copy.headline}</span>
        <span className="text-fg-muted"> — {copy.detail}</span>
      </ResultChip>
      <div className="flex flex-wrap items-center gap-2">
        {state.phase === 'quota_exhausted' && (
          <>
            <Link to="/billing" className={`text-xs underline underline-offset-2 ${LINK_ACCENT}`}>
              Open Billing →
            </Link>
            <Btn size="sm" variant="ghost" onClick={onSend}>
              Try again
            </Btn>
          </>
        )}
        {state.phase === 'classifier_failed' && (
          <>
            <Btn size="sm" variant="primary" onClick={onSend}>
              Send another test report
            </Btn>
            {reportId && (
              <Btn size="sm" variant="ghost" onClick={onKeepWaiting}>
                Keep waiting
              </Btn>
            )}
          </>
        )}
        {state.phase === 'offline' && (
          <Btn size="sm" variant="ghost" onClick={reportId ? onRetryConnection : onSend}>
            Retry now
          </Btn>
        )}
        {state.phase === 'timed_out' && (
          <>
            <Btn size="sm" variant="primary" onClick={onKeepWaiting}>
              Keep waiting
            </Btn>
            {reportId && (
              <Link
                to={reportDetailPath(reportId, projectId)}
                className={`text-xs underline underline-offset-2 ${LINK_ACCENT}`}
              >
                Open it in Reports →
              </Link>
            )}
          </>
        )}
        {state.phase === 'send_failed' && (
          <Btn size="sm" variant="primary" onClick={onSend}>
            Try again
          </Btn>
        )}
      </div>
    </div>
  )
}

// ─── Full screen (onboarding S2) ─────────────────────────────────────────────

interface FirstDiagnosisScreenProps {
  /** External project id — what the SDK sends and what the admin routes key on. */
  projectId: string
  projectName: string
  projectSlug?: string | null
  /** Plaintext ingest key, only available right after project creation. */
  apiKey?: string | null
  /** Called once the diagnosis renders — refetch setup status / stats. */
  onDiagnosed?: (reportId: string) => void
}

export function FirstDiagnosisScreen({
  projectId,
  projectName,
  projectSlug,
  apiKey,
  onDiagnosed,
}: FirstDiagnosisScreenProps) {
  const { state, send, keepWaiting, retryConnection } = useFirstDiagnosis({ projectId, onDiagnosed })
  const [showInstall, setShowInstall] = useState(false)
  const diagnosed = state.phase === 'diagnosed'
  const busy = state.phase === 'sending' || isPolling(state)
  const installVisible = diagnosed || showInstall

  return (
    <div className="space-y-4" data-testid="onboarding-first-diagnosis">
      <Card className="p-5 space-y-4">
        <div>
          <SignalChip tone="brand" className="uppercase tracking-wider text-3xs">
            Step 2 of 2
          </SignalChip>
          <h2 className="mt-1.5 text-base font-semibold text-fg">See your first diagnosis</h2>
          <ContainedBlock tone="muted" className="mt-2">
            <p className="text-xs leading-relaxed text-fg-muted">
              Send one synthetic bug report to <span className="font-mono text-fg-secondary">{projectName}</span>.
              Mushi turns what a user felt into a plain-English diagnosis in about a minute — no SDK
              install needed for this step.
            </p>
          </ContainedBlock>
        </div>

        {!diagnosed && (
          <div className="flex flex-wrap items-center gap-3">
            <Btn
              size="md"
              variant="primary"
              onClick={() => void send()}
              loading={busy}
              disabled={busy}
              data-testid="first-diagnosis-send"
            >
              {state.phase === 'idle' ? 'Send test report' : busy ? 'Waiting for diagnosis…' : 'Send test report'}
            </Btn>
            {state.phase === 'idle' && !showInstall && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  // Which S2 path a builder takes; not a funnel step.
                  trackAdHoc('onboarding_install_first_clicked', { project_id: projectId })
                  setShowInstall(true)
                }}
                className="border-0 bg-transparent shadow-none px-0 py-0 text-2xs text-fg-faint hover:text-fg-muted"
              >
                Install the SDK first instead
              </Btn>
            )}
          </div>
        )}

        <PhaseRow
          state={state}
          onSend={() => void send()}
          onKeepWaiting={keepWaiting}
          onRetryConnection={retryConnection}
          projectId={projectId}
        />

        {diagnosed && (
          <DiagnosisCard
            diagnosis={state.diagnosis}
            projectId={projectId}
            onTour={() => startFirstRunTour({ reportId: state.reportId })}
          />
        )}
      </Card>

      {installVisible && (
        <>
          <Card className="p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">
                {diagnosed ? 'Now get this for real bugs' : 'Install the SDK'}
              </h3>
              <p className="mt-0.5 text-xs text-fg-muted">
                Drop the widget into your app and every report your users file gets the same read.
              </p>
            </div>
            <SdkInstallCard
              projectId={projectId}
              projectSlug={projectSlug}
              apiKey={apiKey ?? undefined}
              compact
              embedded
            />
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">Pull fixes into your editor</h3>
              <p className="mt-0.5 text-xs text-fg-muted">
                Connect Cursor once and ask it for the fix context of any report — the diagnosis,
                the logs, and the code it points at.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ClientConnectButton
                client={getMcpClient('cursor')}
                projectId={projectId}
                projectName={projectName}
                endpoint={RESOLVED_EXTERNAL_API_URL}
                mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                variant="primary"
                size="sm"
              />
              <span className="text-2xs text-fg-faint">or from a terminal:</span>
              <CodeValue value={CURSOR_SETUP_COMMAND} inline />
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

// ─── Compact variant (Overview / Reports empty states) ───────────────────────

interface FirstDiagnosisInlineProps {
  projectId: string
  projectName: string
  /** Called once the diagnosis renders — refetch the surrounding list. */
  onDiagnosed?: (reportId: string) => void
  className?: string
}

export function FirstDiagnosisInline({ projectId, projectName, onDiagnosed, className = '' }: FirstDiagnosisInlineProps) {
  const { state, send, keepWaiting, retryConnection } = useFirstDiagnosis({ projectId, onDiagnosed })
  const diagnosed = state.phase === 'diagnosed'
  const busy = state.phase === 'sending' || isPolling(state)

  return (
    <Card className={`p-4 space-y-3 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3" data-testid="first-diagnosis-inline">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">No reports yet — see your first diagnosis</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
            Send a synthetic bug to <span className="font-mono text-fg-secondary">{projectName}</span> and
            watch it come back classified. Takes about a minute.
          </p>
        </div>
        {!diagnosed && (
          <Btn
            size="sm"
            variant="primary"
            onClick={() => void send()}
            loading={busy}
            disabled={busy}
            className="shrink-0"
          >
            {busy ? 'Waiting…' : 'Send test report'}
          </Btn>
        )}
      </div>

      <PhaseRow
        state={state}
        onSend={() => void send()}
        onKeepWaiting={keepWaiting}
        onRetryConnection={retryConnection}
        projectId={projectId}
      />

      {diagnosed && (
        <DiagnosisCard
          diagnosis={state.diagnosis}
          projectId={projectId}
          onTour={() => startFirstRunTour({ reportId: state.reportId })}
        />
      )}

      <p className="text-2xs text-fg-faint">
        Ready to wire your app?{' '}
        <Link to="/onboarding" className="underline underline-offset-2 hover:text-fg">
          Open the setup guide →
        </Link>
      </p>
    </Card>
  )
}
