import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNow } from '../lib/useNow'
import { useParams, useNavigate, useSearchParams as useReactSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { isValidProjectId, setActiveProjectIdSnapshot } from '../lib/activeProject'
import { reportDetailPath } from '../lib/reportUrl'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  Section,
  Field,
  IdField,
  RecommendedAction,
  EmptyState,
  ErrorAlert,
  Btn,
  Badge,
  Callout,
  InfoHint,
} from '../components/ui'
import { DetailSkeleton } from '../components/skeletons/DetailSkeleton'
import { EditorialErrorState } from '../components/EditorialErrorState'
import { statusLabel, severityLabel, categoryLabel, categoryBadge } from '../lib/tokens'
import { useDispatchFix } from '../lib/dispatchFix'
import { usePublishPageContext } from '../lib/pageContext'
import { FixProgressStream } from '../components/FixProgressStream'
import { useReportComments } from '../lib/reportComments'
import {
  IconUser,
  IconIntelligence,
  IconGlobe,
  IconGauge,
  IconTerminal,
  IconNetwork,
  IconHealth,
  IconSkills,
} from '../components/icons'
import { ReportDetailHeader } from '../components/report-detail/ReportDetailHeader'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { FixCiFeedback } from '../components/fixes/FixCiFeedback'
import { ReportTriageBar } from '../components/report-detail/ReportTriageBar'
import { PdcaReceiptStrip } from '../components/report-detail/PdcaReceiptStrip'
import { ReportPdcaStory } from '../components/report-detail/ReportPdcaStory'
import { BeforeAfterCard } from '../components/report-detail/BeforeAfterCard'
import { ReportPipelineFlow } from '../components/report-detail/ReportPipelineFlow'
import { ReportBranchGraph } from '../components/report-detail/ReportBranchGraph'
import { useAdminMode } from '../lib/mode'
import { usePlatformIntegrations } from '../lib/usePlatformIntegrations'
import { recordVisit } from '../lib/recentEntities'
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
import { TimelineCard } from '../components/report-detail/TimelineCard'
import { screenshotEmptyText } from '../components/report-detail/reportCaptureHints'
import { UnifiedTimelineCard } from '../components/report-detail/UnifiedTimelineCard'
import { ReportRelatedFooter } from '../components/report-detail/ReportRelatedFooter'
import { RegressionChain } from '../components/report-detail/RegressionChain'
import { DiagnosisFixHero } from '../components/report-detail/DiagnosisFixHero'
import { GenerateTestButton } from '../components/report-detail/GenerateTestButton'
import { SentryContextPanel } from '../components/report-detail/SentryContextPanel'
import { ReportReplayPlayer } from '../components/report-detail/ReportReplayPlayer'
import { AgentTracePanel } from '../components/report-detail/AgentTracePanel'
import { deriveRecommendation } from '../components/report-detail/deriveRecommendation'
import type { ReportDetail } from '../components/report-detail/types'
import { DispatchPreflightBanner } from '../components/reports/DispatchPreflightBanner'
import { useDispatchPreflight, type PreflightState } from '../lib/useDispatchPreflight'
import { canMergeFix, pickPrimaryFixAttempt } from '../lib/mergeFix'
import { MergeFixPreflight } from '../components/fixes/MergeFixPreflight'
import { TesterSubmissionCard } from '../components/report-detail/TesterSubmissionCard'
import { SdkUpgradeCTA } from '../components/SdkUpgradeCTA'
import { useProjectSnapshots } from '../lib/useProjectSnapshots'
import type { SdkStatus } from '../components/SdkVersionBadge'
import { CHIP_TONE } from '../lib/chipTone'

export function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useReactSearchParams()
  const activeProjectId = useActiveProjectId()
  const toast = useToast()
  const path = id ? `/v1/admin/reports/${id}` : null
  const { data: serverReport, loading, error, reload } = usePageData<ReportDetail>(path)
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    const fromUrl = searchParams.get('project')
    if (isValidProjectId(fromUrl)) setActiveProjectIdSnapshot(fromUrl)
  }, [searchParams])

  useEffect(() => {
    if (!serverReport?.project_id || !isValidProjectId(serverReport.project_id)) return
    if (serverReport.project_id !== activeProjectId) {
      setActiveProjectIdSnapshot(serverReport.project_id)
    }
  }, [serverReport?.project_id, activeProjectId])

  useEffect(() => {
    if (serverReport) setReport(serverReport)
  }, [serverReport])

  useEffect(() => {
    if (!serverReport) return
    recordVisit({
      kind: 'report',
      id: serverReport.id,
      label: serverReport.description?.slice(0, 80) ?? `Report ${serverReport.id.slice(0, 8)}`,
      url: reportDetailPath(serverReport.id, serverReport.project_id),
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
          lead="It may have been deleted, retention-swept, or it never existed under this id. If you use multiple projects, switch the ProjectSwitcher to the report's project (or add ?project=<uuid> to the URL) — a mismatched active project is the most common cause of this 404."
          detail={
            <code className="break-all rounded bg-editorial-paper-wash px-2 py-0.5">
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

  return <ReportDetailView report={report} onTriage={handleTriage} saving={saving} savedAt={savedAt} onReload={reload} />
}

interface ReportDetailViewProps {
  report: ReportDetail
  onTriage: (updates: Record<string, string>) => Promise<void>
  saving: boolean
  savedAt: number | null
  onReload: () => void
}

// ── Recommended Skills section ────────────────────────────────────────────────
function RecommendedSkillsSection({ report }: { report: ReportDetail }) {
  const { push } = useToast()
  // Memoize addToast so it has a stable identity — an inline arrow would be
  // re-created on every render and invalidate the startPipeline useCallback.
  const addToast = useCallback(
    (t: { type: string; message: string }) =>
      push({ tone: t.type as 'success' | 'error' | 'info' | 'warn', message: t.message }),
    [push],
  )
  const navigate = useNavigate()
  const [searchParams] = useReactSearchParams()
  // Support ?skill=<slug> triage link — pre-select the skill
  const preselectedSlug = searchParams.get('skill')
  const [startingSlug, setStartingSlug] = useState<string | null>(null)
  const [mode, setMode] = useState<'handoff' | 'cloud'>('handoff')
  const projectId = report.project_id

  const skills = report.recommended_skills ?? []

  const startPipeline = useCallback(async (slug: string) => {
    setStartingSlug(slug)
    try {
      // apiFetch resolves with an { ok, data, error } envelope and does NOT
      // throw on HTTP errors, so we must inspect res.ok explicitly — a 404
      // (skill not synced), 409 (duplicate), or 429 (rate limit) all return
      // ok:false and must not show a success toast.
      const res = await apiFetch<{ id: string }>('/v1/admin/skills/pipelines', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, root_skill_slug: slug, report_id: report.id, mode }),
      })
      if (!res.ok) {
        addToast({ type: 'error', message: res.error?.message ?? "Couldn't start the pipeline — try again" })
        return
      }
      addToast({ type: 'success', message: `Pipeline started — track it in Skill Pipelines` })
      navigate('/skills?tab=pipelines')
    } catch (err) {
      addToast({ type: 'error', message: String(err) })
    } finally {
      setStartingSlug(null)
    }
  }, [projectId, report.id, mode, addToast, navigate])

  // If a ?skill= triage link was used and there are no recommendations yet,
  // show the pre-selected skill as a prompt to start its pipeline.
  const displaySkills = skills.length > 0 ? skills : preselectedSlug
    ? [{ slug: preselectedSlug, title: preselectedSlug, rationale: 'Requested via triage link.' }]
    : []

  if (displaySkills.length === 0) return null

  return (
    <Section title="Recommended skills" icon={<IconSkills />}>
      <div className="flex flex-col gap-2">
        <p className="text-xs text-fg-muted">
          Skills matched to this report during classification. Start a skill run to guide a Cursor agent through the fix.
        </p>

        <div className="flex gap-2 items-center mb-1">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'handoff' | 'cloud')}
            className="input text-xs py-1 h-7"
          >
            <option value="handoff">Handoff (local Cursor agent)</option>
            <option value="cloud">Cloud (auto Cursor Cloud)</option>
          </select>
        </div>

        {displaySkills.map((skill) => (
          <div
            key={skill.slug}
            className={[
              'flex items-start gap-3 p-2.5 rounded-lg border',
              preselectedSlug === skill.slug
                ? 'border-brand bg-brand/5'
                : 'border-edge-subtle bg-surface-3',
            ].join(' ')}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-fg">{skill.title || skill.slug}</p>
              <p className="text-2xs font-mono text-fg-muted">{skill.slug}</p>
              <p className="text-2xs text-fg-muted mt-0.5">{skill.rationale}</p>
            </div>
            <Btn
              type="button"
              variant="primary"
              size="sm"
              onClick={() => startPipeline(skill.slug)}
              loading={startingSlug === skill.slug}
              className="flex-shrink-0"
            >
              {startingSlug === skill.slug ? 'Starting…' : 'Run pipeline →'}
            </Btn>
          </div>
        ))}

        <p className="text-2xs text-fg-muted mt-1">
          Share triage link:{' '}
          <code className="font-mono text-brand">
            {typeof window !== 'undefined' ? window.location.origin : ''}/reports/{report.id}?skill={displaySkills[0]?.slug}
          </code>
        </p>
      </div>
    </Section>
  )
}

function ReportDetailView({ report, onTriage, saving, savedAt, onReload }: ReportDetailViewProps) {
  const toast = useToast()
  const { isAdvanced } = useAdminMode()
  const { state: dispatchState, dispatch } = useDispatchFix(report.id, report.project_id)
  const { comments } = useReportComments({ reportId: report.id, projectId: report.project_id })
  const commentCount = comments.length
  const platform = usePlatformIntegrations()
  const latestFix = pickPrimaryFixAttempt(report.fix_attempts)

  // Tick the clock every second only while the agent is actively running so
  // the elapsed chip in the recommendation banner live-updates without
  // triggering a global setInterval storm across every open tab.
  const isInFlight =
    dispatchState.status === 'queueing' ||
    dispatchState.status === 'queued' ||
    dispatchState.status === 'running' ||
    report.status === 'fixing'
  const nowMs = useNow(1000, isInFlight)

  const recommendation = useMemo(
    () => deriveRecommendation(report, dispatchState, commentCount, dispatch, nowMs),
    [report, dispatchState, commentCount, dispatch, nowMs],
  )

  const preflight = useDispatchPreflight(report.project_id)

  // Show the preflight banner on reports that could be dispatched: not already
  // in a terminal state, and not currently being fixed.
  const isDispatchEligible =
    report.status !== 'fixed' &&
    report.status !== 'dismissed' &&
    report.status !== 'fixing' &&
    dispatchState.status !== 'queueing' &&
    dispatchState.status !== 'queued' &&
    dispatchState.status !== 'running' &&
    dispatchState.status !== 'completed'

  const isDispatchBusy = dispatchState.status === 'queueing' || dispatchState.status === 'queued' || dispatchState.status === 'running'
  const reporterShort = report.reporter_token_hash?.slice(0, 8) ?? 'unknown'
  const mergeTarget = latestFix && canMergeFix(latestFix) ? latestFix : null

  const handleMerged = useCallback(
    (reportStatus: string | null) => {
      toast.success(
        'PR merged',
        reportStatus === 'fixed'
          ? 'Report marked Fixed — reporter will be notified.'
          : 'Merge recorded.',
      )
      onReload()
    },
    [onReload, toast],
  )

  return (
    <div>
      <PageHeaderBar
        title="Report detail"
        contextChip={null}

        helpTitle="About this report"
        helpWhatIsIt="A single bug report submitted from your app, auto-classified by the LLM pipeline and queued for human triage."
        helpUseCases={[
          'Decide if this report is real, a duplicate, or noise',
          'Set status and severity to drive routing and notifications',
          'Dispatch an autofix attempt, or reply to the reporter directly',
        ]}
        helpHowToUse="Use the Recommended action below for the fastest path. Otherwise set Status / Severity manually, dispatch a fix, push to your tracker, or reply in the triage thread."
      />

      <PagePosture
        maxRows={1}
        className="mb-3"
        slots={[
          {
            id: 'report-detail-ops',
            priority: POSTURE_PRIORITY.status,
            show: Boolean(latestFix?.pr_url || isDispatchEligible),
            children: (
              <div className="flex flex-wrap items-center gap-2">
                {latestFix?.pr_url ? (
                  <FixCiFeedback
                    fixId={latestFix.id}
                    prUrl={latestFix.pr_url}
                    prNumber={latestFix.pr_number}
                    ciConclusion={latestFix.check_run_conclusion}
                    ciStatus={latestFix.check_run_status}
                    ciUpdatedAt={latestFix.check_run_updated_at}
                    compact
                  />
                ) : null}
                {isDispatchEligible ? (
                  <DispatchPreflightBanner preflight={preflight} className="min-w-0 flex-1" />
                ) : null}
              </div>
            ),
          },
        ]}
      />

      <ReportDetailHeader report={report} reporterShort={reporterShort} />

      <Section title="Identifiers" className="mb-3">
        <IdField label="Report ID" value={report.id} full tone="id" />
        <IdField label="Project ID" value={report.project_id} full tone="id" />
        {report.session_id ? (
          <IdField label="Session ID" value={report.session_id} full />
        ) : null}
        {report.reporter_token_hash ? (
          <IdField
            label="Reporter token hash"
            value={report.reporter_token_hash}
            full
            tooltip="Opaque hash linking this report to a reporter identity — not PII."
          />
        ) : null}
      </Section>

      <RegressionChain report={report} className="mb-3" />

      {/* The answer first: plain-English diagnosis + paste-ready fix prompt.
          Delivers the brand sub-promise as one surface at the top; the
          detailed classification + evidence sections stay below. */}
      <DiagnosisFixHero report={report} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GenerateTestButton report={report} />
      </div>

      <ReportPipelineFlow report={report} dispatchState={dispatchState} />

      {!isAdvanced && (
        <ReportPdcaStory report={report} dispatchState={dispatchState} />
      )}

      <PdcaReceiptStrip
        report={report}
        dispatchState={dispatchState}
        className="mb-3"
      />

      <BeforeAfterCard report={report} />

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
        meta={recommendation.meta}
        actions={recommendation.actions}
      />

      {mergeTarget && (
        <div className="mb-3 flex justify-end">
          <MergeFixPreflight
            fixId={mergeTarget.id}
            prUrl={mergeTarget.pr_url!}
            prNumber={mergeTarget.pr_number}
            summary={null}
            ciConclusion={mergeTarget.check_run_conclusion}
            ciStatus={mergeTarget.check_run_status}
            ciUpdatedAt={mergeTarget.check_run_updated_at}
            onMerged={handleMerged}
          />
        </div>
      )}

      <ReportTriageBar
        report={report}
        onTriage={onTriage}
        saving={saving}
        savedAt={savedAt}
        dispatchState={dispatchState}
        onDispatch={dispatch}
        isDispatchBusy={isDispatchBusy}
        preflight={preflight}
      />

      {report.tester_submission && (
        <Section title="Mushi Bounties" className="mb-3">
          <TesterSubmissionCard
            submission={report.tester_submission}
            onReviewed={() => {
              onReload()
            }}
          />
        </Section>
      )}

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
                <Badge className={categoryBadge(report.user_category)}>
                  {categoryLabel(report.user_category)}
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
              {screenshotEmptyText(report)}
            </p>
          )}
        </Section>

        <Section title="LLM classification" icon={<IconIntelligence />}>
          {report.stage1_classification ? (
            <ClassificationFields report={report} />
          ) : report.processing_error ? (
            <Callout tone="danger" label="Classification failed">
              {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
              <p className="text-[0.8125rem] font-mono text-fg-secondary leading-relaxed wrap-break-word">
                {report.processing_error}
              </p>
            </Callout>
          ) : (
            <div className="text-fg-muted text-xs italic">Pending classification — refresh in a few seconds.</div>
          )}
        </Section>

        {/* Skill recommendations — shown when Stage 2 has classified */}
        {(report.recommended_skills?.length || report.status === 'classified') && (
          <RecommendedSkillsSection report={report} />
        )}

        <Section title="Environment" icon={<IconGlobe />}>
          <EnvironmentFields
            environment={report.environment}
            sessionId={report.session_id}
          />
        </Section>

        {(report.sdk_package || report.sdk_version || report.app_version) && (
          <Section title="Device & build" icon={<IconHealth />}>
            <DeviceAndBuildPanel report={report} preflight={preflight} />
          </Section>
        )}

        <Section title="Performance metrics" icon={<IconGauge />}>
          <PerformanceMetrics metrics={report.performance_metrics} />
        </Section>

        <Section title="Console logs" icon={<IconTerminal />}>
          <ConsoleLogs logs={report.console_logs} />
        </Section>

        <Section title="Network requests" icon={<IconNetwork />}>
          <NetworkLogs logs={report.network_logs} projectId={report.project_id} />
        </Section>

        <Section title="Unified timeline" icon={<IconTerminal />}>
          <UnifiedTimelineCard reportId={report.id} />
        </Section>

        <Section title="Repro timeline" icon={<IconTerminal />}>
          <TimelineCard report={report} />
        </Section>
      </div>

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

      <div className="mt-3 grid gap-3 ff-medium:grid-cols-2">
        <ReportReplayPlayer
          events={(report.custom_metadata?.replayEvents as unknown[] | undefined) ?? null}
          reportId={report.id}
          replayPath={(report.custom_metadata?.replayPath as string | undefined) ?? null}
        />
        <AgentTracePanel report={report} />
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

/** Platform chip colour map — mirrors the same sentiment used by InboxPage. */
const PLATFORM_BADGE: Record<string, string> = {
  ios:     CHIP_TONE.infoSubtle,
  android: CHIP_TONE.okSubtle,
  web:     'bg-brand/12 text-brand border border-brand/28',
  macos:   'bg-surface-overlay text-fg-secondary border-edge-subtle',
  windows: 'bg-surface-overlay text-fg-secondary border-edge-subtle',
}

/**
 * Device & Build panel — renders SDK package, version, app version, and
 * the resolved platform tag in a compact definition grid. Mirrors the
 * density of EnvironmentFields so the two panels feel like one surface.
 */
function DeviceAndBuildPanel({
  report,
  preflight,
}: {
  report: ReportDetail
  preflight: PreflightState
}) {
  const snapshots = useProjectSnapshots()
  const snapshot = report.project_id ? snapshots.byId.get(report.project_id) : undefined
  const githubReady = preflight.checks.find((c) => c.key === 'github')?.ready ?? false
  const platform = (report.environment?.platform ?? '').toLowerCase()
  const rows: Array<{ label: string; value: string }> = [
    report.sdk_package  ? { label: 'SDK',         value: report.sdk_package }  : null,
    report.sdk_version  ? { label: 'SDK version',  value: report.sdk_version }  : null,
    report.app_version  ? { label: 'App version',  value: report.app_version }  : null,
    platform            ? { label: 'Platform',     value: platform }             : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>

  if (rows.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <span className="text-2xs font-medium text-fg-muted w-24 shrink-0">{row.label}</span>
            {row.label === 'Platform' ? (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-2xs font-semibold uppercase tracking-wider ${PLATFORM_BADGE[row.value] ?? 'bg-surface-overlay text-fg-secondary border-edge-subtle'}`}
              >
                {row.value}
              </span>
            ) : (
              <code className="text-2xs font-mono text-fg bg-surface-overlay/60 px-1.5 py-0.5 rounded-sm">
                {row.value}
              </code>
            )}
          </div>
        ))}
      </div>
      {report.sdk_version && snapshot && (
        <SdkUpgradeCTA
          package_={report.sdk_package ?? snapshot.sdk_package ?? null}
          observedVersion={report.sdk_version}
          latestVersion={snapshot.sdk_latest_version ?? null}
          status={(snapshot.sdk_status ?? 'unknown') as SdkStatus}
          projectId={githubReady && report.project_id ? report.project_id : null}
          compact
        />
      )}
    </div>
  )
}
