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
 */

import { useMemo, useState } from 'react'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Badge, Card, CodeValue, EmptyState, Loading, StatCard } from '../components/ui'
import { formatRelative } from '../components/ui/metrics'
import { PageLoadError } from '../components/PageLoadError'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { UxCloudRunCard } from '../components/ux-runs/UxCloudRunCard'
import { UxRunProgress } from '../components/ux-runs/UxRunProgress'
import { UxSurfaceDetail } from '../components/ux-runs/UxSurfaceDetail'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { sortSurfaces, UX_RUN_STATUS_LABEL, UX_STATUS_META, uxKeptEdits, type UxRunDetail, type UxRunListItem } from '../lib/uxRuns'

const RUN_COMMAND = 'mushi ux run --dev "pnpm dev --port {port}" --agent claude-code --sync'

export function UxRunsPage() {
  const projectId = useActiveProjectId()
  if (!projectId) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeaderBar title="UX runs" />
        <EmptyState title="No project selected" description="Switch to a project at the top to see its UX runs." />
      </div>
    )
  }
  return <ProjectUxRuns key={projectId} projectId={projectId} />
}

function ProjectUxRuns({ projectId }: { projectId: string }) {
  const listPath = `/v1/admin/projects/${projectId}/ux-runs`
  const list = usePageData<{ runs: UxRunListItem[] }>(listPath)
  const runs = list.data?.runs ?? []
  const [chosen, setChosen] = useState<string | null>(null)
  const runId = chosen ?? runs[0]?.local_run_id ?? null
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
        helpHowToUse="Run the command below in your repo, or start a cloud run. Start with screens marked Moved by another fix or Rolled back. File anything you want fixed as a bug. Review the branch and open it as a draft PR; nothing is merged for you."
        helpFlowPath="/ux-runs"
      />

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

      {list.data && runs.length === 0 && (
        <Card className="flex flex-col gap-2 p-4">
          <p className="text-sm font-medium text-fg">No UX runs yet</p>
          <p className="text-xs text-fg-secondary">
            Run this in your repo. It maps every screen, runs your agent on each one in its own branch, and shows the result here as it goes.
          </p>
          <CodeValue value={RUN_COMMAND} />
          <p className="text-2xs text-fg-muted">Exploring your app never sends a write request. Sign-in screens: run <code>mushi ux login --url http://localhost:5173</code> first.</p>
        </Card>
      )}

      {runs.length > 0 && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <nav aria-label="Runs" className="flex shrink-0 flex-col gap-1 lg:w-64">
            {runs.map((r) => (
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
                <span className="mt-0.5 block truncate font-mono text-2xs text-fg-muted">
                  {r.agent}{r.model ? ` · ${r.model}` : ''}{r.skill ? ` · ${r.skill}` : ''}
                </span>
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {detail.error && <PageLoadError error={detail.error} resource="this run" endpoint={`${listPath}/${runId}`} onRetry={detail.reload} />}
            {detail.data && <UxRunProgress run={detail.data.run} surfaces={detail.data.surfaces} />}
            {detail.data?.run.branch && (
              <p className="text-xs text-fg-secondary">
                Kept changes are on <code className="font-mono">{detail.data.run.branch}</code>. Review it and open a draft PR when you are happy.
              </p>
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

      {/* Starting a run comes after the results: on a phone the form would otherwise fill the first screen. */}
      <UxCloudRunCard projectId={projectId} />
    </div>
  )
}

/** "3 screens · 2 improved" from a run's per-status counts. */
function runSummary(r: UxRunListItem): string {
  const screens = Object.values(r.counts ?? {}).reduce((n, c) => n + (c ?? 0), 0)
  const improved = r.counts?.accepted ?? 0
  return `${screens} screen${screens === 1 ? '' : 's'} · ${improved} improved`
}
