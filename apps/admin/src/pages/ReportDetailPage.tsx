import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  Section,
  PageHelp,
  RecommendedAction,
  EmptyState,
  ErrorAlert,
  Btn,
  Callout,
} from '../components/ui'
import { DetailSkeleton } from '../components/skeletons/DetailSkeleton'
import { EditorialErrorState } from '../components/EditorialErrorState'
import { statusLabel, severityLabel } from '../lib/tokens'
import { useDispatchFix } from '../lib/dispatchFix'
import { usePublishPageContext } from '../lib/pageContext'
import { FixProgressStream } from '../components/FixProgressStream'
import { useReportComments } from '../lib/reportComments'
import {
  IconUser,
  IconSparkle,
  IconGlobe,
  IconGauge,
  IconTerminal,
  IconNetwork,
  IconHealth,
} from '../components/icons'
import { ReportDetailHeader } from '../components/report-detail/ReportDetailHeader'
import { ActionPill } from '../components/report-detail/ReportSurface'
import { ReportTriageBar } from '../components/report-detail/ReportTriageBar'
import { CursorAgentLaunch } from '../components/report-detail/CursorAgentLaunch'
import { PdcaReceiptStrip } from '../components/report-detail/PdcaReceiptStrip'
import { ReportPdcaStory } from '../components/report-detail/ReportPdcaStory'
import { ReportBranchGraph } from '../components/report-detail/ReportBranchGraph'
import { useAdminMode } from '../lib/mode'
import { usePlatformIntegrations } from '../lib/usePlatformIntegrations'
import { recordVisit } from '../lib/recentEntities'
import {
  ClassificationFields,
  ScreenshotHero,
  EmptySectionMessage,
} from '../components/report-detail/ReportClassification'
import {
  PerformanceMetrics,
  ConsoleLogs,
  NetworkLogs,
  EnvironmentFields,
  DeviceAndBuildPanel,
} from '../components/report-detail/ReportEvidence'
import { UserReportFields } from '../components/report-detail/ReportUserSection'
import { ReportComments } from '../components/report-detail/ReportComments'
import { TimelineCard } from '../components/report-detail/TimelineCard'
import { ReportRelatedFooter } from '../components/report-detail/ReportRelatedFooter'
import { SentryContextPanel } from '../components/report-detail/SentryContextPanel'
import { TesterSubmissionCard } from '../components/report-detail/TesterSubmissionCard'
import { deriveRecommendation } from '../components/report-detail/deriveRecommendation'
import type { ReportDetail } from '../components/report-detail/types'

export function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const path = id ? `/v1/admin/reports/${id}` : null
  const { data: serverReport, loading, error, reload } = usePageData<ReportDetail>(path)
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    if (serverReport) setReport(serverReport)
  }, [serverReport])

  useEffect(() => {
    if (!serverReport) return
    recordVisit({
      kind: 'report',
      id: serverReport.id,
      label: serverReport.description?.slice(0, 80) ?? `Report ${serverReport.id.slice(0, 8)}`,
      url: `/reports/${serverReport.id}`,
    })
  }, [serverReport])

  // Make the browser tab read "MSHREP-abcd1234 · <category> — Mushi Mushi"
  // so stacked tabs for multiple reports are distinguishable without
  // hovering. Summary carries status + severity so Ask Mushi shows
  // triage state at a glance.
  const shortId = id ? id.slice(0, 8) : ''
  const reportTitle = report?.description
    ? `${shortId} · ${report.description.slice(0, 50)}${report.description.length > 50 ? '…' : ''}`
    : shortId
      ? `Report ${shortId}`
      : 'Report'
  usePublishPageContext({
    route: `/reports/${id ?? ''}`,
    title: reportTitle,
    summary: loading
      ? 'Loading report…'
      : report
        ? `${statusLabel(report.status)} · ${severityLabel(report.severity ?? null) || 'unscored'}`
        : undefined,
    selection: report ? { kind: 'report', id: report.id, label: report.description ?? report.id } : undefined,
    // A still-open critical report deserves the favicon nudge — the
    // operator walking away from this tab for a meeting should see the
    // red dot when they glance back.
    criticalCount: report && report.severity === 'critical' && report.status !== 'resolved' ? 1 : 0,
    questions: report
      ? [
          'Why did this report happen — root cause in 1 paragraph?',
          'Show me similar reports in this project.',
          'Draft a fix dispatch summary I can paste into a PR.',
        ]
      : undefined,
    mentionables: report
      ? [
          {
            kind: 'report' as const,
            id: report.id,
            label: report.description?.slice(0, 60) ?? report.id,
            sublabel: `severity: ${report.severity ?? 'unscored'}`,
          },
        ]
      : undefined,
  })

  const handleTriage = async (updates: Record<string, string>) => {
    if (!id || !report) return
    setSaving(true)
    const previous = report
    setReport({ ...report, ...updates })
    const res = await apiFetch(`/v1/admin/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
    if (res.ok) {
      setSavedAt(Date.now())
      const summary = describeTriageUpdate(updates)
      if (summary) toast.success('Triage saved', summary)
    } else {
      setReport(previous)
      toast.error(
        'Could not save triage update',
        res.error?.message ?? 'The server rejected the change. Try again or check your connection.',
      )
    }
    setSaving(false)
  }

  if (!id) {
    return (
      <EmptyState
        title="No report selected"
        description="Open a report from the Reports list."
        action={<Btn variant="ghost" size="sm" onClick={() => history.back()}>Back</Btn>}
      />
    )
  }

  if (loading) return <DetailSkeleton label="Loading report" />

  if (error) {
    // Distinguish "the resource genuinely does not exist" (404) from a
    // transient failure (network blip, 500, RLS denial). Only the latter
    // is recoverable by re-trying — re-trying a 404 just shows the same
    // 404 again and the visible "Retry" button reads as a dev placeholder.
    // The error message includes the HTTP status prefix from apiFetch
    // (`${status}: ${body}`), so the regex matches both `404:` from the
    // status line and any `not_found` / `not found` token in a JSON body.
    const isNotFound = /\b404\b|not[\s_-]?found/i.test(error)
    if (isNotFound) {
      return (
        <EditorialErrorState
          eyebrow="404 · report"
          headline={
            <>
              We can't find <em>that report</em>.
            </>
          }
          lead="It may have been deleted, retention-swept, or it never existed under this id. You may also lack access if it belongs to a different organisation."
          detail={
            <code className="break-all rounded bg-[var(--mushi-paper-wash)] px-2 py-0.5">
              {id}
            </code>
          }
          primary={{ href: '/reports', label: 'Back to reports' }}
          secondary={{
            href: 'https://kensaur.us/mushi-mushi/docs/concepts/judge-loop',
            label: 'Open docs',
            external: true,
          }}
        />
      )
    }
    return <ErrorAlert message={`Could not load report: ${error}`} onRetry={reload} />
  }

  if (!report) return <DetailSkeleton label="Loading report" />

  return <ReportDetailView report={report} onTriage={handleTriage} saving={saving} savedAt={savedAt} />
}

interface ReportDetailViewProps {
  report: ReportDetail
  onTriage: (updates: Record<string, string>) => Promise<void>
  saving: boolean
  savedAt: number | null
}

function ReportDetailView({ report, onTriage, saving, savedAt }: ReportDetailViewProps) {
  const { isAdvanced } = useAdminMode()
  const { state: dispatchState, dispatch } = useDispatchFix(report.id, report.project_id)
  const { comments } = useReportComments({ reportId: report.id, projectId: report.project_id })
  const commentCount = comments.length
  const platform = usePlatformIntegrations()
  const latestFix = report.fix_attempts?.[0]

  const recommendation = useMemo(
    () => deriveRecommendation(report, dispatchState, commentCount, dispatch),
    [report, dispatchState, commentCount, dispatch],
  )

  const isDispatchBusy = dispatchState.status === 'queueing' || dispatchState.status === 'queued' || dispatchState.status === 'running'
  const reporterShort = report.reporter_token_hash?.slice(0, 8) ?? 'unknown'

  return (
    <div>
      <ActionPill to="/reports" tone="neutral" className="mb-3">
        ← Back to reports
      </ActionPill>

      <PageHelp
        title="About this report"
        whatIsIt="A single bug report submitted from your app, auto-classified by the LLM pipeline and queued for human triage."
        useCases={[
          'Decide if this report is real, a duplicate, or noise',
          'Set status and severity to drive routing and notifications',
          'Dispatch an autofix attempt, or reply to the reporter directly',
        ]}
        howToUse="Use the Recommended action below for the fastest path. Otherwise set Status / Severity manually, dispatch a fix, push to your tracker, or reply in the triage thread."
      />

      <ReportDetailHeader report={report} reporterShort={reporterShort} />

      {!isAdvanced && (
        <ReportPdcaStory report={report} dispatchState={dispatchState} />
      )}

      <PdcaReceiptStrip
        report={report}
        dispatchState={dispatchState}
        className="mb-3"
      />

      {latestFix && (
        <ReportBranchGraph
          fix={latestFix}
          traceUrl={platform.traceUrl(latestFix.langfuse_trace_id)}
          className="mb-3"
        />
      )}

      {/* Screenshot hero — promoted out of the User-report section so it's
          the first piece of evidence triagers see. audit P0. */}
      {report.screenshot_url && (
        <ScreenshotHero url={report.screenshot_url} className="mb-3" />
      )}

      <RecommendedAction
        title={recommendation.title}
        description={recommendation.description}
        cta={recommendation.cta}
        tone={recommendation.tone}
      />

      <ReportTriageBar
        report={report}
        onTriage={onTriage}
        saving={saving}
        savedAt={savedAt}
        dispatchState={dispatchState}
        onDispatch={dispatch}
        isDispatchBusy={isDispatchBusy}
      />

      <FixProgressStream reportId={report.id} dispatchState={dispatchState} />

      {/* Cursor agent handoff — gives operators a way to drive the fix
          loop themselves with full visibility, vs. delegating to the
          internal fix-worker. Only shown for reports that haven't been
          dispatched yet, since after dispatch the fix-worker owns the
          loop and a parallel Cursor agent would race. */}
      {report.status !== 'fixed' && report.status !== 'dismissed' && dispatchState.status === 'idle' && (
        <CursorAgentLaunch report={report} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="User report" icon={<IconUser />}>
          <UserReportFields report={report} />
        </Section>

        <Section title="LLM classification" icon={<IconSparkle />}>
          {report.stage1_classification ? (
            <ClassificationFields report={report} />
          ) : report.processing_error ? (
            <Callout tone="danger" label="Classification failed">
              <p className="text-[0.8125rem] font-mono text-fg-secondary leading-relaxed wrap-break-word">
                {report.processing_error}
              </p>
            </Callout>
          ) : (
            <EmptySectionMessage
              text="Pending classification — refresh in a few seconds."
              hint="The Stage-1 LLM classifier runs asynchronously after ingest."
            />
          )}
        </Section>

        <Section title="Environment" icon={<IconGlobe />}>
          <EnvironmentFields
            environment={report.environment}
            sessionId={report.session_id}
          />
        </Section>

        {(report.sdk_package || report.sdk_version || report.app_version) && (
          <Section title="Device & build" icon={<IconHealth />}>
            <DeviceAndBuildPanel report={report} />
          </Section>
        )}

        <Section title="Performance metrics" icon={<IconGauge />}>
          <PerformanceMetrics metrics={report.performance_metrics} />
        </Section>

        <Section title="Console logs" icon={<IconTerminal />}>
          <ConsoleLogs logs={report.console_logs} />
        </Section>

        <Section title="Network requests" icon={<IconNetwork />}>
          <NetworkLogs logs={report.network_logs} />
        </Section>

        <Section title="Repro timeline" icon={<IconTerminal />}>
          <TimelineCard report={report} />
        </Section>
      </div>

      {/* Mushi Bounties: reviewer grading card when report came from a tester */}
      {report.tester_submission_id && report.tester_submission && (
        <div className="mt-3 rounded-lg border border-brand/20 bg-brand/5 p-4">
          <TesterSubmissionCard
            submission={report.tester_submission}
            onReviewed={reload}
          />
        </div>
      )}

      <div className="mt-3">
        <SentryContextPanel
          mushiBreadcrumbs={report.breadcrumbs}
          sentryContext={report.custom_metadata?.sentry}
          sentryEventId={report.sentry_event_id}
          sentryReplayId={report.sentry_replay_id}
          sentryTraceId={report.sentry_trace_id}
          sentryRelease={report.sentry_release}
          sentryEnvironment={report.sentry_environment}
          sentryIssueUrl={report.sentry_issue_url}
          tags={report.tags}
        />
      </div>

      <div className="mt-3">
        <ReportComments reportId={report.id} projectId={report.project_id} />
      </div>

      <ReportRelatedFooter report={report} dispatchState={dispatchState} />
    </div>
  )
}

function describeTriageUpdate(updates: Record<string, string>): string | null {
  const parts: string[] = []
  if (updates.status) parts.push(`status \u2192 ${statusLabel(updates.status)}`)
  if (updates.severity !== undefined) {
    parts.push(updates.severity ? `severity \u2192 ${severityLabel(updates.severity)}` : 'severity cleared')
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : null
}
