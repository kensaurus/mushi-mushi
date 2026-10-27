/**
 * FILE: apps/admin/src/components/skills/SkillsRunningNow.tsx
 * PURPOSE: The top of Agent skills (console journeys 2026-10-27): "is a skill
 *          run going?" answered first. Every tab used to open on four tiles and
 *          a "copy the report UUID from the address bar" guide.
 *
 *          Lists this app's running work, newest first:
 *            - skill runs (ADR 0042, started from Spend credits): the round,
 *              and the bug that round is working on;
 *            - skill pipelines on a bug: the step it is on.
 *          With nothing running it shows the last run instead. The one action
 *          is "Run a skill on a bug", which opens the catalog on the bug-fix
 *          skill, where the bug is picked by title.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Card } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { relativeTime } from '../../lib/setupGuideSteps'
import { loadSkillRuns, skillRunLine, type SkillRun } from '../../lib/skillRuns'

interface PipelineRunLite {
  id: string
  report_id: string | null
  root_skill_slug: string
  chain_slugs?: string[] | null
  mode: 'handoff' | 'cloud'
  status: string
  created_at: string
  steps?: Array<{ step_index: number; status: string }>
  skill_pipeline_step_runs?: Array<{ step_index: number; status: string }>
}

/** One row of the "running now" list. */
export interface RunningItem {
  id: string
  kind: 'skill_run' | 'pipeline'
  skill: string
  running: boolean
  /** "Round 2 of 3" / "Step 2 of 4" / "Done: …" */
  where: string
  reportId: string | null
  at: string
  to: string
}

const PIPELINE_OPEN = new Set(['pending', 'running'])

function pipelineWhere(run: PipelineRunLite): string {
  const steps = run.steps ?? run.skill_pipeline_step_runs ?? []
  const total = steps.length || (run.chain_slugs?.length ?? 0) + 1
  if (!PIPELINE_OPEN.has(run.status)) {
    const label = run.status === 'completed' ? 'Done' : run.status === 'failed' ? 'Failed' : run.status === 'cancelled' ? 'Cancelled' : run.status
    return `${label} · ${total} ${total === 1 ? 'step' : 'steps'}`
  }
  const current = steps.filter((s) => s.status === 'passed' || s.status === 'skipped').length + 1
  return `Step ${Math.min(current, total)} of ${total}${run.mode === 'handoff' ? ' · waiting on your editor' : ''}`
}

/**
 * @internal Exported for tests. This app's skill runs and pipelines as one
 * list: running first, newest first; with nothing running, the one latest run.
 */
export function runningItems(input: { projectId: string; skillRuns: readonly SkillRun[]; pipelines: readonly PipelineRunLite[] }): RunningItem[] {
  const items: RunningItem[] = [
    ...input.skillRuns
      .filter((r) => r.project_id === input.projectId)
      .map((r) => ({
        id: r.id,
        kind: 'skill_run' as const,
        skill: r.skill_slug,
        running: r.status === 'active',
        where: skillRunLine(r),
        reportId: r.current_report_id,
        at: r.updated_at,
        to: '/credits',
      })),
    ...input.pipelines.map((p) => ({
      id: p.id,
      kind: 'pipeline' as const,
      skill: p.root_skill_slug,
      running: PIPELINE_OPEN.has(p.status),
      where: pipelineWhere(p),
      reportId: p.report_id,
      at: p.created_at,
      to: `/skills?tab=pipelines&run=${p.id}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const running = items.filter((i) => i.running)
  return running.length > 0 ? running : items.slice(0, 1)
}

interface Props {
  projectId: string
  onRunOnBug: () => void
}

export function SkillsRunningNow({ projectId, onRunOnBug }: Props) {
  const [skillRuns, setSkillRuns] = useState<SkillRun[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadSkillRuns().then((res) => {
      if (cancelled) return
      // An API without skill runs answers another shape: show none rather than break the page.
      setSkillRuns(res.ok && Array.isArray(res.data?.runs) ? res.data!.runs : [])
    })
    return () => {
      cancelled = true
    }
  }, [])
  const pipelines = usePageData<{ data: PipelineRunLite[] }>(`/v1/admin/skills/pipelines?project_id=${projectId}&limit=100`, {
    deps: [projectId],
  })

  const ready = skillRuns != null && (pipelines.data != null || pipelines.error != null)
  const items = ready ? runningItems({ projectId, skillRuns: skillRuns ?? [], pipelines: pipelines.data?.data ?? [] }) : []
  const anyRunning = items.some((i) => i.running)

  return (
    <Card className="p-0" data-testid="skills-running-now">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge-subtle px-3 py-2">
        <h2 className="text-sm font-semibold text-fg">{anyRunning ? 'Running now' : items.length > 0 ? 'Last run' : 'Skill runs'}</h2>
        <Btn size="sm" variant="primary" onClick={onRunOnBug}>
          Run a skill on a bug
        </Btn>
      </div>
      {!ready ? (
        <p className="px-3 py-3 text-xs text-fg-muted">Reading your runs…</p>
      ) : items.length === 0 ? (
        <p className="px-3 py-3 text-xs text-fg-muted">
          Nothing has run on this app yet. Pick a bug and a skill, or improve one part of the app round by round from{' '}
          <Link to="/credits" className="text-accent-foreground underline underline-offset-2 hover:text-accent">
            Spend credits
          </Link>
          .
        </p>
      ) : (
        <ul aria-label="Skill runs" className="divide-y divide-edge-subtle">
          {items.map((i) => (
            <li key={`${i.kind}:${i.id}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${i.running ? 'bg-info motion-safe:animate-pulse' : 'bg-fg-faint'}`} />
              <Link to={i.to} className="min-w-0 flex-1 basis-48 truncate font-mono text-xs text-fg hover:underline">
                {i.skill}
              </Link>
              <span className="shrink-0 text-2xs text-fg-secondary">{i.where}</span>
              {i.reportId ? (
                <Link to={`/reports/${i.reportId}`} className="shrink-0 text-2xs text-accent-foreground underline underline-offset-2 hover:text-accent">
                  Bug {i.reportId.slice(0, 8)}
                </Link>
              ) : (
                <span className="shrink-0 text-2xs text-fg-faint">No bug yet</span>
              )}
              <span className="shrink-0 text-2xs text-fg-faint">{relativeTime(i.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
