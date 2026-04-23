import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  Section,
  Field,
  PageHelp,
  RecommendedAction,
  EmptyState,
  ErrorAlert,
  Btn,
  Badge,
  Callout,
  InfoHint,
} from '../components/ui'
import { DetailSkeleton } from '../components/skeletons/DetailSkeleton'
import { statusLabel, severityLabel, CATEGORY_LABELS, CATEGORY_BADGE } from '../lib/tokens'
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
} from '../components/icons'
import { ReportDetailHeader } from '../components/report-detail/ReportDetailHeader'
import { ReportTriageBar } from '../components/report-detail/ReportTriageBar'
import { PdcaReceiptStrip } from '../components/report-detail/PdcaReceiptStrip'
import { ReportPdcaStory } from '../components/report-detail/ReportPdcaStory'
import { ReportBranchGraph } from '../components/report-detail/ReportBranchGraph'
import { useAdminMode } from '../lib/mode'
import { usePlatformIntegrations } from '../lib/usePlatformIntegrations'
import {
  ClassificationFields,
  ScreenshotHero,
} from '../components/report-detail/ReportClassification'
import {
  PerformanceMetrics,
  ConsoleLogs,
  NetworkLogs,
  EnvironmentFields,
} from '../components/report-detail/ReportEvidence'
import { ReportComments } from '../components/report-detail/ReportComments'
import { ReportRelatedFooter } from '../components/report-detail/ReportRelatedFooter'
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
    const isNotFound = /not_?found|404/i.test(error)
    if (isNotFound) {
      return (
        <EmptyState
          title="Report not found"
          description="It may have been deleted, or you don't have access to it."
          action={
            <Link
              to="/reports"
              className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
            >
              Back to reports
            </Link>
          }
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
      <Link to="/reports" className="text-xs text-fg-muted hover:text-fg-secondary mb-3 inline-flex items-center gap-1">
        <span aria-hidden="true">&larr;</span> Back to reports
      </Link>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="User report" icon={<IconUser />}>
          {report.user_category && (
            <div className="mb-2.5">
              <div className="flex items-center gap-1 text-xs text-fg-muted font-medium">
                User category
                <InfoHint content="What the reporter said the issue was about, before LLM classification." />
              </div>
              <div className="mt-1">
                <Badge
                  className={CATEGORY_BADGE[report.user_category] ?? 'bg-surface-overlay text-fg-secondary border border-edge-subtle'}
                >
                  {CATEGORY_LABELS[report.user_category] ?? report.user_category}
                </Badge>
              </div>
            </div>
          )}
          <Field label="Description" value={report.description} longForm />
          {report.user_intent && (
            <Field
              label="User intent"
              value={report.user_intent}
              longForm
              tooltip="What the reporter said they were trying to do when the issue happened."
            />
          )}
          {!report.screenshot_url && (
            <p className="text-2xs text-fg-faint italic mt-2">
              No screenshot was captured for this report.
            </p>
          )}
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
            <div className="text-fg-muted text-xs italic">Pending classification — refresh in a few seconds.</div>
          )}
        </Section>

        <Section title="Environment" icon={<IconGlobe />}>
          <EnvironmentFields
            environment={report.environment}
            sessionId={report.session_id}
          />
        </Section>

        <Section title="Performance metrics" icon={<IconGauge />}>
          <PerformanceMetrics metrics={report.performance_metrics} />
        </Section>

        <Section title="Console logs" icon={<IconTerminal />}>
          <ConsoleLogs logs={report.console_logs} />
        </Section>

        <Section title="Network requests" icon={<IconNetwork />}>
          <NetworkLogs logs={report.network_logs} />
        </Section>
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
