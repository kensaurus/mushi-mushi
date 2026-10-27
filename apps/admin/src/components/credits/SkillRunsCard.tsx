/**
 * FILE: apps/admin/src/components/credits/SkillRunsCard.tsx
 * PURPOSE: /credits, skill runs (ADR 0042): pick an app, a skill from the
 *          catalog and the part of the app to work on, and Mushi runs it
 *          round after round on that app's own Cursor key. The app picker
 *          starts on the open app (?project= or the stored app) and still
 *          lists every app, so a run is not filed on whichever app is first.
 *          Each round is a pull request that Opus reviews; with "merge each
 *          round when ready" an approved round goes to the merge queue, and
 *          the next round builds on it. "Run on" can pick one of your local
 *          worker lanes for the app instead of the cloud (ADR 0042
 *          amendment): its rounds then wait in that lane's queue. Below,
 *          every run of the team with where it is.
 */

import { Link, useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ACTIVE_PROJECT_QUERY_PARAM, getActiveProjectIdSnapshot, isValidProjectId } from '../../lib/activeProject'
import { Badge, Btn, Input, SelectField, Toggle } from '../ui'
import { useToast } from '../../lib/toast'
import { loadSkillRuns, skillRunLine, startSkillRun, stopSkillRun, type SkillRun, type SkillRunSkill } from '../../lib/skillRuns'
import { usePageData } from '../../lib/usePageData'
import { LANES_PATH, myLanesFor, type WorkLanesData } from '../../lib/workers'

const POLL_MS = 60_000
const STATUS_TONE = { active: 'info', done: 'ok', stopped: 'warn' } as const

interface Props {
  projects: Array<{ id: string; name: string }> | null
}

export function SkillRunsCard({ projects }: Props) {
  const toast = useToast()
  const [runs, setRuns] = useState<SkillRun[] | null>(null)
  const [skills, setSkills] = useState<SkillRunSkill[]>([])
  // Same read as useActiveProjectId: ?project= wins, then the stored app.
  // Inlined so this card does not import the header switcher.
  const [searchParams] = useSearchParams()
  const fromUrl = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
  const activeProjectId = isValidProjectId(fromUrl) ? fromUrl : getActiveProjectIdSnapshot()
  // A manual pick wins. Until then, follow the open app (the one the page
  // notice names) instead of the first row in the project list.
  const [chosenId, setChosenId] = useState<string | null>(null)
  const projectId =
    (chosenId && projects?.some((p) => p.id === chosenId) ? chosenId : null) ??
    (activeProjectId && projects?.some((p) => p.id === activeProjectId) ? activeProjectId : null) ??
    projects?.[0]?.id ??
    ''
  const [skillSlug, setSkillSlug] = useState('audit-accessibility')
  const [scope, setScope] = useState('')
  const [rounds, setRounds] = useState(3)
  const [autoMerge, setAutoMerge] = useState(true)
  const [busy, setBusy] = useState(false)
  // The same read as LocalWorkerModels on this page: one request for both.
  const lanesPage = usePageData<WorkLanesData>(LANES_PATH, { scope: 'enumeration' })
  const lanes = useMemo(() => myLanesFor(lanesPage.data, projectId, ['fix', 'skill']), [lanesPage.data, projectId])
  const laneNames = useMemo(() => new Map((lanesPage.data?.lanes ?? []).map((l) => [l.id, l.name])), [lanesPage.data])
  const [chosenLane, setChosenLane] = useState('')
  const laneId = lanes.some((l) => l.id === chosenLane) ? chosenLane : ''

  const load = useCallback(async () => {
    const res = await loadSkillRuns()
    if (res.ok && res.data) {
      // An API without skill runs answers another shape: show none rather than break the page.
      setRuns(Array.isArray(res.data.runs) ? res.data.runs : [])
      setSkills(Array.isArray(res.data.skills) ? res.data.skills : [])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const active = runs?.filter((r) => r.status === 'active').length ?? 0
  useEffect(() => {
    if (active === 0) return
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(t)
  }, [active, load])
  const names = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects])
  const skill = skills.find((s) => s.slug === skillSlug)

  async function start() {
    if (!projectId) return
    setBusy(true)
    const res = await startSkillRun(projectId, { skillSlug, scope, rounds, autoMerge, ...(laneId ? { laneId } : {}) })
    setBusy(false)
    if (!res.ok) {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Not started. Retry in a moment.' })
      return
    }
    const where = laneId ? `lane ${laneNames.get(laneId) ?? 'on your machine'} takes the first round from its queue` : 'the first round goes to Cursor within 10 minutes'
    toast.push({ tone: 'success', message: `${names.get(projectId) ?? 'App'}: ${skill?.label ?? skillSlug} started; ${where}.` })
    setScope('')
    void load()
  }

  async function stop(run: SkillRun) {
    const res = await stopSkillRun(run.project_id, run.id)
    if (!res.ok) toast.push({ tone: 'error', message: res.error?.message ?? 'Not stopped.' })
    void load()
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-secondary">
        Improve an app with one skill at a time, on the app&apos;s own Cursor key. Each round is a pull request: the agent measures first, changes only the part you name, and
        Opus reviews it. The next round builds on the last; the run ends when the agent finds nothing left.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField label="App" value={projectId} onChange={(e) => setChosenId(e.target.value)} disabled={!projects?.length}>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Skill" value={skillSlug} onChange={(e) => setSkillSlug(e.target.value)}>
          {(skills.length ? skills : [{ slug: 'audit-accessibility', label: 'Accessibility (WCAG 2.2 AA)', measure: '', inCatalog: true }]).map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.label}
              {s.inCatalog ? '' : ' (not synced yet)'}
            </option>
          ))}
        </SelectField>
        <div className="sm:col-span-2">
          <Input
            label="What to work on"
            placeholder="e.g. the /settings pages, the checkout flow, src/components/cards"
            value={scope}
            maxLength={500}
            onChange={(e) => setScope(e.target.value)}
          />
        </div>
        <SelectField label="Rounds at most" value={String(rounds)} onChange={(e) => setRounds(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end">
          <Toggle label="Merge each round when Opus approves and CI passes" checked={autoMerge} onChange={setAutoMerge} />
        </div>
        {lanes.length > 0 && (
          <SelectField label="Run on" value={laneId} onChange={(e) => setChosenLane(e.target.value)} data-testid="skill-run-on">
            <option value="">Cursor in the cloud (the app&apos;s key)</option>
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                My machine: lane {l.name}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      {skill?.measure && <p className="text-2xs text-fg-muted">Each round measures {skill.measure}, before and after, in its pull request.</p>}
      <Btn size="sm" type="button" loading={busy} disabled={!projectId || scope.trim().length < 3} onClick={() => void start()}>
        Start skill run
      </Btn>

      {runs && runs.length > 0 && (
        <ul className="divide-y divide-edge-subtle border-t border-edge-subtle">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 py-1.5">
              <Badge tone={STATUS_TONE[r.status]}>{r.status === 'active' ? 'Running' : r.status === 'done' ? 'Done' : 'Stopped'}</Badge>
              <span className="min-w-0 flex-1 text-2xs text-fg-secondary">
                <span className="font-medium">{names.get(r.project_id) ?? 'App'}</span> · {skills.find((s) => s.slug === r.skill_slug)?.label ?? r.skill_slug} · {r.scope}
                <span className="block text-fg-muted">
                  {skillRunLine(r)}
                  {r.lane_id ? ` · on lane ${laneNames.get(r.lane_id) ?? 'a local worker'}` : ''}
                  {r.current_report_id && (
                    <>
                      {' '}
                      ·{' '}
                      <Link className="text-brand underline underline-offset-2" to={`/reports/${r.current_report_id}`}>
                        current round
                      </Link>
                    </>
                  )}
                </span>
              </span>
              {r.status === 'active' && (
                <Btn size="sm" variant="ghost" type="button" onClick={() => void stop(r)}>
                  Stop
                </Btn>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
