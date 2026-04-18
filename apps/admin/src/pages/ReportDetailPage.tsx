import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  Section,
  Field,
  IdField,
  Loading,
  SelectField,
  PageHelp,
  Badge,
  RelativeTime,
  RecommendedAction,
  ImageZoom,
  InfoHint,
  CopyButton,
  Tooltip,
  EmptyState,
  ErrorAlert,
  Btn,
} from '../components/ui'
import {
  STATUS,
  SEVERITY,
  CATEGORY_LABELS,
  STATUS_LABELS,
  SEVERITY_LABELS,
  statusLabel,
  severityLabel,
} from '../lib/tokens'
import { useDispatchFix } from '../lib/dispatchFix'
import type { DispatchState } from '../lib/dispatchFix'
import { FixProgressStream } from '../components/FixProgressStream'
import { useReportPresence } from '../lib/reportPresence'
import { useReportComments } from '../lib/reportComments'
import {
  IconUser,
  IconSparkle,
  IconGlobe,
  IconGauge,
  IconTerminal,
  IconNetwork,
  IconChat,
  IconCamera,
  IconLink,
  IconExternalLink,
  IconArrowRight,
} from '../components/icons'

interface ReportEnvironment {
  url?: string
  userAgent?: string
  platform?: string
  language?: string
  timezone?: string
  viewport?: { width: number; height: number }
  // Allow forward-compatible fields the SDK may add (deviceMemory,
  // hardwareConcurrency, connection, etc.) without forcing a code change.
  [key: string]: unknown
}

interface ReportDetail {
  id: string
  project_id: string
  description: string
  user_category: string
  user_intent: string | null
  screenshot_url: string | null
  environment: ReportEnvironment
  console_logs: Array<{ level: string; message: string; timestamp: number }> | null
  network_logs: Array<{ method: string; url: string; status: number; duration: number }> | null
  performance_metrics: Record<string, number> | null
  stage1_classification: Record<string, unknown> | null
  stage1_model: string | null
  stage1_latency_ms: number | null
  category: string
  severity: string | null
  summary: string | null
  component: string | null
  confidence: number | null
  status: string
  reporter_token_hash: string
  session_id: string | null
  created_at: string
  processing_error: string | null
}

const STATUS_OPTS = ['new', 'classified', 'fixing', 'fixed', 'dismissed']
const SEV_OPTS = ['critical', 'high', 'medium', 'low']

const PERF_TOOLTIPS: Record<string, string> = {
  LCP: 'Largest Contentful Paint — time until the largest visible element rendered. Target < 2.5s.',
  CLS: 'Cumulative Layout Shift — visual stability score. Target < 0.1.',
  INP: 'Interaction to Next Paint — responsiveness to clicks/taps. Target < 200ms.',
  TTFB: 'Time to First Byte — server response time. Target < 800ms.',
  FCP: 'First Contentful Paint — time until any content first appears. Target < 1.8s.',
  FID: 'First Input Delay — legacy metric, replaced by INP.',
}

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

  if (loading) return <Loading text="Loading report..." />

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

  if (!report) return <Loading text="Loading report..." />

  return <ReportDetailView report={report} onTriage={handleTriage} saving={saving} savedAt={savedAt} />
}

interface ReportDetailViewProps {
  report: ReportDetail
  onTriage: (updates: Record<string, string>) => Promise<void>
  saving: boolean
  savedAt: number | null
}

function ReportDetailView({ report, onTriage, saving, savedAt }: ReportDetailViewProps) {
  const { state: dispatchState, dispatch } = useDispatchFix(report.id, report.project_id)
  const { comments } = useReportComments({ reportId: report.id, projectId: report.project_id })
  const commentCount = comments.length

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
        howToUse="Use the Recommended action below for the fastest path. Otherwise set Status / Severity manually, dispatch a fix, or reply in the triage thread."
      />

      <DetailHeader report={report} reporterShort={reporterShort} />

      <RecommendedAction
        title={recommendation.title}
        description={recommendation.description}
        cta={recommendation.cta}
        tone={recommendation.tone}
      />

      <TriageBar
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
          <Field label="Description" value={report.description} />
          <Field
            label="User category"
            value={CATEGORY_LABELS[report.user_category] ?? report.user_category}
            tooltip="What the reporter said the issue was about, before LLM classification."
          />
          {report.user_intent && (
            <Field
              label="User intent"
              value={report.user_intent}
              tooltip="What the reporter said they were trying to do when the issue happened."
            />
          )}
          <ScreenshotBlock url={report.screenshot_url} />
        </Section>

        <Section title="LLM classification" icon={<IconSparkle />}>
          {report.stage1_classification ? (
            <ClassificationFields report={report} />
          ) : report.processing_error ? (
            <div className="rounded-sm border border-danger/30 bg-danger-muted/15 px-2 py-2 text-xs text-danger">
              <p className="font-medium mb-0.5">Classification failed</p>
              <p className="text-fg-secondary break-words">{report.processing_error}</p>
            </div>
          ) : (
            <div className="text-fg-muted text-xs italic">Pending classification — refresh in a few seconds.</div>
          )}
        </Section>

        <Section title="Environment" icon={<IconGlobe />}>
          <Field
            label="URL"
            value={report.environment?.url ?? 'Unknown'}
            mono
            copyable={Boolean(report.environment?.url)}
          />
          <Field label="Browser" value={report.environment?.userAgent ?? 'Unknown'} />
          <Field
            label="Viewport"
            value={
              report.environment?.viewport
                ? `${report.environment.viewport.width} × ${report.environment.viewport.height}`
                : 'Unknown'
            }
          />
          <Field label="Platform" value={report.environment?.platform ?? 'Unknown'} />
          {report.session_id ? (
            <IdField
              label="Session ID"
              value={report.session_id}
              tooltip="Unique identifier for the user's browser session at the time of the report."
            />
          ) : (
            <Field label="Session ID" value="Not captured" />
          )}
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
        <CommentsPanel reportId={report.id} projectId={report.project_id} />
      </div>

      <RelatedFooter report={report} dispatchState={dispatchState} />
    </div>
  )
}

/* ── DetailHeader ─────────────────────────────────────────────────────── */

function DetailHeader({ report, reporterShort }: { report: ReportDetail; reporterShort: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={STATUS[report.status] ?? 'text-fg-muted border border-edge'}>
            {statusLabel(report.status)}
          </Badge>
          {report.severity && (
            <Badge className={SEVERITY[report.severity] ?? ''}>{severityLabel(report.severity)}</Badge>
          )}
          {report.category && (
            <Badge className="bg-surface-overlay text-fg-secondary border border-edge-subtle">
              {CATEGORY_LABELS[report.category] ?? report.category}
            </Badge>
          )}
        </div>
        <h2 className="mt-1.5 text-lg font-semibold text-fg leading-snug">
          {report.summary ?? report.description?.slice(0, 120) ?? 'Untitled report'}
        </h2>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-fg-muted flex-wrap">
          <span className="text-fg-secondary">
            <RelativeTime value={report.created_at} />
          </span>
          <span aria-hidden="true" className="text-fg-faint">·</span>
          <Link
            to={`/projects?project=${encodeURIComponent(report.project_id)}`}
            className="hover:text-fg-secondary inline-flex items-center gap-1"
          >
            <span className="font-mono text-2xs">{report.project_id.slice(0, 8)}</span>
            <span className="text-fg-faint">project</span>
          </Link>
          <span aria-hidden="true" className="text-fg-faint">·</span>
          <Link
            to={`/reports?reporter=${encodeURIComponent(report.reporter_token_hash)}`}
            className="hover:text-fg-secondary inline-flex items-center gap-1"
          >
            <span className="font-mono text-2xs">Reporter {reporterShort}</span>
            <span className="text-fg-faint underline-offset-2 hover:underline">view all</span>
          </Link>
          <span aria-hidden="true" className="text-fg-faint">·</span>
          <span className="inline-flex items-center gap-1">
            <Tooltip content={report.id}>
              <span className="font-mono text-2xs cursor-help">{report.id.slice(0, 8)}…</span>
            </Tooltip>
            <CopyButton value={report.id} />
          </span>
        </div>
      </div>
      <PresenceBadges reportId={report.id} projectId={report.project_id} />
    </div>
  )
}

/* ── TriageBar ────────────────────────────────────────────────────────── */

interface TriageBarProps {
  report: ReportDetail
  onTriage: (updates: Record<string, string>) => Promise<void>
  saving: boolean
  savedAt: number | null
  dispatchState: DispatchState
  onDispatch: () => void | Promise<void>
  isDispatchBusy: boolean
}

function TriageBar({ report, onTriage, saving, savedAt, dispatchState, onDispatch, isDispatchBusy }: TriageBarProps) {
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    if (!savedAt) return
    setShowSaved(true)
    const t = setTimeout(() => setShowSaved(false), 2_000)
    return () => clearTimeout(t)
  }, [savedAt])

  const dispatchDisabled = report.status === 'fixed' || report.status === 'dismissed' || isDispatchBusy
  const dispatchLabel =
    dispatchState.status === 'idle' ? 'Dispatch fix' :
    dispatchState.status === 'queueing' ? 'Dispatching…' :
    dispatchState.status === 'queued' ? 'Queued…' :
    dispatchState.status === 'running' ? 'Agent running…' :
    dispatchState.status === 'completed' ? 'PR ready' :
    'Failed — retry'

  return (
    <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-edge-subtle bg-surface-raised/50 p-3">
      <SelectField
        label="Status"
        value={report.status}
        onChange={(e) => onTriage({ status: e.currentTarget.value })}
        disabled={saving}
        className="!w-auto"
      >
        {STATUS_OPTS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
      </SelectField>

      <SelectField
        label="Severity"
        value={report.severity ?? ''}
        onChange={(e) => onTriage({ severity: e.currentTarget.value })}
        disabled={saving}
        className="!w-auto"
      >
        <option value="">Unset</option>
        {SEV_OPTS.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s] ?? s}</option>)}
      </SelectField>

      <div className="flex items-center gap-1.5 text-2xs h-[26px]" aria-live="polite">
        {saving && <span className="text-brand">Saving…</span>}
        {!saving && showSaved && <span className="text-ok">✓ Saved</span>}
      </div>

      <div className="ml-auto flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={onDispatch}
          disabled={dispatchDisabled}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-fg-on-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors"
        >
          <IconArrowRight />
          {dispatchLabel}
        </button>
        {dispatchState.status === 'completed' && dispatchState.prUrl && (
          <a
            href={dispatchState.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-2xs text-accent hover:text-accent-hover inline-flex items-center gap-1"
          >
            View PR <IconExternalLink />
          </a>
        )}
        {dispatchState.status === 'failed' && dispatchState.error && (
          <span className="text-2xs text-danger max-w-xs text-right">{dispatchState.error}</span>
        )}
      </div>
    </div>
  )
}

/* ── ClassificationFields ─────────────────────────────────────────────── */

function ClassificationFields({ report }: { report: ReportDetail }) {
  const reproductionHint = (report.stage1_classification as { reproductionHint?: string } | null)?.reproductionHint
  return (
    <>
      <Field
        label="Category"
        value={CATEGORY_LABELS[report.category] ?? report.category}
        tooltip="Coarse-grained type assigned by the Stage-1 classifier."
      />
      <Field
        label="Severity"
        value={severityLabel(report.severity)}
        tooltip="Estimated user impact, used to drive routing and SLA."
      />
      <Field label="Summary" value={report.summary ?? '—'} />
      {report.component && (
        <Field
          label="Component"
          value={report.component}
          mono
          tooltip="The UI component or code area the LLM believes is responsible."
        />
      )}
      <Field
        label="Confidence"
        value={report.confidence != null ? `${(report.confidence * 100).toFixed(0)}%` : 'n/a'}
        tooltip="LLM self-reported confidence in the category and severity assignment. Below 70% usually warrants human review."
      />
      {reproductionHint && (
        <Field
          label="Reproduction hint"
          value={reproductionHint}
          tooltip="LLM-generated summary of the steps to reproduce. Treat as a starting point, not a verified repro."
        />
      )}
      <ModelFooter model={report.stage1_model} latency={report.stage1_latency_ms} />
    </>
  )
}

function ModelFooter({ model, latency }: { model: string | null; latency: number | null }) {
  if (!model && latency == null) return null
  return (
    <div className="mt-2 flex items-center gap-1.5 text-2xs text-fg-faint border-t border-edge-subtle pt-2">
      <Tooltip content="Stage-1 fast filter model used to classify this report.">
        <span className="font-mono cursor-help">{model ?? 'unknown'}</span>
      </Tooltip>
      {latency != null && (
        <>
          <span aria-hidden="true">·</span>
          <Tooltip content="End-to-end classification latency (Stage-1 only).">
            <span className="font-mono cursor-help">{latency} ms</span>
          </Tooltip>
        </>
      )}
    </div>
  )
}

/* ── ScreenshotBlock ──────────────────────────────────────────────────── */

function ScreenshotBlock({ url }: { url: string | null }) {
  return (
    <div className="mt-3">
      <span className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-1.5">
        <IconCamera /> Screenshot
        <InfoHint content="The screen the user captured at the moment they submitted this report." />
      </span>
      {url ? (
        <ImageZoom src={url} alt="Bug report screenshot" thumbClassName="max-h-72 inline-block" />
      ) : (
        <EmptySectionMessage text="No screenshot was captured for this report." />
      )}
    </div>
  )
}

/* ── PerformanceMetrics ──────────────────────────────────────────────── */

function PerformanceMetrics({ metrics }: { metrics: Record<string, number> | null }) {
  const entries = metrics ? Object.entries(metrics) : []
  if (entries.length === 0) {
    return <EmptySectionMessage text="No Web Vitals captured during this report." />
  }
  return (
    <div className="grid grid-cols-2 gap-x-4">
      {entries.map(([key, val]) => {
        const upper = key.toUpperCase()
        const tooltip = PERF_TOOLTIPS[upper]
        const display = typeof val === 'number'
          ? upper === 'CLS' ? val.toFixed(3) : `${val.toFixed(0)} ms`
          : String(val)
        return (
          <Field
            key={key}
            label={upper}
            value={display}
            mono
            tooltip={tooltip}
          />
        )
      })}
    </div>
  )
}

/* ── ConsoleLogs ──────────────────────────────────────────────────────── */

function ConsoleLogs({ logs }: { logs: ReportDetail['console_logs'] }) {
  if (!logs || logs.length === 0) {
    return <EmptySectionMessage text="No console output was captured during this report." />
  }
  return (
    <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
      {logs.map((log, i) => {
        const tone = log.level === 'error' ? 'text-danger' : log.level === 'warn' ? 'text-warn' : 'text-fg-muted'
        return (
          <div key={i} className={`text-2xs font-mono leading-relaxed ${tone}`}>
            <span className="opacity-70">[{log.level}]</span> {log.message}
          </div>
        )
      })}
    </div>
  )
}

/* ── NetworkLogs ──────────────────────────────────────────────────────── */

function NetworkLogs({ logs }: { logs: ReportDetail['network_logs'] }) {
  if (!logs || logs.length === 0) {
    return <EmptySectionMessage text="No network activity was captured during this report." />
  }
  return (
    <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
      {logs.map((req, i) => {
        const tone = req.status >= 500 ? 'text-danger'
          : req.status >= 400 ? 'text-warn'
          : 'text-fg-muted'
        return (
          <div key={i} className={`text-2xs font-mono leading-relaxed ${tone}`}>
            <span className="opacity-70">{req.method}</span> {req.url}
            {' → '}
            <span className="font-medium">{req.status}</span>
            <span className="opacity-70"> ({req.duration} ms)</span>
          </div>
        )
      })}
    </div>
  )
}

function EmptySectionMessage({ text }: { text: string }) {
  return <div className="text-xs text-fg-muted italic py-1">{text}</div>
}

/* ── RelatedFooter ────────────────────────────────────────────────────── */

function RelatedFooter({ report, dispatchState }: { report: ReportDetail; dispatchState: DispatchState }) {
  const links: Array<{ to: string; label: string; description: string; external?: boolean }> = []

  if (report.component) {
    links.push({
      to: `/reports?component=${encodeURIComponent(report.component)}`,
      label: 'Other reports for this component',
      description: `View all reports filed against ${report.component}.`,
    })
  }

  links.push({
    to: `/reports?reporter=${encodeURIComponent(report.reporter_token_hash)}`,
    label: 'This reporter\u2019s history',
    description: 'See every other report from the same reporter.',
  })

  links.push({
    to: '/graph',
    label: 'Open knowledge graph',
    description: 'Explore the dependency and regression graph for this project.',
  })

  if (report.status === 'fixing' || report.status === 'fixed' || dispatchState.status !== 'idle') {
    if (dispatchState.status === 'completed' && dispatchState.prUrl) {
      links.push({
        to: dispatchState.prUrl,
        label: 'View dispatched PR',
        description: 'Open the auto-generated pull request in your code host.',
        external: true,
      })
    } else {
      links.push({
        to: '/fixes',
        label: 'Auto-fix pipeline',
        description: 'Track the agentic fix attempts for this and other reports.',
      })
    }
  }

  return (
    <div className="mt-6">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-secondary mb-2">
        <IconLink /> Related
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {links.map((l) => (
          <RelatedLinkCard key={l.label} {...l} />
        ))}
      </div>
    </div>
  )
}

function RelatedLinkCard({ to, label, description, external }: { to: string; label: string; description: string; external?: boolean }) {
  const className = 'group block rounded-md border border-edge-subtle bg-surface-raised/40 px-3 py-2 hover:bg-surface-overlay hover:border-edge motion-safe:transition-colors'
  const inner = (
    <>
      <p className="text-xs font-medium text-fg-secondary group-hover:text-fg inline-flex items-center gap-1.5">
        {label}
        {external ? <IconExternalLink /> : <IconArrowRight />}
      </p>
      <p className="text-2xs text-fg-muted mt-0.5">{description}</p>
    </>
  )
  if (external) {
    return <a href={to} target="_blank" rel="noopener noreferrer" className={className}>{inner}</a>
  }
  return <Link to={to} className={className}>{inner}</Link>
}

/* ── deriveRecommendation ─────────────────────────────────────────────── */

interface Recommendation {
  title: string
  description: string
  cta?: { label: string; onClick?: () => void; href?: string; disabled?: boolean }
  tone: 'urgent' | 'info' | 'success' | 'neutral'
}

function deriveRecommendation(
  report: ReportDetail,
  dispatchState: DispatchState,
  commentCount: number,
  onDispatch: () => void | Promise<void>,
): Recommendation {
  if (dispatchState.status === 'completed' && dispatchState.prUrl) {
    return {
      title: 'Auto-fix PR is ready for review',
      description: 'The agent finished. Review the pull request and merge or request changes.',
      cta: { label: 'View PR', href: dispatchState.prUrl },
      tone: 'success',
    }
  }

  if (dispatchState.status === 'queueing' || dispatchState.status === 'queued' || dispatchState.status === 'running') {
    return {
      title: 'Agent is working on a fix',
      description: 'Stay on this page or follow progress in the Fixes pipeline.',
      cta: { label: 'Open Fixes', href: '/fixes' },
      tone: 'info',
    }
  }

  if (report.status === 'fixed') {
    return {
      title: 'Verify the fix and close out',
      description: 'Confirm the PR is merged and the report no longer reproduces.',
      tone: 'success',
    }
  }

  if (report.status === 'dismissed') {
    return {
      title: 'This report is dismissed',
      description: 'No further action is needed. Reopen by changing the status above if it resurfaces.',
      tone: 'neutral',
    }
  }

  if (report.status === 'fixing') {
    return {
      title: 'A fix is in progress',
      description: 'Track the active dispatch in the Fixes pipeline.',
      cta: { label: 'Open Fixes', href: '/fixes' },
      tone: 'info',
    }
  }

  if (!report.stage1_classification && !report.processing_error) {
    return {
      title: 'Classification pending',
      description: 'The LLM pipeline is still processing this report. Refresh in a few seconds.',
      tone: 'neutral',
    }
  }

  if (report.processing_error) {
    return {
      title: 'Classification failed — triage manually',
      description: 'Pick a status and severity by hand, or dispatch a fix once you understand the issue.',
      tone: 'urgent',
    }
  }

  if (report.status === 'new' && (report.severity === 'critical' || report.severity === 'high')) {
    return {
      title: `Confirm priority for this ${severityLabel(report.severity).toLowerCase()} bug`,
      description: 'Set the status to Classified, then dispatch a fix or hand off to engineering.',
      cta: { label: 'Dispatch fix', onClick: () => onDispatch() },
      tone: 'urgent',
    }
  }

  if (report.status === 'classified' && commentCount === 0) {
    return {
      title: 'Triage this report',
      description: 'Add a triage note for context, or dispatch an autofix attempt.',
      cta: { label: 'Dispatch fix', onClick: () => onDispatch() },
      tone: 'info',
    }
  }

  if (report.status === 'new') {
    return {
      title: 'Start triage',
      description: 'Set the severity and update status, or dispatch a fix if confidence is high.',
      cta: { label: 'Dispatch fix', onClick: () => onDispatch() },
      tone: 'info',
    }
  }

  return {
    title: 'No suggested action',
    description: 'Use the controls above to update status, severity, or dispatch a fix.',
    tone: 'neutral',
  }
}

/* ── PresenceBadges ───────────────────────────────────────────────────── */

function PresenceBadges({ reportId, projectId }: { reportId: string; projectId: string }) {
  const { others } = useReportPresence({ reportId, projectId })
  if (others.length === 0) return null
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-2xs text-fg-faint">Also viewing:</span>
      <div className="flex -space-x-1">
        {others.slice(0, 5).map((p) => (
          <div
            key={p.id}
            title={`${p.display_name ?? 'Unknown'} (${p.intent})`}
            className="w-6 h-6 rounded-full border border-edge bg-surface-raised text-2xs flex items-center justify-center font-medium overflow-hidden"
          >
            {p.avatar_url ? (
              <img src={p.avatar_url} alt={p.display_name ?? 'avatar'} className="w-full h-full object-cover" />
            ) : (
              (p.display_name ?? '?').slice(0, 2).toUpperCase()
            )}
          </div>
        ))}
        {others.length > 5 && (
          <div className="w-6 h-6 rounded-full border border-edge bg-surface-raised text-2xs flex items-center justify-center text-fg-muted">
            +{others.length - 5}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── CommentsPanel ────────────────────────────────────────────────────── */

function CommentsPanel({ reportId, projectId }: { reportId: string; projectId: string }) {
  const { comments, loading, postComment, deleteComment } = useReportComments({ reportId, projectId })
  const [body, setBody] = useState('')
  const [visibleToReporter, setVisibleToReporter] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    try {
      await postComment(body, { visibleToReporter })
      setBody('')
      setVisibleToReporter(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Section title={`Triage thread (${comments.length})`} icon={<IconChat />}>
      <div className="space-y-2 mb-3 max-h-72 overflow-y-auto">
        {loading && <div className="text-xs text-fg-muted">Loading…</div>}
        {!loading && comments.length === 0 && (
          <div className="text-xs text-fg-muted italic">No comments yet. Add the first triage note below.</div>
        )}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-2 items-start text-xs">
            <div className="w-6 h-6 rounded-full bg-surface-raised border border-edge text-2xs flex items-center justify-center flex-shrink-0">
              {(c.author_name ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-medium text-fg">{c.author_name ?? 'Unknown'}</span>
                <span className="text-2xs text-fg-muted">
                  <RelativeTime value={c.created_at} />
                </span>
                {c.visible_to_reporter && (
                  <Tooltip content="Reporter can see this comment in their notifications.">
                    <span className="text-2xs text-accent border border-accent/40 px-1 rounded cursor-help">visible to reporter</span>
                  </Tooltip>
                )}
              </div>
              <div className="text-fg-secondary whitespace-pre-wrap break-words">{c.body}</div>
            </div>
            <button
              type="button"
              onClick={() => deleteComment(c.id)}
              className="text-2xs text-fg-faint hover:text-danger px-1"
              aria-label="Delete comment"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={onSubmit} className="space-y-1.5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          placeholder="Add a triage note…"
          className="w-full text-xs p-2 rounded-md bg-surface-raised border border-edge resize-y min-h-16 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
          maxLength={10000}
        />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="text-xs flex items-center gap-1.5 text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={visibleToReporter}
              onChange={(e) => setVisibleToReporter(e.currentTarget.checked)}
            />
            Reply to reporter
            <InfoHint content="If checked, the reporter will receive a notification with this message in the SDK widget." />
          </label>
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="text-xs px-3 py-1 rounded-md bg-accent text-fg-on-accent disabled:opacity-50 hover:bg-accent-hover motion-safe:transition-colors"
          >
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </Section>
  )
}
