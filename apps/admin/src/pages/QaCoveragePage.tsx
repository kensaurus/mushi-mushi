/**
 * FILE: apps/admin/src/pages/QaCoveragePage.tsx
 * PURPOSE: QA Coverage Suite page — list of automated user-story tests,
 *          their pass/fail status, screenshot timeline, and Browserbase
 *          replay links. Allows creating new stories and triggering
 *          manual runs.
 *
 * OVERVIEW:
 * - Story card grid: pass rate bar, last-run status chip, provider badge,
 *   "Run now" action that is disabled while a run is pending/queued.
 * - Story drawer: auto-opens after "Run now" and auto-polls every 3 s
 *   while a run is pending or running so the user sees live progress.
 * - Create story modal: NL prompt + optional provider picker.
 * - Queued runs live in qa_story_runs (status = 'pending'). The
 *   qa-story-runner edge function picks them up immediately (manual
 *   trigger) or on its hourly cron.
 *
 * DEPENDENCIES:
 * - useActiveProjectId, apiFetch, usePageData, useToast
 * - qa_stories + qa_story_runs + qa_story_evidence tables (migration 20260514)
 * - qa_story_coverage_24h MV for summary stats
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { apiFetch } from '../lib/supabase'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  ErrorAlert,
  RelativeTime,
  Section,
  StatCard,
  Badge,
  FreshnessPill,
  SegmentedControl,
  RecommendedAction,
} from '../components/ui'
import { QaCoverageStatusBanner } from '../components/qa-coverage/QaCoverageStatusBanner'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import {
  EMPTY_QA_COVERAGE_STATS,
  type QaCoverageStats,
  type QaCoverageTabId,
} from '../components/qa-coverage/QaCoverageStatsTypes'
import { usePageCopy } from '../lib/copy'
import { useQaCoverageUx, resolveQuickQaCoverageTab } from '../lib/qaCoverageModeUx'
import {
  avgPassRateDetail,
  avgPassRateTooltip,
  failingStoriesDetail,
  failingStoriesTooltip,
  noDataStoriesDetail,
  noDataStoriesTooltip,
  passingStoriesDetail,
  passingStoriesTooltip,
  runs24hDetail,
  runs24hTooltip,
  totalStoriesDetail,
  totalStoriesTooltip,
} from '../lib/statTooltips/qa-coverage'
import { qaCoverageLinks } from '../lib/statCardLinks'
import { IconPlay, IconExternalLink, IconClock, IconChevronDown, IconChevronUp } from '../components/icons'
import { ConfirmDialog } from '../components/ConfirmDialog'

// ── Types ─────────────────────────────────────────────────────────────────

interface QaStoryCoverage {
  story_id: string
  project_id: string
  name: string
  enabled: boolean
  browser_provider: string
  runs_24h: number
  passed_24h: number
  failed_24h: number
  error_24h: number
  pass_rate_pct: number | null
  last_run_at: string | null
  last_failure_url: string | null
}

interface QaStoryFull {
  id: string
  project_id: string
  name: string
  prompt: string | null
  script: string | null
  script_lang: string
  browser_provider: string
  schedule_cron: string | null
  enabled: boolean
  byok_provider: string | null
  created_at: string
  updated_at: string
}

interface QaStoryRun {
  id: string
  story_id: string
  status: string
  latency_ms: number | null
  started_at: string
  finished_at: string | null
  provider: string | null
  provider_session_url: string | null
  summary: string | null
  assertion_failures: Array<{ step: string; expected: string | null; actual: string | null }>
  error_message: string | null
  triggered_by: string | null
  created_at: string
}

interface QaEvidence {
  id: string
  kind: 'screenshot' | 'console' | 'network' | 'video' | 'trace' | 'dom' | 'har'
  storage_path: string
  mime: string | null
  step_label: string | null
  captured_at: string
  signed_url: string | null
}

// ── Constants ──────────────────────────────────────────────────────────────

const PROVIDER_BADGE: Record<string, string> = {
  local:             'bg-surface-overlay text-fg-secondary border-edge-subtle',
  browserbase:       'bg-brand/15 text-brand border-brand/20',
  firecrawl_actions: 'bg-ok-muted text-ok border-ok/20',
}

const PROVIDER_LABEL: Record<string, string> = {
  local:             'Local',
  browserbase:       'Browserbase',
  firecrawl_actions: 'Firecrawl',
}

const STATUS_TONE: Record<string, string> = {
  passed:  'text-ok',
  failed:  'text-danger',
  error:   'text-danger',
  timeout: 'text-warn',
  skipped: 'text-fg-faint',
  running: 'text-brand',
  pending: 'text-fg-secondary',
}

const STATUS_BG: Record<string, string> = {
  passed:  'bg-ok/10 border-ok/20 text-ok',
  failed:  'bg-danger/10 border-danger/20 text-danger',
  error:   'bg-danger/10 border-danger/20 text-danger',
  timeout: 'bg-warn/10 border-warn/20 text-warn',
  running: 'bg-brand/10 border-brand/20 text-brand',
  pending: 'bg-surface-overlay border-edge-subtle text-fg-secondary',
}

const ACTIVE_STATUSES = new Set(['pending', 'running'])

const QA_COVERAGE_TABS: Array<{ id: QaCoverageTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture banner, workflow, and create-story CTA.',
  },
  {
    id: 'stories',
    label: 'Stories',
    description: 'All automated user-story tests with 24h pass-rate bars.',
  },
  {
    id: 'failing',
    label: 'Failing',
    description: 'Stories below 80% pass rate — open run history for evidence.',
  },
]

function resolveQaCoverageTab(value: string | null): QaCoverageTabId {
  if (value === 'stories' || value === 'failing') return value
  return 'overview'
}

// ── Story card ─────────────────────────────────────────────────────────────

function StoryCard({
  coverage,
  isQueued,
  onRunNow,
  onSelect,
  highlighted,
}: {
  coverage: QaStoryCoverage
  isQueued: boolean
  onRunNow: (id: string) => void
  onSelect: (id: string) => void
  highlighted: boolean
}) {
  const passRate = coverage.pass_rate_pct
  const barTone = passRate === null ? 'bg-fg-faint/40' : passRate >= 80 ? 'bg-ok' : passRate >= 50 ? 'bg-warn' : 'bg-danger'
  const disabled = isQueued || !coverage.enabled

  return (
    <Card
      className={`group relative flex flex-col gap-3 p-4 cursor-pointer transition-all hover:shadow-md ${highlighted ? 'ring-2 ring-brand' : ''}`}
      onClick={() => onSelect(coverage.story_id)}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-fg truncate leading-snug">{coverage.name}</span>
            {isQueued && (
              <SignalChip tone="brand" className="motion-safe:animate-pulse">
                queued
              </SignalChip>
            )}
            {!coverage.enabled && !isQueued && (
              <SignalChip tone="neutral">disabled</SignalChip>
            )}
          </div>
          <SignalChip tone="info">
            {PROVIDER_LABEL[coverage.browser_provider] ?? coverage.browser_provider}
          </SignalChip>
        </div>

        <Btn
          size="sm"
          variant="ghost"
          loading={isQueued}
          disabled={disabled}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRunNow(coverage.story_id) }}
          aria-label={isQueued ? 'Run queued…' : `Run ${coverage.name} now`}
          title={isQueued ? 'A run is already queued or in progress' : coverage.enabled ? 'Trigger manual run' : 'Story is disabled'}
        >
          {!isQueued && <IconPlay className="h-3 w-3" />}
        </Btn>
      </div>

      {/* Pass rate bar + stats */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-2xs">
          <SignalChip tone={coverage.runs_24h === 0 ? 'neutral' : 'info'}>
            {coverage.runs_24h === 0 ? 'No runs in 24h' : `${coverage.runs_24h} run${coverage.runs_24h === 1 ? '' : 's'} · 24h`}
          </SignalChip>
          {passRate !== null ? (
            <SignalChip tone={passRate >= 80 ? 'ok' : passRate >= 50 ? 'warn' : 'danger'}>
              {passRate}%
            </SignalChip>
          ) : (
            <SignalChip tone="neutral">—</SignalChip>
          )}
        </div>
        <div className="h-1 w-full rounded-full bg-surface-overlay overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barTone}`}
            style={{ width: passRate !== null ? `${Math.max(2, Math.min(100, passRate))}%` : '0%' }}
          />
        </div>
      </div>

      {/* Footer row: last run time + failure link */}
      <div className="flex items-center justify-between gap-2">
        {coverage.last_run_at ? (
          <InlineProof className="flex items-center gap-1">
            <IconClock className="h-2.5 w-2.5 shrink-0" />
            <RelativeTime value={coverage.last_run_at} />
          </InlineProof>
        ) : (
          <InlineProof className="italic">never run</InlineProof>
        )}

        {coverage.last_failure_url && (
          <a
            href={coverage.last_failure_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-0.5 text-2xs text-danger hover:underline"
          >
            <IconExternalLink className="h-2.5 w-2.5" />
            Replay
          </a>
        )}
      </div>
    </Card>
  )
}

// ── Evidence kind badge ────────────────────────────────────────────────────

const EVIDENCE_BADGE: Record<string, string> = {
  screenshot: 'bg-brand/10 text-brand border-brand/20',
  video:      'bg-brand/10 text-brand border-brand/20',
  console:    'bg-surface-overlay text-fg-secondary border-edge-subtle',
  network:    'bg-surface-overlay text-fg-secondary border-edge-subtle',
  har:        'bg-surface-overlay text-fg-secondary border-edge-subtle',
  trace:      'bg-surface-overlay text-fg-secondary border-edge-subtle',
  dom:        'bg-surface-overlay text-fg-secondary border-edge-subtle',
}

// ── Expanded run detail row ────────────────────────────────────────────────

function RunDetail({
  run,
  projectId,
  storyId,
}: {
  run: QaStoryRun
  projectId: string
  storyId: string
}) {
  const { data: evData, loading: evLoading } = usePageData<{ evidence: QaEvidence[] }>(
    `/v1/admin/projects/${projectId}/qa-stories/${storyId}/runs/${run.id}/evidence`,
    { deps: [run.id] },
  )
  const evidence = evData?.evidence ?? []

  const durationSecs =
    run.latency_ms != null
      ? (run.latency_ms / 1000).toFixed(1)
      : run.finished_at
      ? ((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)
      : null

  return (
    <div className="border-t border-edge-subtle mt-2 pt-3 space-y-3">
      {/* Meta row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-secondary">
        <span>
          <span className="text-fg-faint">Triggered by</span>{' '}
          <span className="font-medium">{run.triggered_by ?? 'cron'}</span>
        </span>
        {run.provider && (
          <span>
            <span className="text-fg-faint">Provider</span>{' '}
            <span className="font-medium">{PROVIDER_LABEL[run.provider] ?? run.provider}</span>
          </span>
        )}
        {durationSecs && (
          <span>
            <span className="text-fg-faint">Duration</span>{' '}
            <span className="font-medium tabular-nums">{durationSecs}s</span>
          </span>
        )}
        {run.finished_at && (
          <span>
            <span className="text-fg-faint">Finished</span>{' '}
            <RelativeTime value={run.finished_at} />
          </span>
        )}
      </div>

      {/* Summary */}
      {run.summary && (
        <p className="text-2xs text-fg-secondary leading-relaxed">{run.summary}</p>
      )}

      {/* Error message */}
      {run.error_message && (
        <div className="rounded-sm border border-danger/25 bg-danger/5 px-3 py-2">
          <div className="text-3xs font-semibold text-danger uppercase tracking-wider mb-1">Error</div>
          <pre className="text-2xs font-mono text-danger whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto">
            {run.error_message}
          </pre>
        </div>
      )}

      {/* Assertion failures */}
      {run.assertion_failures?.length > 0 && (
        <div>
          <div className="text-3xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">
            Assertion failures ({run.assertion_failures.length})
          </div>
          <div className="rounded-sm border border-edge-subtle overflow-hidden">
            <table className="w-full text-2xs">
              <thead>
                <tr className="bg-surface-raised border-b border-edge-subtle">
                  <th className="text-left px-2.5 py-1.5 font-medium text-fg-muted w-1/3">Step</th>
                  <th className="text-left px-2.5 py-1.5 font-medium text-fg-muted w-1/3">Expected</th>
                  <th className="text-left px-2.5 py-1.5 font-medium text-fg-muted w-1/3">Got</th>
                </tr>
              </thead>
              <tbody>
                {run.assertion_failures.map((f, i) => (
                  <tr key={i} className="border-t border-edge-subtle/50 align-top">
                    <td className="px-2.5 py-1.5 font-mono text-fg truncate max-w-0 w-1/3">
                      <span title={f.step}>{f.step}</span>
                    </td>
                    <td className="px-2.5 py-1.5 text-fg-secondary italic max-w-0 w-1/3">
                      <span title={f.expected ?? '(any)'}>{f.expected ?? <em className="text-fg-faint">any</em>}</span>
                    </td>
                    <td className="px-2.5 py-1.5 text-danger italic max-w-0 w-1/3">
                      <span title={f.actual ?? '(missing)'}>{f.actual ?? <em>missing</em>}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Evidence */}
      {evLoading && (
        <div className="text-2xs text-fg-faint italic">Loading evidence…</div>
      )}
      {!evLoading && evidence.length > 0 && (
        <div>
          <div className="text-3xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">
            Evidence ({evidence.length})
          </div>
          <div className="space-y-2">
            {evidence.map((ev) => (
              <div key={ev.id} className="rounded-sm border border-edge-subtle overflow-hidden">
                {/* Evidence header */}
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-raised border-b border-edge-subtle">
                  <span className={`text-3xs border px-1.5 py-0.5 rounded-sm font-medium ${EVIDENCE_BADGE[ev.kind] ?? 'bg-surface-overlay text-fg-secondary border-edge-subtle'}`}>
                    {ev.kind}
                  </span>
                  {ev.step_label && (
                    <span className="text-3xs font-mono text-fg-secondary truncate">{ev.step_label}</span>
                  )}
                  <span className="text-3xs text-fg-faint ml-auto tabular-nums">
                    <RelativeTime value={ev.captured_at} />
                  </span>
                </div>
                {/* Evidence body */}
                {(ev.kind === 'screenshot' || ev.kind === 'video') && ev.signed_url ? (
                  ev.kind === 'screenshot' ? (
                    <a href={ev.signed_url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={ev.signed_url}
                        alt={ev.step_label ?? 'Screenshot'}
                        className="w-full max-h-48 object-contain bg-surface-overlay"
                        loading="lazy"
                      />
                    </a>
                  ) : (
                    <video src={ev.signed_url} controls className="w-full max-h-48" />
                  )
                ) : ev.signed_url ? (
                  <div className="px-2.5 py-2">
                    <a
                      href={ev.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-2xs text-brand hover:underline"
                    >
                      <IconExternalLink className="h-3 w-3" />
                      Download {ev.kind}
                    </a>
                  </div>
                ) : (
                  <div className="px-2.5 py-2 text-2xs text-fg-faint italic">
                    {ev.storage_path}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {!evLoading && evidence.length === 0 && (
        <p className="text-2xs text-fg-faint italic">No evidence captured for this run.</p>
      )}

      {/* Session replay link */}
      {run.provider_session_url && (
        <a
          href={run.provider_session_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-2xs text-brand hover:underline font-medium"
        >
          <IconExternalLink className="h-3 w-3" />
          Open session replay in {PROVIDER_LABEL[run.provider ?? ''] ?? run.provider}
        </a>
      )}
    </div>
  )
}

// ── Story drawer ──────────────────────────────────────────────────────────

function StoryDrawer({
  storyId,
  projectId,
  onClose,
  onRunNow,
  isQueued,
  onDelete,
  onToggleEnabled,
}: {
  storyId: string
  projectId: string
  onClose: () => void
  onRunNow: (id: string) => void
  isQueued: boolean
  onDelete?: (id: string) => void
  onToggleEnabled?: (id: string, enabled: boolean) => void
}) {
  const { data: story } = usePageData<QaStoryFull>(
    `/v1/admin/projects/${projectId}/qa-stories/${storyId}`,
    { deps: [storyId] },
  )
  const { data: runs, reload: reloadRuns } = usePageData<{ runs: QaStoryRun[] }>(
    `/v1/admin/projects/${projectId}/qa-stories/${storyId}/runs?limit=20`,
    { deps: [storyId] },
  )

  const recentRuns = runs?.runs ?? []
  const hasActiveRun = isQueued || recentRuns.some((r) => ACTIVE_STATUSES.has(r.status))
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  // Auto-expand the most recent run when the drawer opens
  useEffect(() => {
    if (recentRuns.length > 0 && expandedRunId === null) {
      setExpandedRunId(recentRuns[0].id)
    }
  }, [recentRuns, expandedRunId])

  // Auto-poll every 3 s while a run is active
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (hasActiveRun) {
      pollRef.current = setInterval(() => void reloadRuns(), 3000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [hasActiveRun, reloadRuns])

  return (
    <div
      className="fixed inset-0 z-30 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Story details"
    >
      <div
        className="absolute inset-0 bg-overlay backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative ml-auto w-full max-w-xl h-full bg-surface-root border-l border-edge flex flex-col shadow-raised">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 px-5 py-4 border-b border-edge-subtle shrink-0">
          <div className="space-y-1.5 min-w-0">
            <h2 className="text-sm font-semibold text-fg leading-snug truncate">{story?.name ?? 'Story details'}</h2>
            {story && (
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-3xs border px-1.5 py-0.5 rounded-sm font-medium ${PROVIDER_BADGE[story.browser_provider] ?? 'bg-surface-overlay text-fg-secondary border-edge-subtle'}`}
                >
                  {PROVIDER_LABEL[story.browser_provider] ?? story.browser_provider}
                </span>
                {story.schedule_cron && (
                  <span className="inline-flex items-center gap-1 text-3xs font-mono text-fg-faint">
                    <IconClock className="h-2.5 w-2.5" />
                    {story.schedule_cron}
                  </span>
                )}
                {!story.enabled && (
                  <span className="text-3xs text-fg-faint bg-surface-overlay border border-edge-subtle px-1.5 py-0.5 rounded-sm">
                    disabled
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {story && (
              <Btn
                size="sm"
                variant="ghost"
                loading={isQueued}
                disabled={isQueued || !story.enabled}
                onClick={() => onRunNow(storyId)}
                title={isQueued ? 'Run already queued' : 'Trigger manual run'}
              >
                {!isQueued && <IconPlay className="h-3 w-3 mr-1" />}
                {isQueued ? 'Queued…' : 'Run now'}
              </Btn>
            )}
            {story && onToggleEnabled && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => onToggleEnabled(storyId, !story.enabled)}
                title={story.enabled ? 'Disable story' : 'Enable story'}
              >
                {story.enabled ? 'Disable' : 'Enable'}
              </Btn>
            )}
            {story && onDelete && (
              <Btn
                size="sm"
                variant="danger"
                onClick={() => onDelete(storyId)}
                title="Delete this story"
              >
                Delete
              </Btn>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay transition-colors"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {story?.prompt && (
            <div className="space-y-1">
              <span className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">Prompt</span>
              <p className="text-sm text-fg-secondary leading-relaxed">{story.prompt}</p>
            </div>
          )}

          {story?.script && (
            <details className="rounded-sm border border-edge-subtle">
              <summary className="px-3 py-2 text-2xs font-medium text-fg cursor-pointer select-none hover:bg-surface-raised transition-colors">
                Script ({story.script_lang})
              </summary>
              <pre className="px-3 pb-3 pt-1 text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap max-h-48">
                {story.script}
              </pre>
            </details>
          )}

          {/* Run history */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">
                Run history
              </span>
              {hasActiveRun && (
                <span className="inline-flex items-center gap-1 text-3xs text-brand">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse" />
                  live
                </span>
              )}
            </div>

            {isQueued && recentRuns.length === 0 && (
              <div className="rounded-sm border border-brand/20 bg-brand/5 px-3 py-2.5 text-2xs text-fg-secondary leading-relaxed">
                Run is <strong className="text-brand">queued</strong> in{' '}
                <code className="text-3xs font-mono bg-surface-overlay px-1 rounded">qa_story_runs</code>.
                The runner picks it up within seconds. Polling…
              </div>
            )}

            {recentRuns.length === 0 && !isQueued && (
              <p className="text-2xs text-fg-faint italic">No runs yet. Trigger a run above.</p>
            )}

            <div className="space-y-1.5">
              {recentRuns.map((run) => {
                const isActive = ACTIVE_STATUSES.has(run.status)
                const isExpanded = expandedRunId === run.id

                return (
                  <div
                    key={run.id}
                    className={`rounded-md border overflow-hidden transition-colors ${STATUS_BG[run.status] ?? 'bg-surface-raised border-edge-subtle'}`}
                  >
                    {/* Run summary row — click to expand */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-black/5 transition-colors"
                      onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                      aria-expanded={isExpanded}
                    >
                      {isActive && (
                        <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${run.status === 'running' ? 'bg-brand motion-safe:animate-pulse' : 'bg-fg-faint motion-safe:animate-pulse'}`} />
                      )}
                      <span className={`text-2xs font-semibold uppercase shrink-0 ${STATUS_TONE[run.status] ?? 'text-fg-muted'}`}>
                        {run.status}
                      </span>
                      {run.latency_ms && (
                        <span className="text-3xs text-fg-faint tabular-nums shrink-0">
                          {(run.latency_ms / 1000).toFixed(1)}s
                        </span>
                      )}
                      <span className="flex-1 min-w-0 text-2xs text-fg-secondary truncate">
                        {run.summary ?? (run.error_message ? run.error_message.slice(0, 60) : '')}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-3xs text-fg-faint tabular-nums">
                          <RelativeTime value={run.started_at} />
                        </span>
                        {isExpanded
                          ? <IconChevronUp className="h-3 w-3 text-fg-faint shrink-0" />
                          : <IconChevronDown className="h-3 w-3 text-fg-faint shrink-0" />
                        }
                      </div>
                    </button>

                    {/* Expanded run detail */}
                    {isExpanded && (
                      <div className="px-3 pb-3">
                        <RunDetail run={run} projectId={projectId} storyId={storyId} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

// ── Create story form ──────────────────────────────────────────────────────

function CreateStoryModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated: () => void
}) {
  const { success: toastSuccess, error: toastError } = useToast()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [provider, setProvider] = useState<'local' | 'browserbase' | 'firecrawl_actions'>('firecrawl_actions')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim()) { toastError('Name is required'); return }
    setSaving(true)
    const res = await apiFetch(`/v1/admin/projects/${projectId}/qa-stories`, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), prompt: prompt.trim() || null, browser_provider: provider }),
    })
    setSaving(false)
    if (res.ok) {
      toastSuccess('QA story created')
      onCreated()
      onClose()
    } else {
      toastError(res.error?.message ?? 'Failed to create story')
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-surface-root border border-edge rounded-md shadow-raised w-full max-w-md p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">New QA story</h2>
          <p className="text-2xs text-fg-muted mt-0.5">Runs on schedule and on demand. Results appear in the run history.</p>
        </div>

        <label className="block space-y-1">
          <span className="text-2xs font-medium text-fg-muted">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            placeholder="e.g. Pricing page shows all 4 tiers"
            autoFocus
            className="w-full px-2.5 py-1.5 bg-surface-raised border border-edge-subtle rounded-sm text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-2xs font-medium text-fg-muted">Prompt — describe what to verify</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="The pricing page should show 4 tiers, each with a CTA button and a price. The Pro tier should mention 'unlimited reports'."
            className="w-full px-2.5 py-1.5 bg-surface-raised border border-edge-subtle rounded-sm text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand resize-none"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-2xs font-medium text-fg-muted">Browser provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
            className="w-full px-2.5 py-1.5 bg-surface-raised border border-edge-subtle rounded-sm text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option value="firecrawl_actions">Firecrawl Actions — cloud, no setup needed</option>
            <option value="browserbase">Browserbase — BYOK, add key in Settings</option>
            <option value="local">Local Playwright — CLI runner only</option>
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create story'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export function QaCoveragePage() {
  const copy = usePageCopy('/qa-coverage')
  const ux = useQaCoverageUx()
  const projectId = useActiveProjectId()
  const setup = useSetupStatus(projectId)
  const projectName = setup.activeProject?.project_name ?? null
  const { success: toastSuccess, error: toastError } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = resolveQaCoverageTab(tabParam)
  const activeTabMeta = QA_COVERAGE_TABS.find((t) => t.id === activeTab) ?? QA_COVERAGE_TABS[0]
  const highlightId = searchParams.get('highlight') ?? ''
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<QaCoverageStats>(
    projectId ? `/v1/admin/projects/${projectId}/qa-coverage/stats` : null,
    { deps: [projectId] },
  )
  const stats = { ...EMPTY_QA_COVERAGE_STATS, ...statsData }

  const setActiveTab = useCallback(
    (tab: QaCoverageTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'overview') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || !projectId || statsLoading) return
    const quickTab = resolveQuickQaCoverageTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, projectId, statsLoading, stats, activeTab, setActiveTab])

  const { data, loading, error, reload, isValidating, lastFetchedAt } = usePageData<{ coverage: QaStoryCoverage[] }>(
    projectId ? `/v1/admin/projects/${projectId}/qa-coverage` : null,
    { deps: [projectId] },
  )

  const coverage = data?.coverage ?? []

  const reloadAll = useCallback(() => {
    reloadStats()
    reload()
  }, [reloadStats, reload])

  const tabOptions = useMemo(
    () =>
      QA_COVERAGE_TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'failing' && stats.failingStories > 0
            ? stats.failingStories
            : t.id === 'stories' && stats.pendingRuns > 0
              ? stats.pendingRuns
              : undefined,
      })),
    [copy?.tabLabels, stats.failingStories, stats.pendingRuns],
  )

  usePublishPageContext({
    route: '/qa-coverage',
    title: projectName ? `QA Coverage · ${projectName}` : 'QA Coverage',
    summary: statsLoading
      ? 'Loading QA coverage…'
      : stats.failingStories > 0
        ? `${stats.failingStories} failing · ${stats.totalStories} stories · ${stats.totalRuns24h} runs/24h`
        : stats.totalStories === 0
          ? 'No stories yet'
          : `${stats.passingStories}/${stats.totalStories} passing · ${stats.totalRuns24h} runs/24h`,
    criticalCount: stats.failingStories,
    questions: stats.totalStories > 0
      ? [
          stats.failingStories > 0
            ? 'Which failing story should I investigate first and why?'
            : 'Are any stories at risk of regressing soon?',
          'Show me the slowest QA runs from the last 24 hours.',
        ]
      : ['How do I write my first QA user-story test?'],
  })

  const handleRunNow = useCallback(async (storyId: string) => {
    if (!projectId || queuedIds.has(storyId)) return
    const res = await apiFetch(`/v1/admin/projects/${projectId}/qa-stories/${storyId}/run`, {
      method: 'POST',
    })
    if (res.ok) {
      toastSuccess('Run queued — opening run history')
      setQueuedIds((prev) => new Set(prev).add(storyId))
      setSelectedStoryId(storyId)
      setTimeout(() => {
        setQueuedIds((prev) => { const n = new Set(prev); n.delete(storyId); return n })
      }, 90_000)
      setTimeout(() => void reloadAll(), 5000)
    } else if (res.error?.message?.includes('disabled') || (res as { error?: { code?: string } }).error?.code === 'Story is disabled') {
      toastError('This story is disabled. Enable it before running.')
    } else {
      toastError(res.error?.message ?? 'Failed to queue run')
    }
  }, [projectId, queuedIds, reloadAll, toastSuccess, toastError])

  const handleClearQueued = useCallback((storyId: string) => {
    setQueuedIds((prev) => { const n = new Set(prev); n.delete(storyId); return n })
  }, [])

  const handleToggleEnabled = useCallback(async (storyId: string, enabled: boolean) => {
    if (!projectId) return
    const res = await apiFetch(`/v1/admin/projects/${projectId}/qa-stories/${storyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    })
    if (res.ok) {
      toastSuccess(enabled ? 'Story enabled' : 'Story disabled')
      reloadAll()
    } else {
      toastError(res.error?.message ?? 'Update failed')
    }
  }, [projectId, reloadAll, toastSuccess, toastError])

  const handleDeleteConfirm = useCallback(async () => {
    if (!projectId || !deleteTarget) return
    setDeletingId(deleteTarget)
    const res = await apiFetch(`/v1/admin/projects/${projectId}/qa-stories/${deleteTarget}`, {
      method: 'DELETE',
    })
    setDeletingId(null)
    setDeleteTarget(null)
    if (res.ok) {
      if (selectedStoryId === deleteTarget) setSelectedStoryId(null)
      toastSuccess('Story deleted')
      reloadAll()
    } else {
      toastError(res.error?.message ?? 'Delete failed')
    }
  }, [projectId, deleteTarget, selectedStoryId, reloadAll, toastSuccess, toastError])

  const failingCoverage = useMemo(
    () => coverage.filter((c) => c.runs_24h > 0 && (c.pass_rate_pct ?? 100) < 80),
    [coverage],
  )

  const renderStoryGrid = (rows: QaStoryCoverage[], emptyTitle: string, emptyDescription: string) => {
    if (loading) {
      return (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 rounded-md bg-surface-raised animate-pulse" />
          ))}
        </div>
      )
    }
    if (rows.length === 0) {
      return (
        <div className="space-y-3">
          <EmptySectionMessage text={emptyTitle} hint={emptyDescription} />
          {activeTab !== 'failing' && (
            <ActionPillRow className="justify-center">
              <ActionPill tone="brand" onClick={() => setShowCreate(true)}>
                + New story
              </ActionPill>
            </ActionPillRow>
          )}
        </div>
      )
    }
    return (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => (
          <StoryCard
            key={c.story_id}
            coverage={c}
            isQueued={queuedIds.has(c.story_id)}
            onRunNow={handleRunNow}
            onSelect={setSelectedStoryId}
            highlighted={c.story_id === highlightId}
          />
        ))}
      </div>
    )
  }

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading QA coverage">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised/40" />
          ))}
        </div>
      </div>
    )
  }

  if (statsError) {
    return <ErrorAlert message={`Failed to load QA stats: ${statsError}`} onRetry={reloadStats} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'failing'
        ? 'danger'
        : stats.topPriority === 'pending'
          ? 'brand'
          : stats.topPriority === 'no_runs' || stats.topPriority === 'disabled_all'
            ? 'warn'
            : stats.topPriority === 'no_stories'
              ? 'brand'
              : stats.topPriority === 'healthy'
                ? 'ok'
                : 'info'

  return (
    <div className="space-y-4" data-testid="mushi-page-qa-coverage">
      <PageHelp
        title={copy?.help?.title ?? 'About QA coverage'}
        whatIsIt={copy?.help?.whatIsIt ?? 'Automated tests written in plain English that run on your live app on a schedule — like a robot QA tester that never sleeps.'}
        useCases={copy?.help?.useCases ?? [
          'Write a test like "A user can log in and see their dashboard" and run it hourly',
          'Catch a broken flow before your users report it',
          'See a screenshot of exactly what the test saw when it failed',
        ]}
        howToUse={copy?.help?.howToUse ?? 'Click "+ New story" to write a test in plain English. Set a schedule. Click "Run now" to test immediately. Red = something broke.'}
      />

      <PageHeader
        title={copy?.title ?? 'QA Coverage'}
        projectScope={stats.projectName ?? projectName ?? undefined}
      >
        {!ux.hideOverviewChrome && (
          <>
            <Badge
              className={
                bannerSeverity === 'ok'
                  ? 'bg-ok-muted text-ok'
                  : bannerSeverity === 'danger'
                    ? 'bg-danger/10 text-danger'
                    : bannerSeverity === 'warn'
                      ? 'bg-warn/10 text-warn'
                      : bannerSeverity === 'brand'
                        ? 'bg-brand/15 text-brand'
                        : 'bg-surface-overlay text-fg-muted'
              }
            >
              {!stats.hasAnyProject
                ? 'NO PROJECT'
                : stats.failingStories > 0
                  ? `${stats.failingStories} FAIL`
                  : stats.pendingRuns > 0
                    ? `${stats.pendingRuns} QUEUED`
                    : stats.totalStories === 0
                      ? 'NO STORIES'
                      : stats.totalRuns24h === 0
                        ? 'IDLE'
                        : 'OK'}
            </Badge>
            <FreshnessPill
              at={statsFetchedAt ?? lastFetchedAt}
              isValidating={statsValidating || isValidating}
            />
            <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || isValidating}>
              Refresh
            </Btn>
            <Btn size="sm" onClick={() => setShowCreate(true)} disabled={!projectId}>
              + New story
            </Btn>
          </>
        )}
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            'Banner + QA SNAPSHOT — Overview for posture, Stories for all tests, Failing for sub-80% pass rate.'}
        </p>
      </ContainedBlock>

      <QaCoverageStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadAll}
        refreshing={statsValidating || isValidating}
        onCreateStory={() => setShowCreate(true)}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl<QaCoverageTabId>
        size="sm"
        ariaLabel="QA coverage sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!ux.hideQaSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'QA SNAPSHOT'} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeTabMeta.description}</p>
        </ContainedBlock>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label={copy?.statLabels?.stories ?? 'Stories'}
            value={stats.totalStories}
            accent={stats.totalStories > 0 ? 'text-brand' : undefined}
            tooltip={totalStoriesTooltip(stats)}
            detail={totalStoriesDetail(stats)}
            to={qaCoverageLinks.stories}
          />
          <StatCard
            label={copy?.statLabels?.passing ?? 'Passing'}
            value={stats.passingStories}
            accent="text-ok"
            tooltip={passingStoriesTooltip(stats)}
            detail={passingStoriesDetail()}
            to={qaCoverageLinks.passing}
          />
          <StatCard
            label={copy?.statLabels?.failing ?? 'Failing'}
            value={stats.failingStories}
            accent={stats.failingStories > 0 ? 'text-danger' : 'text-ok'}
            tooltip={failingStoriesTooltip(stats)}
            detail={failingStoriesDetail()}
            to={qaCoverageLinks.failing}
          />
          <StatCard
            label={copy?.statLabels?.avgPassRate ?? 'Avg pass rate'}
            value={stats.avgPassRatePct != null ? `${stats.avgPassRatePct}%` : '—'}
            accent={
              stats.avgPassRatePct != null && stats.avgPassRatePct >= 80
                ? 'text-ok'
                : stats.avgPassRatePct != null
                  ? 'text-warn'
                  : undefined
            }
            tooltip={avgPassRateTooltip(stats)}
            detail={avgPassRateDetail()}
            to={qaCoverageLinks.avgPassRate}
          />
          <StatCard
            label={copy?.statLabels?.runs24h ?? 'Runs (24h)'}
            value={stats.totalRuns24h}
            accent={stats.totalRuns24h > 0 ? 'text-brand' : undefined}
            tooltip={runs24hTooltip(stats)}
            detail={runs24hDetail(stats)}
            to={qaCoverageLinks.runs24h}
          />
          <StatCard
            label={copy?.statLabels?.noData ?? 'No data'}
            value={stats.noDataStories}
            accent={stats.noDataStories > 0 ? 'text-warn' : undefined}
            tooltip={noDataStoriesTooltip(stats)}
            detail={noDataStoriesDetail()}
            to={qaCoverageLinks.noData}
          />
        </div>
      </Section>
      )}

      {!ux.hideOverviewChrome && stats.topPriority !== 'healthy' && stats.topPriorityTo && activeTab === 'overview' ? (
        <Card
          className={`space-y-3 p-4 ${
            stats.topPriority === 'failing'
              ? 'border-danger/30 bg-danger/5'
              : stats.topPriority === 'no_stories'
                ? 'border-brand/30 bg-brand/5'
                : 'border-warn/30 bg-warn/5'
          }`}
        >
          <SignalChip
            tone={
              stats.topPriority === 'failing'
                ? 'danger'
                : stats.topPriority === 'no_stories'
                  ? 'brand'
                  : 'warn'
            }
          >
            Top priority
          </SignalChip>
          <ContainedBlock
            tone={
              stats.topPriority === 'failing' ? 'warn' : stats.topPriority === 'no_stories' ? 'info' : 'muted'
            }
          >
            <p className="text-xs font-medium leading-snug text-fg-primary">{stats.topPriorityLabel}</p>
          </ContainedBlock>
          <ActionPillRow>
            {stats.topPriority === 'no_stories' ? (
              <ActionPill tone="brand" onClick={() => setShowCreate(true)}>
                + New story
              </ActionPill>
            ) : (
              <ActionPill
                tone="brand"
                onClick={() => setActiveTab(stats.topPriority === 'failing' ? 'failing' : 'stories')}
              >
                Take action →
              </ActionPill>
            )}
          </ActionPillRow>
        </Card>
      ) : null}

      {error && <ErrorAlert message={error} onRetry={reloadAll} />}

      {activeTab === 'overview' && (
        <>
          {!ux.hideOverviewChrome && (
          <>
          {stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="All stories passing"
              description={`${stats.passingStories}/${stats.totalStories} stories at ≥80% pass rate · ${stats.totalRuns24h} runs in 24h.`}
            />
          )}
          {stats.topPriority === 'failing' && (
            <RecommendedAction
              tone="urgent"
              title={`${stats.failingStories} ${stats.failingStories === 1 ? 'story is' : 'stories are'} below 80% pass rate`}
              description={stats.topFailingStoryName
                ? `Worst: ${stats.topFailingStoryName} (${stats.topFailingPassRatePct}%). Open run history for screenshots and assertion diffs.`
                : 'Open the Failing tab to inspect run history and evidence.'}
            />
          )}
          {stats.topPriority === 'no_stories' && (
            <RecommendedAction
              tone="info"
              title="Create your first QA story"
              description="Start with Firecrawl Actions — cloud runs, no Browserbase key required. Hourly schedule by default."
              cta={{ label: '+ New story', to: '/qa-coverage' }}
            />
          )}
          {(stats.topPriority === 'no_runs' || stats.topPriority === 'pending') && (
            <RecommendedAction
              tone="info"
              title={stats.topPriority === 'pending' ? 'Runs in progress' : 'No runs in the last 24h'}
              description={stats.topPriorityLabel ?? 'Trigger a manual run from the Stories tab.'}
            />
          )}
          </>
          )}
        </>
      )}

      {activeTab === 'stories' && renderStoryGrid(
        coverage,
        'No QA stories yet',
        'Create your first automated user-story test. Start with a Firecrawl story — no setup needed.',
      )}

      {activeTab === 'failing' && renderStoryGrid(
        failingCoverage,
        'No failing stories in the last 24h',
        stats.totalStories === 0
          ? 'Create a story first, then failures will appear here when pass rate drops below 80%.'
          : 'All stories with runs in the last 24h are at or above 80% pass rate.',
      )}

      {selectedStoryId && projectId && (
        <StoryDrawer
          storyId={selectedStoryId}
          projectId={projectId}
          isQueued={queuedIds.has(selectedStoryId)}
          onRunNow={handleRunNow}
          onDelete={setDeleteTarget}
          onToggleEnabled={handleToggleEnabled}
          onClose={() => {
            handleClearQueued(selectedStoryId)
            setSelectedStoryId(null)
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete QA story?"
          body="This permanently removes the story, its schedule, and all run history. This cannot be undone."
          confirmLabel="Delete story"
          tone="danger"
          loading={deletingId === deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showCreate && projectId && (
        <CreateStoryModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={reloadAll}
        />
      )}
    </div>
  )
}
