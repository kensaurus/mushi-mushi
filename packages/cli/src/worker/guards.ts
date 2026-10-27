/**
 * FILE: packages/cli/src/worker/guards.ts
 * PURPOSE: The local worker's machine guards (ADR 0048), lane-v4's lessons
 *          as one pure decision. Each one cost a lane on 2026-10-26:
 *
 *            - low memory: wait while less than the floor is free;
 *            - an exhausted GitHub API quota: wait below the floor;
 *            - Cursor signed out: wait (a status call that times out under
 *              load is "unknown", not "signed out", for 2 hours);
 *            - too many agents at once: one cap across every lane on the host;
 *            - spending past the window: a lane stops at its stop date.
 *
 *          The numbers come from the server (the console sets them); the
 *          checks run here, on the machine.
 */

import type { HostGuards } from './protocol.js'

export type HostState = 'working' | 'mem-wait' | 'gh-quota-wait' | 'auth-wait' | 'slot-wait'

export interface MachineReadings {
  /** Free memory in GB (MemAvailable), or null when unreadable. */
  memAvailableGb: number | null
  /** GitHub core API calls left, or null when unknown (a hung or failed call). */
  ghRemaining: number | null
  cursor: 'signed_in' | 'signed_out' | 'unknown' | 'missing'
  /** Agents running now across every lane on this host. */
  agents: number
}

/** A sign-in confirmed this recently still counts while a status call times out under load. */
export const CURSOR_CONFIRM_GRACE_MS = 2 * 3600_000

/**
 * Whether the host may start another agent,
 * and if not, the lane-v4 state word saying why. Unknown readings never
 * block (a hung `gh` or a slow `cursor-agent status` is not an answer).
 */
export function hostGate(g: HostGuards, r: MachineReadings): { ok: true } | { ok: false; state: HostState; why: string } {
  if (r.memAvailableGb !== null && r.memAvailableGb < g.min_free_mem_gb) {
    return { ok: false, state: 'mem-wait', why: `${r.memAvailableGb} GB free, under the ${g.min_free_mem_gb} GB floor` }
  }
  if (r.ghRemaining !== null && r.ghRemaining < g.gh_floor) {
    return { ok: false, state: 'gh-quota-wait', why: `${r.ghRemaining} GitHub API calls left, under the ${g.gh_floor} floor` }
  }
  if (r.cursor === 'missing') return { ok: false, state: 'auth-wait', why: 'cursor-agent is not installed or not on PATH' }
  if (r.cursor === 'signed_out') return { ok: false, state: 'auth-wait', why: 'the Cursor CLI is signed out (run cursor-agent login)' }
  // 'unknown' (a status call that timed out) goes on, as `mushi work` does:
  // the daemon logs it, and an agent that is really signed out stops at once.
  if (r.agents >= g.max_agents) return { ok: false, state: 'slot-wait', why: `${r.agents} agents running, the host's cap is ${g.max_agents}` }
  return { ok: true }
}

/** True once a lane's stop date has passed (checked on the machine too). */
export function pastStop(stopAt: string | null, nowMs: number): boolean {
  if (!stopAt) return false
  const t = Date.parse(stopAt)
  return Number.isFinite(t) && nowMs >= t
}

/** MemAvailable from /proc/meminfo, in whole GB, or null. */
export function memAvailableGb(meminfo: string | null): number | null {
  const m = meminfo ? /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo) : null
  return m ? Math.floor(Number(m[1]) / 1048576) : null
}
