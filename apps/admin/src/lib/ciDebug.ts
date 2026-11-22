/**
 * FILE: apps/admin/src/lib/ciDebug.ts
 * PURPOSE: The logic behind "Why it failed" on /ci and the All apps grouping of the Now view
 *          (2026-11-19; the owner: "let users debug the pipeline thoroughly from the Mushi console"
 *          and "group the data of each project/app together").
 *
 *   - ciDebugErrorView: a refusal from the debug routes as one line plus the button that fixes it
 *     (the API's `fix` field does not survive the envelope, so the console maps codes itself).
 *   - debugPanelReducer: the panel's state (load, explain, re-run / cancel / CI repair).
 *   - buildCiAppGroups: alert cards, running and waiting jobs and "What broke" rows filed under
 *     their app, worst app first; causes and cards that span apps stay together on top.
 *
 * Pure: no React, no fetching.
 */

import type { CiAlert } from './ciAlerts'
import type { CiJobDebug, CiJobExplanation, CiJobLogStatus, CiOverview } from './ciTypes'
import type { CiStatus, FailureCause, FailureGroup, RunningNow, WaitingNow } from './ciStatus'
import type { RecentFailure } from './ciAttention'
import type { RunStatus } from '../components/signal/StatusMark'
import { groupByApp } from './groupByApp'

// ─────────────────────────────────────────────────────────────────────────────
// Refusals → one line and a fix
// ─────────────────────────────────────────────────────────────────────────────

export interface CiDebugFix {
  label: string
  to: string
}

interface CiDebugErrorView {
  text: string
  fix: CiDebugFix | null
}

export function githubAccessFix(projectId: string): CiDebugFix {
  return { label: 'Fix GitHub access', to: `/integrations/config?project=${encodeURIComponent(projectId)}#platform-card-github` }
}

/** A failed debug-route call as the one line a user acts on, and the button that fixes it. */
export function ciDebugErrorView(code: string | null | undefined, message: string | null | undefined, projectId: string): CiDebugErrorView {
  switch (code) {
    case 'GITHUB_ACTIONS_WRITE_MISSING':
      return {
        text: "Mushi Mushi's GitHub access can read CI but not re-run or cancel it. Add a fine-grained token with Actions: Read and write in the GitHub connection.",
        fix: githubAccessFix(projectId),
      }
    case 'NO_GITHUB_TOKEN':
    case 'REPO_NOT_CONNECTED':
      return { text: message?.trim() || 'Connect GitHub for this app first.', fix: githubAccessFix(projectId) }
    case 'NO_AI_KEY':
      return { text: 'Add an OpenAI key so Mushi Mushi can explain CI failures.', fix: { label: 'Add an OpenAI key', to: '/settings?tab=byok' } }
    case 'AI_KEYS_FAILED':
      return { text: 'Every OpenAI key was refused (quota or a revoked key).', fix: { label: 'Check AI keys', to: '/settings?tab=byok' } }
    case 'LLM_BUDGET_EXCEEDED':
      return { text: "This app's AI spend limit for the month is used up.", fix: { label: 'Raise the limit', to: '/settings#spend-limits' } }
    case 'WALLET_DENIED':
      return { text: "The Mushi Mushi AI balance can't cover this.", fix: { label: 'Top up', to: '/team?view=billing' } }
    case 'RATE_LIMITED':
      return { text: message?.trim() || 'Too many requests this hour. Try again later.', fix: null }
  }
  return { text: message?.trim() || 'That did not work. Try again in a minute.', fix: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

/** A step's conclusion as a status (✓ passed, ✕ failed, ○ skipped, ● running). */
export function stepStatus(conclusion: string | null | undefined): RunStatus {
  const c = (conclusion ?? '').toLowerCase()
  if (c === 'success') return 'passed'
  if (c === 'failure' || c === 'timed_out' || c === 'startup_failure') return 'failed'
  if (c === 'cancelled') return 'cancelled'
  if (c === 'in_progress') return 'running'
  if (c === 'queued' || c === 'pending' || c === 'waiting') return 'waiting'
  return 'idle'
}

export const EXPLANATION_KIND: Record<CiJobExplanation['kind'], { status: RunStatus; label: string }> = {
  code: { status: 'failed', label: 'Your code' },
  flaky: { status: 'slow', label: 'Flaky' },
  infra: { status: 'waiting', label: 'Test machine' },
  cancelled: { status: 'cancelled', label: 'Cancelled' },
}

/** Why there is no log excerpt, in one line; `github` = the GitHub-access fix applies. */
export function logStatusLine(status: CiJobLogStatus): { text: string; github: boolean } | null {
  switch (status) {
    case 'ok':
      return null
    case 'running':
      return { text: 'The log is ready when the job finishes.', github: false }
    case 'not_bound':
      return { text: 'This repository is no longer connected to the app.', github: true }
    case 'no_token':
      return { text: 'Connect GitHub for this app to read its logs.', github: true }
    case 'forbidden':
      return { text: "Mushi Mushi's GitHub access can't read this job's log (it needs Actions: Read).", github: true }
    case 'unavailable':
      return { text: 'GitHub has no log for this job any more (logs expire), or it could not be read just now.', github: false }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel state
// ─────────────────────────────────────────────────────────────────────────────

export type CiPanelAction = 'rerun' | 'cancel' | 'repair'

interface CiPanelActionState {
  state: 'idle' | 'confirm' | 'busy' | 'done' | 'error'
  message: string | null
  fix: CiDebugFix | null
}

export interface CiPanelState {
  jobId: string | null
  load: 'idle' | 'loading' | 'ready' | 'error'
  data: CiJobDebug | null
  loadError: CiDebugErrorView | null
  explain: { state: 'idle' | 'busy' | 'error'; error: CiDebugErrorView | null }
  actions: Record<CiPanelAction, CiPanelActionState>
}

const IDLE_ACTION: CiPanelActionState = { state: 'idle', message: null, fix: null }

export function initialPanelState(jobId: string | null = null): CiPanelState {
  return {
    jobId,
    load: jobId ? 'loading' : 'idle',
    data: null,
    loadError: null,
    explain: { state: 'idle', error: null },
    actions: { rerun: IDLE_ACTION, cancel: IDLE_ACTION, repair: IDLE_ACTION },
  }
}

export type CiPanelEvent =
  | { type: 'open'; jobId: string }
  | { type: 'close' }
  | { type: 'loaded'; jobId: string; data: CiJobDebug }
  | { type: 'loadFailed'; jobId: string; error: CiDebugErrorView }
  | { type: 'explainStart' }
  | { type: 'explained'; explanation: CiJobExplanation }
  | { type: 'explainFailed'; error: CiDebugErrorView }
  | { type: 'actionConfirm'; action: CiPanelAction }
  | { type: 'actionStart'; action: CiPanelAction }
  | { type: 'actionDone'; action: CiPanelAction; message: string }
  | { type: 'actionFailed'; action: CiPanelAction; error: CiDebugErrorView }

/**
 * One reducer for the whole panel. A late answer for a job the user already left (they opened
 * another one) is ignored, so a slow GitHub read never paints over the job now on screen.
 */
export function debugPanelReducer(state: CiPanelState, ev: CiPanelEvent): CiPanelState {
  switch (ev.type) {
    case 'open':
      return state.jobId === ev.jobId && state.load !== 'error' ? state : initialPanelState(ev.jobId)
    case 'close':
      return initialPanelState(null)
    case 'loaded':
      return ev.jobId === state.jobId ? { ...state, load: 'ready', data: ev.data, loadError: null } : state
    case 'loadFailed':
      return ev.jobId === state.jobId ? { ...state, load: 'error', loadError: ev.error } : state
    case 'explainStart':
      return { ...state, explain: { state: 'busy', error: null } }
    case 'explained':
      return { ...state, explain: { state: 'idle', error: null }, data: state.data ? { ...state.data, explanation: ev.explanation } : state.data }
    case 'explainFailed':
      return { ...state, explain: { state: 'error', error: ev.error } }
    case 'actionConfirm':
      return { ...state, actions: { ...state.actions, [ev.action]: { state: 'confirm', message: null, fix: null } } }
    case 'actionStart':
      return { ...state, actions: { ...state.actions, [ev.action]: { state: 'busy', message: null, fix: null } } }
    case 'actionDone':
      return { ...state, actions: { ...state.actions, [ev.action]: { state: 'done', message: ev.message, fix: null } } }
    case 'actionFailed':
      return { ...state, actions: { ...state.actions, [ev.action]: { state: 'error', message: ev.error.text, fix: ev.error.fix } } }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// All apps: group the Now view by app
// ─────────────────────────────────────────────────────────────────────────────

type FailureRow = { group: FailureGroup; failure: RecentFailure; step: string | null }

export interface CiAppGroup {
  id: string
  name: string
  alerts: CiAlert[]
  running: RunningNow[]
  waiting: WaitingNow[]
  causes: FailureCause[]
  singles: FailureRow[]
  counts: Partial<Record<RunStatus, number>>
  /** Passed ÷ finished-testing jobs over the window (repos of the app combined); null when none. */
  passRate: number | null
  /** The worst 1-in-20 wait of the app's repos. */
  waitP95S: number | null
  /** Nothing failed, nothing is slow, no card: shown collapsed. */
  healthy: boolean
}

interface CiAppGroups {
  /** Cards and causes that span apps or are about a machine: said once, above the apps. */
  shared: { alerts: CiAlert[]; causes: FailureCause[] }
  apps: CiAppGroup[]
}

type Item =
  | { kind: 'app'; projectId: string; name: string }
  | { kind: 'alert'; projectId: string; name: string; alert: CiAlert }
  | { kind: 'running'; projectId: string; name: string; r: RunningNow }
  | { kind: 'waiting'; projectId: string; name: string; w: WaitingNow }
  | { kind: 'cause'; projectId: string; name: string; c: FailureCause }
  | { kind: 'single'; projectId: string; name: string; s: FailureRow }

function rankOf(it: Item): number {
  switch (it.kind) {
    case 'alert':
      return it.alert.severity === 'critical' ? 0 : 2
    case 'cause':
      return 1
    case 'single':
      return it.s.failure.kind === 'code' ? 1 : 3
    case 'running':
      return it.r.slow ? 2 : 5
    case 'waiting':
      return 4
    case 'app':
      return 9
  }
}

/**
 * The Now view by app, worst first (lib/groupByApp: the app holding the most urgent row leads).
 * Every app with a repo in the window gets a group, so a healthy app is listed (collapsed) rather
 * than missing. A cause seen in two or more apps, and a card about several apps or a machine, stay
 * in `shared`: splitting them per app would repeat the same sentence per app (owner, 2026-11-18).
 */
export function buildCiAppGroups(input: {
  overview: Pick<CiOverview, 'repos' | 'jobs'>
  status: Pick<CiStatus, 'running' | 'waitingJobs'>
  alerts: readonly CiAlert[]
  causes: readonly FailureCause[]
  singles: readonly FailureRow[]
}): CiAppGroups {
  const { overview } = input
  const byRepo = new Map(overview.repos.map((r) => [r.repo, r] as const))
  const names = new Map<string, string>()
  for (const r of overview.repos) if (!names.has(r.projectId)) names.set(r.projectId, r.projectName)
  const projectOfRepo = (repo: string) => byRepo.get(repo)?.projectId ?? overview.jobs.find((j) => j.repo === repo)?.projectId ?? null
  const nameOf = (id: string, fallback: string) => names.get(id) ?? fallback

  const items: Item[] = []
  const shared: CiAppGroups['shared'] = { alerts: [], causes: [] }
  for (const [id, name] of names) items.push({ kind: 'app', projectId: id, name })
  for (const alert of input.alerts) {
    if (alert.projectId) items.push({ kind: 'alert', projectId: alert.projectId, name: nameOf(alert.projectId, alert.app ?? 'App'), alert })
    else shared.alerts.push(alert)
  }
  for (const r of input.status.running) items.push({ kind: 'running', projectId: r.job.projectId, name: nameOf(r.job.projectId, r.app), r })
  for (const w of input.status.waitingJobs) items.push({ kind: 'waiting', projectId: w.job.projectId, name: nameOf(w.job.projectId, w.app), w })
  for (const c of input.causes) {
    const ids = new Set(c.apps.map((a) => projectOfRepo(a.repo)).filter((x): x is string => !!x))
    if (ids.size === 1) {
      const id = [...ids][0]!
      items.push({ kind: 'cause', projectId: id, name: nameOf(id, c.apps[0]?.app ?? 'App'), c })
    } else shared.causes.push(c)
  }
  for (const s of input.singles) {
    const id = s.failure.job.projectId ?? projectOfRepo(s.group.repo)
    if (id) items.push({ kind: 'single', projectId: id, name: nameOf(id, s.group.app), s })
  }

  const groups = groupByApp(items, (it) => ({ id: it.projectId, name: it.name }), { rank: rankOf })
  const apps = groups.map((g): CiAppGroup => {
    const pick = <K extends Item['kind']>(kind: K) => g.items.filter((it): it is Extract<Item, { kind: K }> => it.kind === kind)
    const alerts = pick('alert').map((it) => it.alert)
    const running = pick('running').map((it) => it.r)
    const waiting = pick('waiting').map((it) => it.w)
    const causes = pick('cause').map((it) => it.c)
    const singles = pick('single').map((it) => it.s)
    const repos = overview.repos.filter((r) => r.projectId === g.id)
    const finished = repos.reduce((n, r) => n + (r.passRate != null ? r.jobs7d : 0), 0)
    const passRate = finished > 0 ? repos.reduce((n, r) => n + (r.passRate ?? 0) * (r.passRate != null ? r.jobs7d : 0), 0) / finished : null
    const waits = repos.map((r) => r.queueP95s).filter((x): x is number => x != null)
    const failed = singles.filter((s) => s.failure.kind === 'code').length + causes.reduce((n, c) => n + c.hits.length, 0)
    const stopped = singles.filter((s) => s.failure.kind !== 'code').length
    const slow = running.filter((r) => r.slow).length
    return {
      id: g.id,
      name: g.name,
      alerts,
      running,
      waiting,
      causes,
      singles,
      counts: { failed, cancelled: stopped, slow, running: running.length - slow, waiting: waiting.length },
      passRate,
      waitP95S: waits.length > 0 ? Math.max(...waits) : null,
      healthy: alerts.length === 0 && failed === 0 && stopped === 0 && slow === 0,
    }
  })
  return { shared, apps }
}

/** Distinct apps in the overview: grouping by app only helps with two or more. */
export function ciAppCount(overview: Pick<CiOverview, 'repos' | 'jobs'>): number {
  return new Set([...overview.repos.map((r) => r.projectId), ...overview.jobs.map((j) => j.projectId)]).size
}

/**
 * One job id per run, in order: re-running failed jobs works on a whole run, so a run with three
 * stopped jobs is re-run once, not three times.
 */
export function oneJobPerRun(jobs: ReadonlyArray<{ id: string; repo: string; runId: number }>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const j of jobs) {
    const key = `${j.repo}|${j.runId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(j.id)
  }
  return out
}
