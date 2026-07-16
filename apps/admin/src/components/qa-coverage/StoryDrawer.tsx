import { useEffect, useRef, useState } from 'react'
import { Btn, RelativeTime } from '../ui'
import { Drawer } from '../Drawer'
import { IconPlay, IconClock, IconChevronDown, IconChevronUp } from '../icons'
import { usePageData } from '../../lib/usePageData'
import { RunDetail } from './RunDetail'
import {
  ACTIVE_STATUSES,
  PROVIDER_BADGE,
  PROVIDER_LABEL,
  STATUS_BG,
  STATUS_TONE,
  type QaStoryFull,
  type QaStoryRun,
} from './qaStoryTypes'

export interface StoryDrawerProps {
  storyId: string
  projectId: string
  onClose: () => void
  onRunNow: (id: string) => void
  isQueued: boolean
  initialRunId?: string
}

export function StoryDrawer({
  storyId,
  projectId,
  onClose,
  onRunNow,
  isQueued,
  initialRunId,
}: StoryDrawerProps) {
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
  const [expandedRunId, setExpandedRunId] = useState<string | null>(initialRunId ?? null)

  const isDirectFetch = (() => {
    const script = story?.script ?? null
    if (!script || script.startsWith('http')) return false
    try {
      const parsed = JSON.parse(script) as Record<string, unknown>
      return parsed.directFetch === true
    } catch {
      return false
    }
  })()

  useEffect(() => {
    if (recentRuns.length > 0 && expandedRunId === null) {
      setExpandedRunId(recentRuns[0].id)
    }
  }, [recentRuns, expandedRunId])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (hasActiveRun) {
      pollRef.current = setInterval(() => void reloadRuns(), 3000)
    } else if (pollRef.current) {
      clearInterval(pollRef.current)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [hasActiveRun, reloadRuns])

  const drawerTitle = (
    <div className="space-y-1 min-w-0">
      <div className="text-sm font-semibold text-fg leading-snug truncate">
        {story?.name ?? 'Story details'}
      </div>
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
            <summary className="px-3 py-2 text-2xs font-medium text-fg cursor-pointer select-none hover:bg-surface-raised transition-opacity">
              Script ({story.script_lang})
            </summary>
            <pre className="px-3 pb-3 pt-1 text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap max-h-48">
              {story.script}
            </pre>
          </details>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">Run history</span>
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
                  className={`rounded-md border overflow-hidden transition-opacity ${STATUS_BG[run.status] ?? 'bg-surface-raised border-edge-subtle'}`}
                >
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-overlay transition-opacity"
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    aria-expanded={isExpanded}
                  >
                    {isActive && (
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${run.status === 'running' ? 'bg-brand motion-safe:animate-pulse' : 'bg-fg-faint motion-safe:animate-pulse'}`}
                      />
                    )}
                    <span
                      className={`text-2xs font-semibold uppercase shrink-0 ${STATUS_TONE[run.status] ?? 'text-fg-muted'}`}
                    >
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
                      {isExpanded ? (
                        <IconChevronUp className="h-3 w-3 text-fg-faint shrink-0" />
                      ) : (
                        <IconChevronDown className="h-3 w-3 text-fg-faint shrink-0" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3">
                      <RunDetail
                        run={run}
                        projectId={projectId}
                        storyId={storyId}
                        isDirectFetch={isDirectFetch}
                      />
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
