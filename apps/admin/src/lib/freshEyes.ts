/**
 * FILE: apps/admin/src/lib/freshEyes.ts
 * PURPOSE: Types and wording for the Fresh eyes tab of the UX runs page
 *          (ADR 0051): runs synced by `mushi ux fresh-eyes --sync`, where a
 *          first-time visitor tried one goal and the time it took.
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

export interface FreshEyesRunListItem {
  local_run_id: string
  status: 'running' | 'done' | 'failed'
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
export function runHeadline(r: Pick<FreshEyesRunListItem, 'reached' | 'counts' | 'ttfv_seconds' | 'steps' | 'stalled_at' | 'status'>): string {
  const sessions = r.counts?.sessions ?? 0
  if (r.status === 'running') return 'Running'
  if ((r.reached ?? 0) > 0) return `${r.reached} of ${sessions} reached the goal · ${formatSeconds(r.ttfv_seconds)} · ${r.steps ?? 0} steps`
  if (r.stalled_at) return `Stalled at ${r.stalled_at.screen}: ${STALL_LABEL[r.stalled_at.reason].toLowerCase()}`
  return `None of ${sessions} reached the goal`
}

/** Time-to-first-value points, oldest first, for the trend line. */
export function ttfvTrend(points: readonly FreshEyesTrendPoint[]): number[] {
  return points.filter((p) => p.metric_name === 'fresh_eyes.ttfv_seconds').map((p) => p.value)
}

/** The command that starts a run like the last one (the console cannot start it: the browser and the model run on your computer). */
export function freshEyesCommand(input: { url: string; goal: string; mushi: boolean }): string {
  const q = (s: string) => `"${s.replace(/["\\$`]/g, '')}"`
  return [`mushi ux fresh-eyes --url ${q(input.url)} --goal ${q(input.goal)}`, input.mushi ? '--mint-account --terminal' : '', '--sync --file'].filter(Boolean).join(' ')
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
