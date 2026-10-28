/**
 * FILE: apps/admin/src/lib/freshEyes.ts
 * PURPOSE: Types and wording for the First-time user test page (fresh-eyes
 *          runs, ADR 0053 and its 2026-10-28 amendment): a first-time visitor
 *          tries one goal and the time it takes. Run now queues a test that
 *          a computer of the user's runs; the page says plainly when none can.
 */

export type FreshEyesStallReason = 'signup_wall' | 'captcha' | 'external' | 'dead_end' | 'blocked' | 'error' | 'model_gave_up' | 'model_unavailable' | 'out_of_steps'

export interface FreshEyesStep {
  n: number
  action: string
  path: string
  screen: string
  model_ms: number
  app_ms: number
  read_ms: number
  outcome: 'ok' | 'refused' | 'failed' | 'blocked' | 'left-app' | 'terminal'
  note: string | null
  opinion: { category: string; why: string } | null
  backtrack: boolean
  dead_end: boolean
  requirements: string[]
  signals: string[]
  shot: string | null
}

export interface FreshEyesSession {
  index: number
  outcome: 'reached' | 'stalled'
  stall: { step: number; screen: string; reason: FreshEyesStallReason; detail: string } | null
  ttfv_seconds: number | null
  app_seconds: number
  read_seconds: number
  model_seconds: number
  backtracks: number
  steps: FreshEyesStep[]
}

interface FreshEyesFindingSummary {
  fingerprint: string
  severity: 'high' | 'medium' | 'low'
  basis: 'measured' | 'opinion'
  summary: string
  sessions: number[]
}

export type FreshEyesRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped'

export interface FreshEyesRunListItem {
  local_run_id: string
  status: FreshEyesRunStatus
  model: string | null
  goal: string | null
  start_url: string | null
  ttfv_seconds: number | null
  steps: number | null
  reached: number | null
  stalled_at: { screen: string; reason: FreshEyesStallReason; sessions: number } | null
  findings: FreshEyesFindingSummary[] | null
  dry_run: boolean | null
  has_account: boolean | null
  counts: { sessions?: number } | null
  started_at: string
  finished_at: string | null
  /** Why a queued or worker-run test failed or stopped, in plain words. */
  detail?: string | null
  sessions_requested?: number | null
}

/** Whether a computer of the user's can take a test now (server: freshEyesRunner). */
export interface FreshEyesRunner {
  state: 'ready' | 'busy' | 'paused' | 'outdated' | 'offline' | 'none'
  hostname: string | null
  lastSeenAt: string | null
}

export interface FreshEyesListData {
  runs: FreshEyesRunListItem[]
  trend: FreshEyesTrendPoint[]
  defaults?: { url: string | null; urlSource: string | null; goal: string; sessions: number }
  /** Only Mushi's own operators, on Mushi's own project, from the console. */
  canUseTestAccount?: boolean
  /** null: Mushi could not read the computers just now. */
  runner?: FreshEyesRunner | null
}

export interface FreshEyesTrendPoint {
  metric_name: 'fresh_eyes.ttfv_seconds' | 'fresh_eyes.steps'
  dimension: string
  value: number
  ts: string
}

export interface FreshEyesRunDetail {
  run: FreshEyesRunListItem & { timeline: FreshEyesSession[] | null }
  shots: Record<string, string>
  reports: Array<{ id: string; title: string; status: string; severity: string | null; created_at: string }>
}

export const STALL_LABEL: Record<FreshEyesStallReason, string> = {
  signup_wall: 'Needs an account to go on',
  captcha: 'Stopped by a captcha',
  external: 'Needs something outside the app',
  dead_end: 'Dead end: no way forward',
  blocked: 'A refused request',
  error: 'An error stopped it',
  model_gave_up: 'Did not know what to do next',
  model_unavailable: 'The model did not answer (not your app)',
  out_of_steps: 'Ran out of steps',
}

/** "6 min 12 s", "45 s", "1 h 3 min". */
export function formatSeconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return 'not reached'
  const total = Math.round(s)
  if (total < 60) return `${total} s`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  if (h) return `${h} h ${m} min`
  return sec ? `${m} min ${sec} s` : `${m} min`
}

/** The run in one line: how many sessions got there, how long, how many steps. */
export function runHeadline(r: Pick<FreshEyesRunListItem, 'reached' | 'counts' | 'ttfv_seconds' | 'steps' | 'stalled_at' | 'status' | 'detail'>): string {
  const sessions = r.counts?.sessions ?? 0
  if (r.status === 'queued') return 'Waiting for your computer'
  if (r.status === 'running') return 'Running on your computer'
  if (r.status === 'stopped') return r.detail ?? 'Stopped'
  if (r.status === 'failed' && !r.counts?.sessions) return r.detail ?? 'Failed before it started'
  if ((r.reached ?? 0) > 0) return `${r.reached} of ${sessions} reached the goal · ${formatSeconds(r.ttfv_seconds)} · ${r.steps ?? 0} steps`
  if (r.stalled_at) return `Stalled at ${r.stalled_at.screen}: ${STALL_LABEL[r.stalled_at.reason].toLowerCase()}`
  return `None of ${sessions} reached the goal`
}

/** Time-to-first-value points, oldest first, for the trend line. */
export function ttfvTrend(points: readonly FreshEyesTrendPoint[]): number[] {
  return points.filter((p) => p.metric_name === 'fresh_eyes.ttfv_seconds').map((p) => p.value)
}

export const RUN_STATUS_META: Record<FreshEyesRunStatus, { label: string; tone: 'infoSubtle' | 'okSubtle' | 'dangerSubtle' | 'warnSubtle' | 'neutral' }> = {
  queued: { label: 'Waiting', tone: 'warnSubtle' },
  running: { label: 'Running', tone: 'infoSubtle' },
  done: { label: 'Done', tone: 'okSubtle' },
  failed: { label: 'Failed', tone: 'dangerSubtle' },
  stopped: { label: 'Stopped', tone: 'neutral' },
}

/**
 * What the Run now card says about the user's computers: a plain sentence,
 * whether Run now can work, and the one thing to do when it cannot.
 */
export function runnerMessage(r: FreshEyesRunner | null | undefined, now: number = Date.now()): { tone: 'ok' | 'info' | 'warn'; text: string; canRun: boolean; setup: 'install' | 'workers' | 'update' | null } {
  const host = r?.hostname ? r.hostname : 'your computer'
  if (r == null) return { tone: 'info', text: 'Mushi could not check your computers just now. You can still press Run now.', canRun: true, setup: null }
  switch (r.state) {
    case 'ready':
      return { tone: 'ok', text: `${host} runs it. It takes about 10 to 30 minutes, and this page updates by itself.`, canRun: true, setup: null }
    case 'busy':
      return { tone: 'info', text: `${host} is busy with another job. The test starts when that job ends.`, canRun: true, setup: null }
    case 'paused':
      return { tone: 'warn', text: `Every lane for this app on ${host} is paused or only fixes review findings. Turn one back on to run the test.`, canRun: false, setup: 'workers' }
    case 'outdated':
      return { tone: 'warn', text: `The Mushi on ${host} is too old to run this test. Update it with npm i -g @mushi-mushi/cli@latest, then restart the worker.`, canRun: false, setup: 'update' }
    case 'offline':
      return { tone: 'warn', text: `${host} is offline${r.lastSeenAt ? ` (last seen ${agoText(r.lastSeenAt, now)})` : ''}. Turn it on, or start the worker on it, to run the test.`, canRun: false, setup: 'workers' }
    case 'none':
      return { tone: 'warn', text: 'The test runs on your computer, where its browser and AI run. Set up Mushi on your computer once, then press Run now.', canRun: false, setup: 'install' }
  }
}

function agoText(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (!Number.isFinite(min)) return 'a while ago'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

/** True for an http(s) address the server will take as a start page. */
export function isStartUrl(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname && !u.username && !u.password
  } catch {
    return false
  }
}

/** What a step's notes say, in plain words. */
export function stepNotes(st: FreshEyesStep): string[] {
  const out: string[] = []
  if (st.outcome === 'refused' || st.outcome === 'blocked' || st.outcome === 'failed') out.push(st.note ?? st.outcome)
  if (st.outcome === 'left-app') out.push('Left the app, came back')
  if (st.outcome === 'terminal' && st.note) out.push(st.note)
  if (st.backtrack) out.push('Went back')
  if (st.dead_end) out.push('Dead end')
  for (const r of st.requirements) out.push(`Needs ${REQUIREMENT_LABEL[r] ?? r}`)
  if (st.signals.length) out.push(`Errors: ${st.signals.join(', ')}`)
  if (st.opinion) out.push(`Felt ${st.opinion.category.replace(/_/g, ' ')}${st.opinion.why ? `: ${st.opinion.why}` : ''}`)
  return out
}

const REQUIREMENT_LABEL: Record<string, string> = {
  inbox: 'an email inbox',
  api_key: 'an API key',
  terminal: 'a terminal',
  third_party_account: 'another account',
}
