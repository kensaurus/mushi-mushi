/**
 * FILE: apps/admin/src/pages/UxRunsPage.tsx
 * PURPOSE: UX runs (Plan 021, ADR 0020). `mushi ux run --sync` runs a coding
 *          agent over every screen of the app on the developer's machine (or
 *          "Run in the cloud" on the repo's GitHub Actions) and mirrors the
 *          burndown here, live: which screens were improved, rolled back,
 *          moved by another fix, or could not load.
 *
 * Data: GET /v1/admin/projects/:pid/ux-runs, GET …/ux-runs/:runId
 * Live: Realtime on ux_runs + ux_surfaces for the active project.
 *
 * The first-time user test (fresh-eyes runs) was a tab here; it has its own
 * page now (/first-user-test), and ?tab=fresh-eyes redirects there.
 *
 * ?view=scorecard shows the UX scorecard (ADR 0066): every page scored on a
 * written rubric, worst first, and the root causes across pages.
 */

import { useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Badge, EmptyState, Loading, SegmentedControl, StatCard } from '../components/ui'
import { formatRelative } from '../components/ui/metrics'
import { PageLoadError } from '../components/PageLoadError'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { UxStartRunCard } from '../components/ux-runs/UxStartRunCard'
import { UxRunProgress } from '../components/ux-runs/UxRunProgress'
import { UxRunPullRequest } from '../components/ux-runs/UxRunPullRequest'
import { UxSurfaceDetail } from '../components/ux-runs/UxSurfaceDetail'
import { UxScorecardView } from '../components/ux-runs/UxScorecardView'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { sortSurfaces, UX_RUN_STATUS_LABEL, UX_STATUS_META, uxKeptEdits, type UxRunDetail, type UxRunListItem } from '../lib/uxRuns'

export function UxRunsPage() {
  const projectId = useActiveProjectId()
  const [params] = useSearchParams()
  // Old links (the Home light, bookmarks) to the tab the first-time user test used to be.
  if (params.get('tab') === 'fresh-eyes') return <Navigate to="/first-user-test" replace />
  if (!projectId) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeaderBar title="UX runs" />
        <EmptyState title="No project selected" description="Switch to a project at the top to see its UX runs." />
      </div>
    )
  }
  if (params.get('view') === 'scorecard') return <ProjectUxScorecard key={projectId} projectId={projectId} />
  return <ProjectUxRuns key={projectId} projectId={projectId} />
}

/** Runs | Scorecard: two views of the same page, kept in ?view= so a link opens either. */
function UxViewSwitch({ view }: { view: 'runs' | 'scorecard' }) {
  const [params, setParams] = useSearchParams()
  return (
    <SegmentedControl
      ariaLabel="UX runs view"
      size="sm"
      value={view}
      options={[
        { id: 'runs', label: 'Agent runs' },
        { id: 'scorecard', label: 'Scorecard' },
      ]}
      onChange={(v) => {
        const next = new URLSearchParams(params)
        next.delete('run')
        if (v === 'scorecard') next.set('view', 'scorecard')
        else next.delete('view')
        setParams(next, { replace: true })
      }}
    />
  )
}

function ProjectUxScorecard({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams()
  return (
    <div className={PAGE_CONTENT_STACK}>
      <PageHeaderBar
        title="UX scorecard"
        helpTitle="What is the UX scorecard?"
        helpWhatIsIt="Every page of your app, scored 1 to 10 on a written rubric: clarity, hierarchy, consistency, loading/empty/error states, truthfulness, copy, accessibility and speed. A page's score follows its worst problem. Problems that repeat across pages are grouped into one root cause, so one fix lifts many pages."
        helpHowToUse="Run mushi-ux scorecard --url <your app> --profile-dir <your signed-in browser profile> --sync on your computer. Read the root causes first; each says where to fix it. Add --file to file the top ones as bugs (one per cause, at most five a run). Run it again after a fix to see each page's trend."
        helpFlowPath="/ux-runs"
      />
      <UxViewSwitch view="scorecard" />
      <UxScorecardView
        projectId={projectId}
        runId={params.get('run')}
        onPickRun={(id) => {
          const next = new URLSearchParams(params)
          next.set('run', id)
          setParams(next, { replace: true })
        }}
      />
    </div>
  )
}

function ProjectUxRuns({ projectId }: { projectId: string }) {
  const listPath = `/v1/admin/projects/${projectId}/ux-runs`
  const list = usePageData<{ runs: UxRunListItem[] }>(listPath)
  const runs = list.data?.runs ?? []
  // ?run=<local run id> opens that run; the studio links here with it.
  const [params, setParams] = useSearchParams()
  const chosen = params.get('run')
  const setChosen = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('run', id)
    setParams(next, { replace: true })
  }
  const [showOlder, setShowOlder] = useState(false)
  const runId = chosen ?? runs[0]?.local_run_id ?? null
  const shownRuns = showOlder ? runs : runs.slice(0, RUN_LIST_LIMIT)
  const detail = usePageData<UxRunDetail>(runId ? `${listPath}/${runId}` : null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  useRealtimeReload(
    [
      { table: 'ux_runs', filter: `project_id=eq.${projectId}` },
      { table: 'ux_surfaces', filter: `project_id=eq.${projectId}` },
    ],
    () => {
      list.reload()
      detail.reload()
    },
  )

  const surfaces = useMemo(() => sortSurfaces(detail.data?.surfaces ?? []), [detail.data])
  const run = detail.data?.run
  const live = run?.status === 'running'
  const currentKey = live ? (run?.current_surface ?? null) : null
  // Follow the screen the agent is on until someone picks one.
  const selected = surfaces.find((s) => s.surface_key === selectedKey) ?? surfaces.find((s) => s.surface_key === currentKey) ?? surfaces[0] ?? null
  const counts = detail.data?.run.counts ?? {}
  const keptEdits = uxKeptEdits(detail.data?.iterations ?? [])

  return (
    <div className={PAGE_CONTENT_STACK}>
      <PageHeaderBar
        title="UX runs"
        helpTitle="What is a UX run?"
        helpWhatIsIt="Your coding agent (Claude Code, Cursor, Codex) works through every page, tab and dialog of your app on your machine, or on your repo's GitHub Actions with a Cursor Cloud agent, one screen at a time, in a separate git branch. An edit is kept only if accessibility, layout and console measurements did not get worse. Screens a kept change moved elsewhere are flagged."
        helpHowToUse="Start a run from the card at the top: the studio (mushi ux ui) runs on your own computer, or start a cloud run. This page mirrors the run and merges its PR; it cannot open the studio for you. Start with screens marked Moved by another fix or Rolled back. File anything you want fixed as a bug. Review the branch, open it as a draft PR from the studio, and merge it here once its required checks pass. Nothing merges until you confirm."
        helpFlowPath="/ux-runs"
      />
      <UxViewSwitch view="runs" />
      <p className="text-2xs text-fg-muted">
        Want to know if a new user gets through your app? That is the <Link className="text-brand underline underline-offset-2" to="/first-user-test">first-time user test</Link>.
      </p>

        <PagePosture
          slots={[
            {
              priority: POSTURE_PRIORITY.status,
              show: detail.data != null,
              children: (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard
                    label="Edits kept"
                    value={keptEdits}
                    detail={`on ${counts.accepted ?? 0} improved screen${(counts.accepted ?? 0) === 1 ? '' : 's'}`}
                  />
                  <StatCard label={UX_STATUS_META.regressed.label} value={counts.regressed ?? 0} detail="check these first" />
                  <StatCard label={UX_STATUS_META.reverted.label} value={counts.reverted ?? 0} detail="made something worse" />
                  <StatCard label={UX_STATUS_META.blocked.label} value={counts.blocked ?? 0} detail="the screen note says why" />
                </div>
              ),
            },
          ]}
        />

        {list.error && <PageLoadError error={list.error} resource="UX runs" endpoint={listPath} onRetry={list.reload} />}
        {list.loading && !list.data && <Loading text="Loading UX runs…" />}

        {list.data && <UxStartRunCard hasRuns={runs.length > 0} projectId={projectId} />}
        {list.data && runs.length === 0 && (
          <p className="text-2xs text-fg-muted">
            Exploring your app never sends a write request. Sign-in screens: run <code>mushi ux login --url http://localhost:5173</code> first.
          </p>
        )}

        {runs.length > 0 && (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <nav aria-label="Runs" className="flex shrink-0 flex-col gap-1 lg:w-64">
              {shownRuns.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setChosen(r.local_run_id)
                    setSelectedKey(null)
                  }}
                  aria-current={r.local_run_id === runId}
                  className={`rounded-md border px-3 py-2 text-left text-xs ${r.local_run_id === runId ? 'border-brand/40 bg-surface-raised' : 'border-edge-subtle hover:bg-surface-raised'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium text-fg">{formatRelative(r.started_at)}</span>
                    <Badge tone={r.status === 'running' ? 'infoSubtle' : r.status === 'done' ? 'okSubtle' : r.status === 'failed' ? 'dangerSubtle' : 'warnSubtle'}>
                      {UX_RUN_STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block text-2xs text-fg-secondary">{runSummary(r)}</span>
                </button>
              ))}
              {runs.length > RUN_LIST_LIMIT && (
                <button type="button" onClick={() => setShowOlder((v) => !v)} className="px-3 py-1 text-left text-2xs text-fg-muted underline">
                  {showOlder ? 'Show fewer' : `Show ${runs.length - RUN_LIST_LIMIT} older`}
                </button>
              )}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {detail.error && <PageLoadError error={detail.error} resource="this run" endpoint={`${listPath}/${runId}`} onRetry={detail.reload} />}
              {detail.data && <UxRunProgress run={detail.data.run} surfaces={detail.data.surfaces} />}
              {run?.pr_url && runId ? (
                <UxRunPullRequest
                  key={runId}
                  projectId={projectId}
                  runId={runId}
                  run={run}
                  onMerged={() => {
                    detail.reload()
                    list.reload()
                  }}
                />
              ) : (
                run?.branch && (
                  <p className="text-xs text-fg-secondary">
                    Kept changes are on <code className="font-mono">{run.branch}</code>. When you are happy with them, open a draft PR with the Open draft PR button in the studio (<code className="font-mono">mushi ux ui</code>).
                  </p>
                )
              )}
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
                <ul aria-label="Screens" className="flex shrink-0 flex-col gap-1 xl:w-80">
                  {surfaces.map((s) => {
                    const meta = UX_STATUS_META[s.status]
                    const active = s.surface_key === selected?.surface_key
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedKey(s.surface_key)}
                          aria-current={active}
                          className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs ${active ? 'border-brand/40 bg-surface-raised' : 'border-edge-subtle hover:bg-surface-raised'}`}
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 truncate font-medium text-fg">
                              {s.surface_key === currentKey && (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info motion-safe:animate-pulse" aria-label="Agent working here" />
                              )}
                              <span className="truncate">{s.label}</span>
                            </span>
                            <span className="block truncate font-mono text-2xs text-fg-muted">{s.path}</span>
                          </span>
                          <Badge tone={meta.tone} title={meta.hint} className="shrink-0">{meta.label}</Badge>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {selected && runId && (
                  <div className="min-w-0 flex-1">
                    <UxSurfaceDetail
                      key={selected.id}
                      projectId={projectId}
                      runId={runId}
                      surface={selected}
                      iterations={(detail.data?.iterations ?? []).filter((i) => i.surface_id === selected.id)}
                      workingAttempt={selected.surface_key === currentKey ? (run?.current_attempt ?? null) : null}
                      onFiled={detail.reload}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  )
}

const RUN_LIST_LIMIT = 8

/** "3 screens · 2 improved" from a run's per-status counts; a run that reached no screen says so. */
function runSummary(r: UxRunListItem): string {
  const screens = Object.values(r.counts ?? {}).reduce((n, c) => n + (c ?? 0), 0)
  const improved = r.counts?.accepted ?? 0
  if (screens === 0) return r.status === 'failed' ? 'Stopped before any screen' : r.status === 'running' ? 'Starting' : 'No screens to work on'
  return `${screens} screen${screens === 1 ? '' : 's'} · ${improved} improved`
}
