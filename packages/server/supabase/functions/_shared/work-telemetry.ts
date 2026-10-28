/**
 * FILE: packages/server/supabase/functions/_shared/work-telemetry.ts
 * PURPOSE: What a local worker (ADR 0048) says about itself beyond lane-v4's
 *          counters, so the console can show WHY a lane is not working
 *          (ADR 0048 amendment 2026-10-28, worker visibility):
 *
 *            host   the Cursor account check (result, age, a masked detail),
 *                   the gh sign-in, load and cores, why the host waits, which
 *                   lane holds each agent space and in which stage, and lanes
 *                   that could not start (a clone that is not a git clone);
 *            lane   each run in flight: its claim, stage, ages, model and the
 *                   last few log lines.
 *
 *          Telemetry, never control: unknown keys are dropped, every string
 *          is cleaned again here (the daemon cleans first), and every list is
 *          capped. Ages are seconds measured on the machine, so a wrong clock
 *          there never makes a run look older or newer than it is.
 *
 *          A log line keeps no key, token, e-mail beyond a masked form, path
 *          (Mushi never stores a path, ADR 0048) or source line from a
 *          compiler's code frame; a line that still looks like a secret is
 *          replaced whole.
 */

import { scanForSecrets } from './secret-scan.ts'

export const RUN_STAGES = ['prepare', 'agent', 'commit', 'push', 'pr', 'run'] as const
export type RunStage = (typeof RUN_STAGES)[number]
export const RUN_KINDS = ['fix', 'conflict', 'audit', 'fresh_eyes', 'followup'] as const
export type RunKind = (typeof RUN_KINDS)[number]

export const CURSOR_CHECK_RESULTS = ['expected', 'other_account', 'signed_out', 'timed_out', 'missing', 'unclear'] as const
export type CursorCheckResult = (typeof CURSOR_CHECK_RESULTS)[number]
export const GH_CHECK_RESULTS = ['signed_in', 'signed_out', 'unknown'] as const
export type GhCheckResult = (typeof GH_CHECK_RESULTS)[number]

/** Lines of log kept per run, and characters per line. */
export const LOG_LINES_MAX = 4
export const LINE_MAX = 160
const RUNS_PER_LANE_MAX = 5
const SLOTS_MAX = 16
const NOT_READY_MAX = 20

export interface RunTelemetry {
  /** The claim id, or `followup-<first 8 hex of the fix id>` for a review follow-up (not a claim). */
  runId: string
  kind: RunKind
  reportId: string | null
  /** Seconds since the run started. */
  ageSec: number
  stage: RunStage
  /** Seconds since the current stage began. */
  stageSec: number
  model: string | null
  log: string[]
}

export interface SlotTelemetry {
  lane: string
  runId: string
  kind: RunKind
  ageSec: number
  stage: RunStage
  stageSec: number
}

export interface HostChecks {
  cursor?: { result: CursorCheckResult; ageSec: number; detail: string; account: string | null }
  gh?: { result: GhCheckResult; ageSec: number; detail: string }
  notReady?: Array<{ lane: string; problem: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RUN_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|followup-[0-9a-f]{8})$/i
const LANE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
/** A masked account: some letters, then `***`, an @ and a masked domain. Never a whole address. */
const MASKED_ACCOUNT_RE = /^[A-Za-z0-9._+-]{0,3}\*{3}@[A-Za-z0-9.*-]{1,60}$/

/** A compiler's or linter's code frame quotes the file: `  12 | const x`, `> 12 | …`, tsc's `12   const x`. */
const SOURCE_LINE = /^\s*>?\s*\d+\s*\|/
const TSC_SOURCE_LINE = /^\s*\d+\s{2,}\S/
const URL_CREDENTIALS = /\b(https?:\/\/)[^\s/@]+@/gi
const BEARER = /\b(bearer\s+)\S+/gi
const AUTH_WORD = /\b((?:token|authorization|password|passwd|secret|api[_-]?key)\s*[:=]\s*)(?!bearer\b)\S+/gi
const EMAIL = /\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9])[A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,})\b/g
/** An absolute path (POSIX, home-relative or a Windows drive) at the start of a word: only its last part is kept. */
const ABS_PATH = /(^|[\s'"(=,])((?:~|[A-Za-z]:)?(?:[\\/][^\s\\/'"()<>,;]+){2,})/g
/** A long run of key-like characters (a token, a hash) carries nothing a person reads. */
const LONG_TOKEN = /\b[A-Za-z0-9+/_-]{40,}={0,2}/g

/** Mask an e-mail address to `s***@g***.com`. */
export function maskEmail(text: string): string {
  return text.replace(EMAIL, (_m, a: string, d: string, tld: string) => `${a}***@${d}***.${tld}`)
}

/**
 * One log line, safe to store and show: no control characters, no
 * credentials in a URL, no `token=…`, e-mails masked, absolute paths cut to
 * their last part, long key-like strings removed, at most LINE_MAX
 * characters. Returns null for a line that quotes source code; a line that
 * still matches a secret pattern is replaced whole.
 */
export function cleanLogLine(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const one = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ')
  if (SOURCE_LINE.test(one) || TSC_SOURCE_LINE.test(one)) return null
  let s = one
    .replace(URL_CREDENTIALS, '$1')
    .replace(BEARER, '$1[hidden]')
    .replace(AUTH_WORD, '$1[hidden]')
  s = maskEmail(s)
    .replace(ABS_PATH, (_m, lead: string, path: string) => `${lead}…/${path.split(/[\\/]/).filter(Boolean).pop() ?? ''}`)
    .replace(LONG_TOKEN, '[hidden]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return null
  if (scanForSecrets(s)) return '[a line was hidden: it looked like a key or token]'
  return s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1)}…` : s
}

function seconds(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 400 * 86_400) : null
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null
}

function cleanRun(raw: unknown): RunTelemetry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const runId = typeof r.runId === 'string' && RUN_ID_RE.test(r.runId) ? r.runId.toLowerCase() : null
  const kind = oneOf(RUN_KINDS, r.kind)
  const ageSec = seconds(r.ageSec)
  if (!runId || !kind || ageSec === null) return null
  const stage = oneOf(RUN_STAGES, r.stage) ?? 'run'
  const log = (Array.isArray(r.log) ? r.log : [])
    .slice(-LOG_LINES_MAX * 3)
    .map(cleanLogLine)
    .filter((l): l is string => !!l)
    .slice(-LOG_LINES_MAX)
  return {
    runId,
    kind,
    reportId: typeof r.reportId === 'string' && UUID_RE.test(r.reportId) ? r.reportId.toLowerCase() : null,
    ageSec,
    stage,
    stageSec: Math.min(seconds(r.stageSec) ?? ageSec, ageSec),
    model: typeof r.model === 'string' && MODEL_RE.test(r.model) ? r.model : null,
    log,
  }
}

/** A lane's runs in flight, cleaned and capped. */
export function cleanRuns(raw: unknown): RunTelemetry[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, RUNS_PER_LANE_MAX).map(cleanRun).filter((r): r is RunTelemetry => !!r)
}

/** Which lane holds each of the host's agent spaces. */
export function cleanSlots(raw: unknown): SlotTelemetry[] {
  if (!Array.isArray(raw)) return []
  const out: SlotTelemetry[] = []
  for (const x of raw.slice(0, SLOTS_MAX)) {
    if (!x || typeof x !== 'object') continue
    const s = x as Record<string, unknown>
    const lane = typeof s.lane === 'string' && LANE_NAME_RE.test(s.lane) ? s.lane : null
    const runId = typeof s.runId === 'string' && RUN_ID_RE.test(s.runId) ? s.runId.toLowerCase() : null
    const kind = oneOf(RUN_KINDS, s.kind)
    const ageSec = seconds(s.ageSec)
    if (!lane || !runId || !kind || ageSec === null) continue
    out.push({ lane, runId, kind, ageSec, stage: oneOf(RUN_STAGES, s.stage) ?? 'run', stageSec: Math.min(seconds(s.stageSec) ?? ageSec, ageSec) })
  }
  return out
}

/** The host's checks: the Cursor account, gh, and lanes that could not start. */
export function cleanChecks(raw: unknown): HostChecks {
  const out: HostChecks = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const c = raw as Record<string, unknown>
  const cur = c.cursor as Record<string, unknown> | undefined
  const curResult = oneOf(CURSOR_CHECK_RESULTS, cur?.result)
  const curAge = seconds(cur?.ageSec)
  if (cur && curResult && curAge !== null) {
    const account = typeof cur.account === 'string' && MASKED_ACCOUNT_RE.test(cur.account) ? cur.account : null
    out.cursor = { result: curResult, ageSec: curAge, detail: cleanLogLine(cur.detail) ?? '', account }
  }
  const gh = c.gh as Record<string, unknown> | undefined
  const ghResult = oneOf(GH_CHECK_RESULTS, gh?.result)
  const ghAge = seconds(gh?.ageSec)
  if (gh && ghResult && ghAge !== null) out.gh = { result: ghResult, ageSec: ghAge, detail: cleanLogLine(gh.detail) ?? '' }
  if (Array.isArray(c.notReady)) {
    const notReady = (c.notReady as unknown[])
      .slice(0, NOT_READY_MAX)
      .map((x) => {
        const n = (x ?? {}) as Record<string, unknown>
        const lane = typeof n.lane === 'string' && LANE_NAME_RE.test(n.lane) ? n.lane : null
        const problem = cleanLogLine(n.problem)
        return lane && problem ? { lane, problem } : null
      })
      .filter((x): x is { lane: string; problem: string } => !!x)
    if (notReady.length) out.notReady = notReady
  }
  return out
}

/** The structured parts of a host's status (beside cleanStatus's flat numbers and words). */
export function cleanHostTelemetry(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const s = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const checks = cleanChecks(s.checks)
  if (Object.keys(checks).length) out.checks = checks
  const slots = cleanSlots(s.slots)
  if (Array.isArray(s.slots)) out.slots = slots
  const why = cleanLogLine(s.waitWhy)
  if (why) out.waitWhy = why
  return out
}

/** The structured parts of a lane's status. */
export function cleanLaneTelemetry(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const s = raw as Record<string, unknown>
  return Array.isArray(s.inflight) ? { inflight: cleanRuns(s.inflight) } : {}
}
