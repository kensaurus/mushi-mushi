/**
 * FILE: packages/cli/src/worker/telemetry.ts
 * PURPOSE: What the local worker tells the console about itself beyond its
 *          counters (ADR 0048 amendment 2026-10-28, worker visibility): each
 *          run's stage, ages, model and last log lines; which lane holds each
 *          agent space; the Cursor account check and the gh sign-in as they
 *          really answered (the gate's grace rules aside).
 *
 *          Everything here leaves the machine, so every line is cleaned
 *          first, as the server cleans it again (_shared/work-telemetry.ts):
 *          no key or token, no e-mail beyond a masked form, no path (Mushi
 *          never sends one, ADR 0048), no source line from a compiler's code
 *          frame, at most 160 characters, at most 4 lines a run. Times are
 *          ages in seconds: the machine's clock is never compared with the
 *          server's.
 */

import { SECRET_PATTERNS } from '../radar/secret-patterns.js'
import type { CursorSignIn } from '../commands/work.js'

export type RunStage = 'prepare' | 'agent' | 'commit' | 'push' | 'pr' | 'run'
export type RunKind = 'fix' | 'conflict' | 'audit' | 'fresh_eyes' | 'followup'

const LINE_MAX = 160
const LOG_LINES = 4

const SOURCE_LINE = /^\s*>?\s*\d+\s*\|/
const TSC_SOURCE_LINE = /^\s*\d+\s{2,}\S/
const URL_CREDENTIALS = /\b(https?:\/\/)[^\s/@]+@/gi
/** A Cursor sign-in link signs the machine in for whoever opens it; it reaches the console only as the sign-in report (cursor-login.ts). */
const LOGIN_LINK = /\bhttps?:\/\/(?:www\.)?cursor\.com\/\S*(?:login|auth)\S*/gi
const BEARER = /\b(bearer\s+)\S+/gi
const AUTH_WORD = /\b((?:token|authorization|password|passwd|secret|api[_-]?key)\s*[:=]\s*)(?!bearer\b)\S+/gi
const EMAIL = /\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9])[A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,})\b/g
const ABS_PATH = /(^|[\s'"(=,])((?:~|[A-Za-z]:)?(?:[\\/][^\s\\/'"()<>,;]+){2,})/g
const LONG_TOKEN = /\b[A-Za-z0-9+/_-]{40,}={0,2}/g

/** `suzu@example.com` → `s***@e***.com`. */
export function maskEmail(text: string): string {
  return text.replace(EMAIL, (_m, a: string, d: string, tld: string) => `${a}***@${d}***.${tld}`)
}

/**
 * One log line, safe to send; null for a line
 * that quotes source code or holds nothing.
 */
export function cleanLine(raw: string): string | null {
  const one = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ')
  if (SOURCE_LINE.test(one) || TSC_SOURCE_LINE.test(one)) return null
  let s = one.replace(LOGIN_LINK, '[sign-in link hidden]').replace(URL_CREDENTIALS, '$1').replace(BEARER, '$1[hidden]').replace(AUTH_WORD, '$1[hidden]')
  s = maskEmail(s)
    .replace(ABS_PATH, (_m, lead: string, path: string) => `${lead}…/${path.split(/[\\/]/).filter(Boolean).pop() ?? ''}`)
    .replace(LONG_TOKEN, '[hidden]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return null
  if (SECRET_PATTERNS.some(({ re }) => re.test(s))) return '[a line was hidden: it looked like a key or token]'
  return s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1)}…` : s
}

/** One run in flight, as the daemon tracks it. */
export interface RunTrack {
  runId: string
  kind: RunKind
  reportId: string | null
  model: string | null
  startedAt: number
  stage: RunStage
  stageAt: number
  log: string[]
}

export function newRun(runId: string, kind: RunKind, o: { reportId?: string | null; model?: string | null; now: number; stage?: RunStage }): RunTrack {
  return { runId, kind, reportId: o.reportId ?? null, model: o.model ?? null, startedAt: o.now, stage: o.stage ?? 'run', stageAt: o.now, log: [] }
}

/** A new stage; the same stage again keeps its start. */
export function setStage(run: RunTrack, stage: RunStage, now: number): void {
  if (run.stage === stage) return
  run.stage = stage
  run.stageAt = now
}

/** Keep the last few cleaned lines of a run's log. */
export function pushLog(run: RunTrack, line: string): void {
  const clean = cleanLine(line)
  if (!clean) return
  run.log.push(clean)
  if (run.log.length > LOG_LINES) run.log.splice(0, run.log.length - LOG_LINES)
}

const sec = (ms: number) => Math.max(0, Math.round(ms / 1000))

/** A run as the heartbeat sends it. */
export function runStatus(run: RunTrack, now: number) {
  return { runId: run.runId, kind: run.kind, reportId: run.reportId, ageSec: sec(now - run.startedAt), stage: run.stage, stageSec: sec(now - run.stageAt), model: run.model, log: [...run.log] }
}

/** Who holds an agent space, as the heartbeat sends it. */
export function slotStatus(lane: string, run: RunTrack, now: number) {
  return { lane, runId: run.runId, kind: run.kind, ageSec: sec(now - run.startedAt), stage: run.stage, stageSec: sec(now - run.stageAt) }
}

export type CursorCheckResult = 'expected' | 'other_account' | 'signed_out' | 'timed_out' | 'missing' | 'unclear'

/**
 * What `cursor-agent status` really said, before
 * the gate's rules (a signed-in other account counts as signed out there; a
 * timeout counts as signed in for 2 hours after the last confirmation).
 */
export function cursorCheckResult(s: { state: CursorSignIn; detail: string; output: string }, account: string | undefined): CursorCheckResult {
  if (s.state === 'missing') return 'missing'
  if (s.state === 'signed_out') return 'signed_out'
  if (s.state === 'signed_in') return account && !s.output.toLowerCase().includes(account.toLowerCase()) ? 'other_account' : 'expected'
  return /^timed out/.test(s.detail) ? 'timed_out' : 'unclear'
}

export type GhCheckResult = 'signed_in' | 'signed_out' | 'unknown'

/** A `gh` call's answer: signed in, clearly signed out, or unknown (a hang is not an answer). */
export function ghCheckResult(p: { code: number | null; timedOut?: boolean; stderr: string }): GhCheckResult {
  if (p.code === 0) return 'signed_in'
  if (p.timedOut || p.code === null) return 'unknown'
  return /gh auth login|not logged in|authentication|bad credentials|HTTP 401/i.test(p.stderr) ? 'signed_out' : 'unknown'
}
