/**
 * FILE: packages/server/supabase/functions/_shared/health-gate.ts
 * PURPOSE: "Stop the line" (plan-simplicity-2026-10 §4b, Phase 1 unit B;
 *          ADR 0054, Proposed). Before a dispatcher starts work for an app it
 *          asks whether a Health check that blocks that automation is a
 *          problem. The switch is `mushi_runtime_config.health_gate_mode`:
 *
 *            off      (default; also a missing row, a failed read or any other
 *                      value): nothing is evaluated beyond reading the switch;
 *            observe: the gate records "would pause" and the dispatcher runs
 *                      exactly as before;
 *            enforce: the dispatcher withholds that automation for the app and
 *                      records why. Withheld work is left where it was, so it
 *                      resumes on its own once the check is no longer a problem.
 *
 *          The gate can only ever WITHHOLD work. It never starts, merges,
 *          readies or retries anything, and it sits in front of the existing
 *          gates (Opus hold, head-pinned merge verdicts, verified merge,
 *          draft → ready; ADRs 0030, 0035, 0041, 0047), never around them.
 *
 *          Every doubt runs as today: an `unknown` check never pauses, a
 *          stored answer older than GATE_MAX_AGE_MS reads as `unknown`, and a
 *          failed read of the switch or the checks is `off` / `unknown`. This
 *          is the opposite of ADR 0048's lease, where an unreadable lease
 *          counts as held: a lease protects work a person's machine is doing,
 *          while this gate only saves wasted runs, so a doubt must not stop
 *          the line.
 *
 *          Where the checks come from: the stored setup-gaps answer
 *          (`setup_gap_results`, written by the setup-gaps and health-check
 *          routes) and a live read of the review follow-up key (two small
 *          reads). Never GitHub probes or SDK reads from a dispatcher.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import type { SetupGap } from './setup-gaps.ts'
import { fromSetupGap, type HealthBlock, type HealthCheck } from './health-checks.ts'
import { readFollowupKeyGap } from './setup-gap-followup.ts'

const glog = log.child('health-gate')

export const HEALTH_GATE_MODES = ['off', 'observe', 'enforce'] as const
export type HealthGateMode = (typeof HEALTH_GATE_MODES)[number]
export const HEALTH_GATE_CONFIG_KEY = 'health_gate_mode'

/**
 * A stored check older than this is `unknown` to the gate. One hour: the
 * console re-checks on every Set up and Home visit; without a visit the gate
 * stops trusting the answer rather than pausing on a cause already fixed.
 * Before `enforce` is turned on, Phase 2 adds a refresher so this holds
 * without visits (ADR 0054).
 */
export const GATE_MAX_AGE_MS = 60 * 60_000

/** Anything but an exact 'observe' or 'enforce' is off. */
export function parseHealthGateMode(raw: unknown): HealthGateMode {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return v === 'observe' || v === 'enforce' ? v : 'off'
}

/** The problems that stop `block`. `ok` and `unknown` never do. */
export function pausingChecks(checks: ReadonlyArray<HealthCheck>, block: HealthBlock): HealthCheck[] {
  return checks.filter((c) => c.status === 'problem' && c.blocks.includes(block))
}

export interface GateVerdict {
  mode: HealthGateMode
  block: HealthBlock
  /** The problems that would stop this automation; empty when none (or off). */
  pausing: HealthCheck[]
  /** True only in `enforce` with at least one problem: the caller skips the work. */
  withhold: boolean
  /** A problem stops it (in observe and enforce); recorded, not acted on in observe. */
  wouldPause: boolean
}

export function gateVerdict(mode: HealthGateMode, checks: ReadonlyArray<HealthCheck>, block: HealthBlock): GateVerdict {
  if (mode === 'off') return { mode, block, pausing: [], withhold: false, wouldPause: false }
  const pausing = pausingChecks(checks, block)
  const wouldPause = pausing.length > 0
  return { mode, block, pausing, withhold: mode === 'enforce' && wouldPause, wouldPause }
}

/** One plain sentence for a withheld item ("Paused: <title>. <detail>"). */
export function pauseReason(v: GateVerdict): string {
  const first = v.pausing[0]
  if (!first) return ''
  const more = v.pausing.length > 1 ? ` (and ${v.pausing.length - 1} more)` : ''
  return `Paused until this is fixed: ${first.title}${more}. ${first.detail}`.slice(0, 500)
}

/**
 * The stored setup-gaps answer as gate checks. Older than GATE_MAX_AGE_MS
 * (or unreadable) → every row `unknown`, so nothing pauses on old news.
 */
export function checksFromStored(row: { value: unknown; checked_at: string } | null, now: Date): HealthCheck[] {
  if (!row) return []
  const gaps = (row.value as { gaps?: unknown } | null)?.gaps
  if (!Array.isArray(gaps)) return []
  const at = Date.parse(row.checked_at)
  const fresh = Number.isFinite(at) && now.getTime() - at <= GATE_MAX_AGE_MS
  return (gaps as SetupGap[])
    .filter((g) => g && typeof g.id === 'string' && g.audience === 'app_owner')
    .map((g) => {
      const c = fromSetupGap(g, row.checked_at)
      return fresh ? c : { ...c, status: c.status === 'problem' ? ('unknown' as const) : c.status }
    })
}

export interface HealthGate {
  readonly mode: HealthGateMode
  /** Whether to withhold `block` for this app. Never throws. */
  check(projectId: string, block: HealthBlock): Promise<GateVerdict>
}

export interface HealthGateDeps {
  now?: () => Date
  /** The switch; the default reads mushi_runtime_config.health_gate_mode. */
  readMode?: (db: SupabaseClient) => Promise<HealthGateMode>
  /** The checks for one app; the default reads the stored setup gaps and the live follow-up key. */
  loadChecks?: (db: SupabaseClient, projectId: string, now: Date) => Promise<HealthCheck[]>
  /** Records one decision; the default writes a structured log and the shadow counter. */
  record?: (db: SupabaseClient, projectId: string, verdict: GateVerdict, automation: string) => Promise<void>
}

/** An always-off gate: what a dispatcher uses when it is given none. */
export const OFF_GATE: HealthGate = {
  mode: 'off',
  check: async (_projectId, block) => gateVerdict('off', [], block),
}

export async function readHealthGateMode(db: SupabaseClient): Promise<HealthGateMode> {
  try {
    const { data, error } = await db.from('mushi_runtime_config').select('value').eq('key', HEALTH_GATE_CONFIG_KEY).maybeSingle()
    if (error) return 'off'
    return parseHealthGateMode((data as { value?: unknown } | null)?.value)
  } catch {
    return 'off'
  }
}

/** The default checks for one app. Any failed read leaves that check out or `unknown`. */
export async function loadGateChecks(db: SupabaseClient, projectId: string, now: Date): Promise<HealthCheck[]> {
  const [storedRes, projectRes] = await Promise.all([
    db.from('setup_gap_results').select('value, checked_at').eq('project_id', projectId).maybeSingle(),
    db.from('projects').select('id, organization_id').eq('id', projectId).maybeSingle(),
  ])
  const stored = storedRes.error ? [] : checksFromStored(storedRes.data as { value: unknown; checked_at: string } | null, now)
  if (projectRes.error || !projectRes.data) return stored
  // The follow-up key is read live: deleting it is the 2026-10-29 outage this gate exists for.
  const live = fromSetupGap(await readFollowupKeyGap(db, projectRes.data as { id: string; organization_id: string | null }), now.toISOString())
  return [...stored.filter((c) => c.id !== 'review_followup_key'), live]
}

/**
 * Adds one to today's count of (app, automation, check) decisions in
 * `health_gate_shadow` (migration 20261029120000). A missing table or any
 * other failure is ignored: recording never changes what a dispatcher does.
 */
export async function recordGateDecision(db: SupabaseClient, projectId: string, verdict: GateVerdict, automation: string): Promise<void> {
  if (!verdict.wouldPause) return
  glog.info(verdict.withhold ? 'health-gate.paused' : 'health-gate.would_pause', {
    projectId,
    automation,
    block: verdict.block,
    mode: verdict.mode,
    checks: verdict.pausing.map((c) => c.key),
  })
  try {
    const { error } = await db.rpc('health_gate_record', {
      p_project_id: projectId,
      p_automation: automation,
      p_check_ids: verdict.pausing.map((c) => c.id),
      p_mode: verdict.mode,
    })
    if (error && !/42P01|42883|PGRST202|PGRST205|does not exist|could not find/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) {
      glog.warn('health gate decision not counted', { projectId, err: error.message })
    }
  } catch {
    // Never let a counter decide anything.
  }
}

/**
 * The gate for one tick (or one fix-worker request). Reads the switch once;
 * in `off` it returns OFF_GATE and reads nothing else. Checks are read once
 * per app per tick. `automation` names the dispatcher in the record.
 */
export async function createHealthGate(db: SupabaseClient, automation: string, deps: HealthGateDeps = {}): Promise<HealthGate> {
  let mode: HealthGateMode
  try {
    mode = parseHealthGateMode(await (deps.readMode ?? readHealthGateMode)(db))
  } catch {
    mode = 'off'
  }
  if (mode === 'off') return OFF_GATE
  const now = deps.now ?? (() => new Date())
  const loadChecks = deps.loadChecks ?? loadGateChecks
  const record = deps.record ?? recordGateDecision
  const perProject = new Map<string, Promise<HealthCheck[]>>()
  return {
    mode,
    async check(projectId, block) {
      let checks: HealthCheck[]
      try {
        let p = perProject.get(projectId)
        if (!p) {
          p = loadChecks(db, projectId, now())
          perProject.set(projectId, p)
        }
        checks = await p
      } catch {
        checks = []
      }
      const verdict = gateVerdict(mode, checks, block)
      try {
        await record(db, projectId, verdict, automation)
      } catch {
        // Recording never changes the verdict.
      }
      return verdict
    },
  }
}
