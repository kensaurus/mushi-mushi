// SPDX-License-Identifier: MIT
/**
 * Run state on disk: `.mushi/ux/<runId>/state.json` plus the PNGs beside it.
 * Written atomically (temp file + rename) after every step, so a crashed or
 * interrupted run resumes where it stopped.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CheckerVerdict } from './checker.js'
import type { JudgeVerdict } from './judge.js'
import type { ProbeResult, Surface } from './types.js'

export type SurfaceStatus =
  | 'pending'
  | 'baseline'
  | 'iterating'
  | 'accepted'
  | 'reverted'
  | 'skipped'
  | 'regressed'
  | 'blocked'

export interface ShotRef {
  /** PNG path relative to the run directory. */
  png: string
  probes: ProbeResult
  penalty: number
}

export interface IterationRecord {
  n: number
  agent: string
  model: string | null
  startedAt: string
  durationMs: number
  outcome: 'accepted' | 'rejected' | 'agent_failed' | 'capture_failed' | 'no_change'
  reason: string
  commitSha: string | null
  /** Changed-pixel share per viewport, before vs after. */
  pixelDiff: Record<string, number>
  after: Record<string, ShotRef>
  diffPng: Record<string, string>
  /**
   * Where this attempt changed the screen, per viewport, against the screen
   * before it (the last kept state): image size and up to four boxes.
   */
  changes?: Record<string, { width: number; height: number; boxes: Array<{ x: number; y: number; w: number; h: number }> }>
  logTail: string
  /** agent_failed because the time box ran out (another attempt may still succeed). */
  timedOut?: boolean
  /** Steps mode: the plan step this attempt worked on. */
  step?: string
  /** Kept without a visible change: a person should read the diff (ADR 0021). */
  needsReview?: boolean
  /** The second model's review of a kept step (ADR 0021). */
  checker?: CheckerVerdict
}

/** One small, separate improvement from a screen's plan; each gets its own attempt. */
export interface PlanStep {
  text: string
  status: 'pending' | 'done' | 'skipped' | 'failed'
  /** The attempt that worked on it. */
  attempt?: number
  reason?: string
}

export interface SurfaceState {
  /** Steps mode: the screen's plan, made before any edit; null when planning produced none. */
  /** `session`: the agent session that planned, resumed by each step so it keeps what it read. */
  plan?: { steps: PlanStep[]; session?: string | null } | null
  surface: Surface
  status: SurfaceStatus
  /** Why it is blocked / skipped / regressed, in a sentence. */
  note: string | null
  baseline: Record<string, ShotRef>
  iterations: IterationRecord[]
  /** Final pairwise review per viewport; advisory only. */
  judge?: JudgeVerdict[]
}

/** Where the run is, for the live views. */
export type RunPhase = 'starting' | 'worktree' | 'install' | 'dev-server' | 'mapping' | 'working' | 'reviewing' | 'done' | 'failed'

/** Live progress of the attempt in flight, refreshed at least every HEARTBEAT_MS. */
export interface CurrentAttempt {
  surface: string
  attempt: number
  startedAt: string
  /** The agent is stopped after this long. */
  timeoutMs?: number
  /** Steps the agent took so far (reads, edits, commands, messages). */
  steps?: number
  /** The latest step, one line ("[edit] app/page.tsx"). */
  lastStep?: string | null
  /** Files changed in the worktree so far (git status). */
  files?: string[]
  /** When the run last checked in; an old value means the run has stopped. */
  heartbeatAt?: string
}

/**
 * The settings a run started with, so a resume needs only the run id (from
 * the studio's Resume button or `mushi-ux run --resume <id>`). The signed-in
 * profile is saved as its login URL, never as a path (ADR 0006); the skill's
 * files are kept beside the state in `skill/`.
 */
export interface SavedRunOptions {
  agent: string
  model: string | null
  devCommand: string
  /** null = no install; undefined = detect from the lockfile. */
  installCommand?: string | null
  startPaths?: string[]
  crawl?: boolean
  iterations: number
  maxSurfaces: number
  agentTimeoutMs: number
  ignore?: string[]
  allow?: string[]
  judgeModel?: string | null
  loginUrl?: string | null
  /** Mirror to the console again when resumed (needs the login then too). */
  sync?: boolean
  /** Steps mode: plan each screen, then one small change per attempt. */
  steps?: boolean
  /** The reviewing model that may veto a kept step (ADR 0021). */
  checker?: { via: 'claude-code' | 'anthropic-api'; model: string } | null
  /** Keep edits with nothing visible, flagged for review. */
  keepInvisible?: boolean
}

export interface RunState {
  version: 1
  runId: string
  baseUrl: string
  createdAt: string
  updatedAt: string
  agent: string
  model: string | null
  /** Skill the agent applies, if any (name and where it came from). */
  skill?: { name: string; source: string } | null
  /** Git ref the worktree branched from (HEAD unless --base). */
  baseRef?: string
  phase?: RunPhase
  /** One line on what the phase is doing ("npm ci", "Home, attempt 2 of 2"). */
  phaseDetail?: string | null
  /** The screen and attempt the agent is on, while it works. */
  current?: CurrentAttempt | null
  finishedAt?: string | null
  /** Why the run stopped, when it failed. */
  error?: string | null
  /** Stopped from the studio rather than failed. */
  stopped?: boolean
  /** Model of the final review; null when the review is off. */
  judgeModel?: string | null
  /** Settings to resume with; absent on runs from before 2026-10-06. */
  options?: SavedRunOptions
  /** The worktree's install finished; a run killed mid-install installs again. */
  installed?: boolean
  /** Worktree and branch the agent edits; null before the worktree exists. */
  worktree: string | null
  branch: string | null
  baseSha: string | null
  surfaces: SurfaceState[]
}

export function runDir(repoRoot: string, runId: string): string {
  return join(repoRoot, '.mushi', 'ux', runId)
}

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

export function saveState(dir: string, state: RunState): void {
  mkdirSync(dir, { recursive: true })
  state.updatedAt = new Date().toISOString()
  const file = join(dir, 'state.json')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}

export function loadState(dir: string): RunState | null {
  const file = join(dir, 'state.json')
  if (!existsSync(file)) return null
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as RunState
  if (parsed.version !== 1) throw new Error(`Unsupported run state version ${String(parsed.version)} in ${file}`)
  return parsed
}

/** Write a PNG under the run directory; returns its relative path. */
export function savePng(dir: string, rel: string, png: Buffer): string {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, png)
  return rel.replace(/\\/g, '/')
}
