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

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { apiFetch } from '../lib/supabase'
import {
  Card,
  Btn,
  ErrorAlert,
  EmptyState,
  RelativeTime,
} from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { Drawer } from '../components/Drawer'
import { Modal } from '../components/Modal'
import { IconPlay, IconHealth, IconExternalLink, IconClock, IconChevronDown, IconChevronUp } from '../components/icons'

// ── Types ─────────────────────────────────────────────────────────────────

interface QaStoryCoverage {
  story_id: string
  project_id: string
  name: string
  enabled: boolean
  browser_provider: string
  /** Live status from qa_stories.last_run_status — updates immediately after a run */
  last_run_status: string | null
  /** True when the story uses directFetch mode (content-only, no screenshots) */
  is_direct_fetch?: boolean
  runs_24h: number
  passed_24h: number
  failed_24h: number
  error_24h: number
  pass_rate_pct: number | null
  /** Most recent of MV last_run_at and live qa_stories.updated_at */
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
              <span className="inline-flex items-center gap-1 text-3xs border px-1.5 py-0.5 rounded-full font-medium bg-brand/10 border-brand/20 text-brand">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse" />
                queued
              </span>
            )}
            {!coverage.enabled && !isQueued && (
              <span className="text-3xs text-fg-faint bg-surface-overlay border border-edge-subtle px-1.5 py-0.5 rounded-full">
                disabled
              </span>
            )}
          </div>
          <span
            className={`inline-block text-3xs border px-1.5 py-0.5 rounded-sm font-medium ${PROVIDER_BADGE[coverage.browser_provider] ?? 'bg-surface-overlay text-fg-secondary border-edge-subtle'}`}
          >
            {PROVIDER_LABEL[coverage.browser_provider] ?? coverage.browser_provider}
          </span>
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
          <span className="text-fg-muted tabular-nums">
            {coverage.runs_24h === 0 ? 'No runs in 24h' : `${coverage.runs_24h} run${coverage.runs_24h === 1 ? '' : 's'} · 24h`}
          </span>
          <div className="flex items-center gap-1.5">
            {/* Live status badge from qa_stories — immediate, not MV-lagged */}
            {coverage.last_run_status && (
              <span className={`text-3xs border px-1.5 py-0.5 rounded-sm font-medium ${STATUS_BG[coverage.last_run_status] ?? 'bg-surface-overlay border-edge-subtle text-fg-secondary'}`}>
                {coverage.last_run_status}
              </span>
            )}
            {passRate !== null ? (
              <span className={`font-medium tabular-nums ${passRate >= 80 ? 'text-ok' : passRate >= 50 ? 'text-warn' : 'text-danger'}`}>
                {passRate}%
              </span>
            ) : (
              <span className="text-fg-faint">—</span>
            )}
          </div>
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
          <div className="flex items-center gap-1 text-2xs text-fg-faint">
            <IconClock className="h-2.5 w-2.5 shrink-0" />
            <RelativeTime value={coverage.last_run_at} />
          </div>
        ) : (
          <span className="text-2xs text-fg-faint italic">never run</span>
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
  isDirectFetch,
}: {
  run: QaStoryRun
  projectId: string
  storyId: string
  /** True when the story uses directFetch mode — shows a "content-only mode" note instead of "No evidence captured" */
  isDirectFetch?: boolean
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
        isDirectFetch ? (
          <div className="flex items-start gap-1.5 rounded-sm border border-edge-subtle/50 bg-surface-raised/60 px-2.5 py-2">
            <span className="text-3xs font-medium text-fg-muted mt-px">Content-only mode</span>
            <span className="text-2xs text-fg-faint leading-relaxed">
              Assertions verified against raw HTML — no screenshots or session replay captured.
            </span>
          </div>
        ) : (
          <p className="text-2xs text-fg-faint italic">No evidence captured for this run.</p>
        )
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
  initialRunId,
}: {
  storyId: string
  projectId: string
  onClose: () => void
  onRunNow: (id: string) => void
  isQueued: boolean
  initialRunId?: string
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
  // initialRunId from ?run= URL param preselects a specific run (e.g. from Slack deep links)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(initialRunId ?? null)

  // Detect directFetch mode from the story script so RunDetail can show
  // "content-only mode" instead of "No evidence captured for this run."
  const isDirectFetch = (() => {
    const script = story?.script ?? null
    if (!script || script.startsWith('http')) return false
    try {
      const parsed = JSON.parse(script) as Record<string, unknown>
      return parsed.directFetch === true
    } catch { return false }
  })()

  // Auto-expand: prefer initialRunId, then fall back to most recent run
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

  const drawerTitle = (
    <div className="space-y-1 min-w-0">
      <div className="text-sm font-semibold text-fg leading-snug truncate">{story?.name ?? 'Story details'}</div>
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
  )

  const drawerHeaderAction = story ? (
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
  ) : undefined

  return (
    <Drawer
      open
      onClose={onClose}
      title={drawerTitle}
      ariaLabel="Story details"
      headerAction={drawerHeaderAction}
      width="lg"
    >
      <div className="px-5 py-4 space-y-5">
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
                        <RunDetail run={run} projectId={projectId} storyId={storyId} isDirectFetch={isDirectFetch} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
        </div>
      </div>
    </Drawer>
  )
}

// ── Create story form ──────────────────────────────────────────────────────

const SCHEDULE_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight UTC', value: '0 0 * * *' },
  { label: 'Daily at 9 AM UTC', value: '0 9 * * *' },
  { label: 'Weekly (Mon 9 AM UTC)', value: '0 9 * * 1' },
  { label: 'Custom cron…', value: 'custom' },
]

const PROVIDER_EXPLAINERS: Record<string, string> = {
  firecrawl_actions: 'Runs in Firecrawl cloud — no browser setup needed. Add a Firecrawl API key under Settings → API Keys.',
  browserbase: 'Runs in a Browserbase cloud Chromium instance — add a Browserbase API key under Settings → API Keys.',
  local: 'Runs on your machine via the Mushi CLI (`mushi qa run`). Not schedulable from the cloud — use for local dev only.',
}

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
  const [targetUrl, setTargetUrl] = useState('')
  const [provider, setProvider] = useState<'local' | 'browserbase' | 'firecrawl_actions'>('firecrawl_actions')
  const [schedulePreset, setSchedulePreset] = useState(SCHEDULE_PRESETS[0].value)
  const [customCron, setCustomCron] = useState('')
  const [saving, setSaving] = useState(false)

  const scheduleCron = schedulePreset === 'custom' ? customCron : schedulePreset

  async function handleCreate() {
    if (!name.trim()) { toastError('Name is required'); return }
    if (!targetUrl.trim() && provider !== 'local') {
      toastError('Target URL is required so the runner knows which page to test.')
      return
    }
    setSaving(true)
    const res = await apiFetch(`/v1/admin/projects/${projectId}/qa-stories`, {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        prompt: prompt.trim() || null,
        target_url: targetUrl.trim() || null,
        browser_provider: provider,
        schedule_cron: scheduleCron || '0 * * * *',
      }),
    })
    setSaving(false)
    if (res.ok) {
      toastSuccess('QA story created')
      onCreated()
      onClose()
    } else {
      toastError((res as { error?: { message?: string } }).error?.message ?? 'Failed to create story')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New QA story"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Btn variant="cancel" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create story'}
          </Btn>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <p className="text-2xs text-fg-muted">Runs on schedule and on demand. Failures send a Slack notification (if configured) and appear in run history.</p>

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

        {/* Target URL — required for cloud providers */}
        <label className="block space-y-1">
          <span className="text-2xs font-medium text-fg-muted">
            Target URL
            {provider !== 'local' && <span className="ml-1 text-danger">*</span>}
          </span>
          <input
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://yourapp.com/pricing"
            className="w-full px-2.5 py-1.5 bg-surface-raised border border-edge-subtle rounded-sm text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand font-mono"
          />
          <p className="text-2xs text-fg-faint">The URL the runner will navigate to before verifying your prompt.</p>
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
            <option value="firecrawl_actions">Firecrawl Actions (recommended)</option>
            <option value="browserbase">Browserbase</option>
            <option value="local">Local Playwright (CLI only)</option>
          </select>
          {PROVIDER_EXPLAINERS[provider] && (
            <p className="text-2xs text-fg-faint">{PROVIDER_EXPLAINERS[provider]}</p>
          )}
        </label>

        <label className="block space-y-1">
          <span className="text-2xs font-medium text-fg-muted">Run schedule</span>
          <select
            value={schedulePreset}
            onChange={(e) => setSchedulePreset(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-surface-raised border border-edge-subtle rounded-sm text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand"
          >
            {SCHEDULE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          {schedulePreset === 'custom' && (
            <input
              type="text"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="*/30 * * * * (every 30 minutes)"
              className="w-full mt-1 px-2.5 py-1.5 bg-surface-raised border border-edge-subtle rounded-sm text-sm text-fg font-mono placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand"
            />
          )}
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="cancel" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create story'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

// ── Pending-review story type ──────────────────────────────────────────────

interface PendingReviewStory {
  id: string
  name: string
  source: string
  origin_story_node_id: string | null
  automation_mode: string
  approval_status: string
  generated_pr_url: string | null
  created_at: string
}

export function QaCoveragePage() {
  const projectId = useActiveProjectId()
  const { success: toastSuccess, error: toastError } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight') ?? searchParams.get('story') ?? ''
  // ?story= opens the drawer directly (e.g. from Slack "View run" links).
  // ?run= can preselect a specific run inside the drawer (handled in StoryDrawer).
  const initialStoryId = searchParams.get('story') ?? null
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(initialStoryId)
  const [showCreate, setShowCreate] = useState(false)
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set())
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set())
  const [optimisticHiddenIds, setOptimisticHiddenIds] = useState<Set<string>>(new Set())

  const { data, loading, error, reload } = usePageData<{ coverage: QaStoryCoverage[] }>(
    `/v1/admin/projects/${projectId}/qa-coverage`,
    { deps: [projectId] },
  )

  const { data: pendingData, reload: reloadPending } = usePageData<{ stories: PendingReviewStory[] }>(
    `/v1/admin/inventory/${projectId}/stories/pending-review`,
    { deps: [projectId] },
  )
  const pendingReview = (pendingData?.stories ?? []).filter((s) => !optimisticHiddenIds.has(s.id))

  const coverage = data?.coverage ?? []

  const handleRunNow = useCallback(async (storyId: string) => {
    if (queuedIds.has(storyId)) return // prevent double-click
    const res = await apiFetch(`/v1/admin/projects/${projectId}/qa-stories/${storyId}/run`, {
      method: 'POST',
    })
    if (res.ok) {
      toastSuccess('Run queued — opening run history')
      setQueuedIds((prev) => new Set(prev).add(storyId))
      setSelectedStoryId(storyId) // auto-open drawer
      // Safety: always unblock the button after 90 s in case polling misses the completion
      setTimeout(() => {
        setQueuedIds((prev) => { const n = new Set(prev); n.delete(storyId); return n })
      }, 90_000)
      setTimeout(() => void reload(), 5000)
    } else if (res.error?.message?.includes('disabled') || (res as { error?: { code?: string } }).error?.code === 'Story is disabled') {
      toastError('This story is disabled. Enable it before running.')
    } else {
      toastError(res.error?.message ?? 'Failed to queue run')
    }
  }, [projectId, queuedIds, reload, toastSuccess, toastError])

  const handleClearQueued = useCallback((storyId: string) => {
    setQueuedIds((prev) => { const n = new Set(prev); n.delete(storyId); return n })
  }, [])

  const handleApproval = useCallback(async (storyId: string, status: 'approved' | 'rejected') => {
    setApprovingIds((prev) => new Set(prev).add(storyId))
    // Optimistic: hide the row immediately so the list updates without waiting for the API
    setOptimisticHiddenIds((prev) => new Set(prev).add(storyId))
    const res = await apiFetch(`/v1/admin/inventory/${projectId}/stories/${storyId}/approval`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    setApprovingIds((prev) => { const n = new Set(prev); n.delete(storyId); return n })
    if (res.ok) {
      toastSuccess(status === 'approved' ? 'Test approved and enabled' : 'Test rejected')
      reloadPending()
      reload()
    } else {
      // Rollback: restore the row if the API call failed
      setOptimisticHiddenIds((prev) => { const n = new Set(prev); n.delete(storyId); return n })
      toastError(res.error?.message ?? 'Failed to update approval')
    }
  }, [projectId, reload, reloadPending, toastSuccess, toastError])

  const passing = coverage.filter((c) => (c.pass_rate_pct ?? 0) >= 80).length
  const failing = coverage.filter((c) => c.pass_rate_pct !== null && c.pass_rate_pct < 80).length
  const noData = coverage.filter((c) => c.runs_24h === 0).length

  return (
    <div className="space-y-5">
      <PageHeaderBar
        title="QA Coverage"
        projectScope={null}
        description="Automated user-story tests running on schedule via Playwright, Browserbase, or Firecrawl."
        helpTitle="About QA Coverage"
        helpWhatIsIt="Automated user-story tests that run on a schedule via Playwright (local), Browserbase (cloud), or Firecrawl. Each story is a natural-language prompt or a full Playwright script. Results appear in the run history with screenshots and console logs."
        helpUseCases={[
          'Catch regressions in critical user flows before a release',
          'Run a test on demand after a deploy to verify the fix landed',
          'Use Browserbase for CI-like confidence without managing infrastructure',
        ]}
        helpHowToUse="Click + New story to add a test. Click a story card to open the run history drawer. Click Run now to trigger an immediate run."
      >
        <Btn size="sm" onClick={() => setShowCreate(true)}>
          + New story
        </Btn>
      </PageHeaderBar>

      {error && <ErrorAlert message={error} onRetry={reload} />}

      {/* Summary stats */}
      {!loading && coverage.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <Card className="p-3 text-center">
            <div className="text-2xl font-mono font-semibold text-fg">{coverage.length}</div>
            <div className="text-2xs text-fg-muted mt-0.5">Total</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-2xl font-mono font-semibold text-ok">{passing}</div>
            <div className="text-2xs text-fg-muted mt-0.5">Passing</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-2xl font-mono font-semibold text-danger">{failing}</div>
            <div className="text-2xs text-fg-muted mt-0.5">Failing</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-2xl font-mono font-semibold text-fg-faint">{noData}</div>
            <div className="text-2xs text-fg-muted mt-0.5">No data</div>
          </Card>
        </div>
      )}

      {/* Pending TDD review queue — always shown so users discover the feature */}
      <Card className={`p-4 space-y-3 ring-1 ${pendingReview.length > 0 ? 'ring-warn/25 bg-warn/[0.03]' : 'ring-edge-subtle bg-surface-raised/40'}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">🧪 TDD Tests Pending Review</span>
          {pendingReview.length > 0 && (
            <span className="text-2xs bg-warn/15 text-warn px-1.5 py-0.5 rounded-full">{pendingReview.length}</span>
          )}
        </div>
        <p className="text-2xs text-fg-muted">
          Tests generated from your user stories appear here. Approve to add them to your QA schedule, or reject to discard.
        </p>
        {pendingReview.length === 0 ? (
          <p className="text-2xs text-fg-faint italic py-1">
            No tests awaiting review — generate tests from User Stories → Discovery tab, or wait for the PDCA auto-improver to propose new ones.
          </p>
        ) : (
          <div className="space-y-2">
            {pendingReview.map((story) => (
              <div key={story.id} className="flex items-center gap-3 p-2.5 rounded-md bg-surface-overlay border border-edge-subtle text-2xs">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-fg truncate">{story.name}</p>
                  {story.origin_story_node_id && (
                    <p className="text-fg-muted">story: <code>{story.origin_story_node_id}</code></p>
                  )}
                </div>
                {story.generated_pr_url && (
                  <a href={story.generated_pr_url} target="_blank" rel="noreferrer" className="text-brand hover:underline flex items-center gap-1">
                    <IconExternalLink className="h-3 w-3" />
                    PR
                  </a>
                )}
                <Btn
                  size="sm"
                  variant="ghost"
                  loading={approvingIds.has(story.id)}
                  onClick={() => void handleApproval(story.id, 'approved')}
                >
                  ✓ Approve
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  loading={approvingIds.has(story.id)}
                  onClick={() => void handleApproval(story.id, 'rejected')}
                >
                  ✕ Reject
                </Btn>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Story grid */}
      {loading && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 rounded-md bg-surface-raised animate-pulse" />
          ))}
        </div>
      )}

      {!loading && !error && coverage.length === 0 && (
        <EmptyState
          icon={<IconHealth className="h-8 w-8 text-fg-faint" />}
          title="No QA stories yet"
          description="Create your first automated user-story test. Start with a Firecrawl story — no setup needed."
          action={
            <Btn size="sm" onClick={() => setShowCreate(true)}>
              + New story
            </Btn>
          }
        />
      )}

      {!loading && coverage.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {coverage.map((c) => (
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
      )}

      {/* Story drawer */}
      {selectedStoryId && projectId && (
        <StoryDrawer
          storyId={selectedStoryId}
          projectId={projectId}
          isQueued={queuedIds.has(selectedStoryId)}
          onRunNow={handleRunNow}
          initialRunId={searchParams.get('run') ?? undefined}
          onClose={() => {
            handleClearQueued(selectedStoryId)
            setSelectedStoryId(null)
            // Clean up URL params so back-button / sharing don't re-open drawer
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev)
              next.delete('story')
              next.delete('run')
              return next
            }, { replace: true })
          }}
        />
      )}

      {/* Create modal */}
      {showCreate && projectId && (
        <CreateStoryModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={reload}
        />
      )}
    </div>
  )
}
