/**
 * FILE: apps/admin/src/components/credits/SkillRunsCard.tsx
 * PURPOSE: /credits, skill runs (ADR 0042): pick an app, a skill from the
 *          catalog and the part of the app to work on, and Mushi runs it
 *          round after round on that app's own Cursor key. Each round is a
 *          pull request that Opus reviews; with "merge each round when ready"
 *          an approved round goes to the merge queue, and the next round
 *          builds on it. Below, that app's runs and where each one is.
 *          While the header is "All apps", this page still shows one app
 *          (ProjectScopeNotice): the form and the list follow that app,
 *          not the first app in the team.
 */

import { Link, useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Btn, Input, SelectField, Toggle } from '../ui'
import { useToast } from '../../lib/toast'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  getActiveProjectIdSnapshot,
  isValidProjectId,
  useActiveProjectSignal,
} from '../../lib/activeProject'
import { useProjectScopeMode } from '../../lib/projectScope'
import { loadSkillRuns, skillRunLine, startSkillRun, stopSkillRun, type SkillRun, type SkillRunSkill } from '../../lib/skillRuns'

/** The app this page is showing: `?project=` wins, then the stored pin. */
function useOpenProjectId(): string | null {
  const [params] = useSearchParams()
  useActiveProjectSignal()
  const fromUrl = params.get(ACTIVE_PROJECT_QUERY_PARAM)
  if (isValidProjectId(fromUrl)) return fromUrl
  return getActiveProjectIdSnapshot()
}

const POLL_MS = 60_000
const STATUS_TONE = { active: 'info', done: 'ok', stopped: 'warn' } as const

interface Props {
  projects: Array<{ id: string; name: string }> | null
}

export function SkillRunsCard({ projects }: Props) {
  const toast = useToast()
  const openProjectId = useOpenProjectId()
  // The notice ("this page shows one app") is on only in All apps mode.
  // Pin then. A chosen app keeps the picker so a run can still target another app.
  const pinToOpenApp = useProjectScopeMode() === 'all'
  const listReady = projects != null
  const pinId = pinToOpenApp && openProjectId && projects?.some((p) => p.id === openProjectId) ? openProjectId : null
  const choices = pinId && projects ? projects.filter((p) => p.id === pinId) : projects
  const [runs, setRuns] = useState<SkillRun[] | null>(null)
  const [skills, setSkills] = useState<SkillRunSkill[]>([])
  const [projectId, setProjectId] = useState('')
  const [skillSlug, setSkillSlug] = useState('audit-accessibility')
  const [scope, setScope] = useState('')
  const [rounds, setRounds] = useState(3)
  const [autoMerge, setAutoMerge] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    // Don't paint every app's runs while the list that names the open app is still loading.
    if (pinToOpenApp && openProjectId && !listReady) return
    const res = await loadSkillRuns(pinId)
    if (res.ok && res.data) {
      // An API without skill runs answers another shape: show none rather than break the page.
      setRuns(Array.isArray(res.data.runs) ? res.data.runs : [])
      setSkills(Array.isArray(res.data.skills) ? res.data.skills : [])
    }
  }, [pinToOpenApp, openProjectId, listReady, pinId])
  useEffect(() => {
    void load()
  }, [load])
  const shownRuns = runs?.filter((r) => (pinId ? r.project_id === pinId : true)) ?? null
  const active = shownRuns?.filter((r) => r.status === 'active').length ?? 0
  useEffect(() => {
    if (active === 0) return
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(t)
  }, [active, load])
  useEffect(() => {
    if (pinId) {
      setProjectId(pinId)
      return
    }
    if (!projectId && projects?.length) {
      const preferred = openProjectId && projects.some((p) => p.id === openProjectId) ? openProjectId : projects[0].id
      setProjectId(preferred)
    }
  }, [pinId, openProjectId, projects, projectId])

  const names = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects])
  const skill = skills.find((s) => s.slug === skillSlug)

  async function start() {
    if (!projectId) return
    setBusy(true)
    const res = await startSkillRun(projectId, { skillSlug, scope, rounds, autoMerge })
    setBusy(false)
    if (!res.ok) {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Not started. Retry in a moment.' })
      return
    }
    toast.push({ tone: 'success', message: `${names.get(projectId) ?? 'App'}: ${skill?.label ?? skillSlug} started; the first round goes to Cursor within 10 minutes.` })
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
        <SelectField label="App" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!choices?.length || Boolean(pinId)}>
          {(choices ?? []).map((p) => (
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
      </div>
      {skill?.measure && <p className="text-2xs text-fg-muted">Each round measures {skill.measure}, before and after, in its pull request.</p>}
      <Btn size="sm" type="button" loading={busy} disabled={!projectId || scope.trim().length < 3} onClick={() => void start()}>
        Start skill run
      </Btn>

      {shownRuns && shownRuns.length > 0 && (
        <ul className="divide-y divide-edge-subtle border-t border-edge-subtle">
          {shownRuns.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 py-1.5">
              <Badge tone={STATUS_TONE[r.status]}>{r.status === 'active' ? 'Running' : r.status === 'done' ? 'Done' : 'Stopped'}</Badge>
              <span className="min-w-0 flex-1 text-2xs text-fg-secondary">
                <span className="font-medium">{names.get(r.project_id) ?? 'App'}</span> · {skills.find((s) => s.slug === r.skill_slug)?.label ?? r.skill_slug} · {r.scope}
                <span className="block text-fg-muted">
                  {skillRunLine(r)}
                  {r.current_report_id && (
                    <>
                      {' '}
                      ·{' '}
                      <Link className="text-brand hover:underline" to={`/reports/${r.current_report_id}`}>
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
