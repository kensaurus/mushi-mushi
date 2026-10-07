// SPDX-License-Identifier: MIT
/**
 * `--sync`: mirror a run to the Mushi console while it runs (Plan 021
 * Phase 2). After each state change (debounced) the run snapshot is PUT to
 * the api: phase, the screen and attempt the agent is on, every screen and
 * attempt. Screenshots go up through signed upload URLs as soon as they
 * exist (baseline, then each attempt, mobile and desktop), each one once.
 * A failed sync never stops the loop; the next state change retries, and
 * the final sync is awaited.
 *
 * Agent output stays on this machine: the console gets the files each
 * attempt read and edited (syncableStep), never the agent's words, the
 * commands it ran, or console text.
 *
 * Credentials come from MUSHI_API_KEY / MUSHI_PROJECT_ID / MUSHI_API_ENDPOINT
 * (`mushi ux` passes the CLI's saved login). The coding agent never sees
 * them: its environment drops every MUSHI_* variable (proc.ts).
 */

import type { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cropTop } from './image.js'
import type { LoopEvent } from './loop.js'
import { loadState, type RunState, type SurfaceState } from './state.js'
import type { ProbeResult } from './types.js'

const CLOUD_API_ENDPOINT = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'
const VIEWPORT_NAMES = ['desktop', 'mobile'] as const
/** Screenshots per upload request (the api caps one request at 60 names). */
const UPLOAD_BATCH = 40

export interface SyncConfig {
  apiKey: string
  projectId: string
  endpoint: string
  /** 'cloud' when the run executes on the host's CI rather than a laptop. */
  mode: 'local' | 'cloud'
}

export function syncConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SyncConfig | null {
  const apiKey = env.MUSHI_API_KEY?.trim()
  const projectId = env.MUSHI_PROJECT_ID?.trim()
  if (!apiKey || !projectId) return null
  return {
    apiKey,
    projectId,
    endpoint: (env.MUSHI_API_ENDPOINT?.trim() || CLOUD_API_ENDPOINT).replace(/\/+$/, ''),
    mode: env.GITHUB_ACTIONS === 'true' ? 'cloud' : 'local',
  }
}

const PROJECT_LINE_RE = /^\s*(?:NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|PUBLIC_)?MUSHI_PROJECT_ID\s*=\s*["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']?\s*$/im

/**
 * The Mushi project this repo's app reports to, from the public SDK variable
 * in its env files (NEXT_PUBLIC_MUSHI_PROJECT_ID and friends). Only that one
 * line is read; nothing else in the file is kept.
 */
export function repoProjectId(repoRoot: string): string | null {
  for (const name of ['.env.local', '.env.development.local', '.env.development', '.env']) {
    const file = join(repoRoot, name)
    if (!existsSync(file)) continue
    const m = readFileSync(file, 'utf8').match(PROJECT_LINE_RE)
    if (m) return m[1]
  }
  return null
}

/** Null when syncing to `cfg.projectId` is right for this repo, else why not. */
export function syncProjectMismatch(cfg: SyncConfig, repoRoot: string): string | null {
  const repoProject = repoProjectId(repoRoot)
  if (!repoProject || repoProject === cfg.projectId) return null
  return `This repo's app reports to Mushi project ${repoProject}, but your login is for ${cfg.projectId}. Run \`mushi login\` and pick this app's project (or set MUSHI_PROJECT_ID), so the run lands on the right project.`
}

function probeSummary(p: ProbeResult | undefined) {
  if (!p) return null
  return {
    axe: p.axe.map((v) => ({ id: v.id, impact: v.impact, help: v.help.slice(0, 300), count: v.count })).slice(0, 60),
    overflowX: p.overflowX,
    smallTargets: p.smallTargets,
    consoleErrors: p.consoleErrors.length,
    cls: p.cls,
  }
}

/**
 * Pure: the part of an agent step that may leave the machine. Agent output
 * stays local (it can quote file contents, commands and their output), so
 * the console gets only which files were read or edited; a command or a
 * search is counted, never shown. Anything else, raw lines included, is
 * dropped.
 */
export function syncableStep(line: string): string | null {
  if (/^\[(read|edit)\] \S/.test(line)) return line.slice(0, 300)
  if (line.startsWith('[run] ')) return '[run] a command'
  if (line.startsWith('[find] ')) return '[find] a search'
  if (line === '[done] Finished') return line
  return null
}

function syncableSteps(log: string | undefined): string | null {
  const kept = (log ?? '').split('\n').map(syncableStep).filter((l): l is string => l !== null)
  return kept.length ? kept.join('\n').slice(-2000) : null
}

/** The worse of the phone and desktop scores: a change is judged on both, so one number must not hide the other. */
function worstPenalty(shots: Partial<Record<string, { penalty: number }>>): number | null {
  const scores = Object.values(shots).flatMap((r) => (r && typeof r.penalty === 'number' ? [r.penalty] : []))
  return scores.length ? Math.max(...scores) : null
}

function lastKept(s: SurfaceState) {
  return [...s.iterations].reverse().find((i) => i.outcome === 'accepted') ?? null
}

/** One screenshot to mirror: its upload name and its file in the run dir. */
interface WantedShot {
  /** `<surface>/<slot>.png`, e.g. `home-1a2b3c/iter2-after-mobile.png`. */
  name: string
  /** PNG path relative to the run dir. */
  rel: string
}

/** Pure: every screenshot the console should have for this state. */
export function wantedShots(state: RunState): WantedShot[] {
  const out: WantedShot[] = []
  for (const s of state.surfaces) {
    const key = s.surface.key
    const kept = lastKept(s)
    for (const vp of VIEWPORT_NAMES) {
      const before = s.baseline[vp]?.png
      if (before) out.push({ name: `${key}/before-${vp}.png`, rel: before })
      const after = kept?.after[vp]?.png
      if (after) out.push({ name: `${key}/after-${vp}.png`, rel: after })
      const diff = kept?.diffPng[vp]
      if (diff) out.push({ name: `${key}/diff-${vp}.png`, rel: diff })
      for (const it of s.iterations) {
        if (it.after[vp]?.png) out.push({ name: `${key}/iter${it.n}-after-${vp}.png`, rel: it.after[vp].png })
        if (it.diffPng[vp]) out.push({ name: `${key}/iter${it.n}-diff-${vp}.png`, rel: it.diffPng[vp] })
      }
    }
  }
  return out
}

/** Pure, for tests: the PUT body for one run state. `uploaded` maps upload name → the file it came from. */
export function toSnapshot(state: RunState, finished: boolean, uploaded: ReadonlyMap<string, string>, mode: SyncConfig['mode'] = 'local') {
  const have = (name: string) => (uploaded.has(name) ? name : null)
  const status = state.stopped ? 'stopped' : state.phase === 'failed' ? 'failed' : finished ? 'done' : 'running'
  return {
    mode,
    status,
    agent: state.agent,
    model: state.model,
    judge_model: state.judgeModel ?? null,
    skill: state.skill?.name?.slice(0, 120) ?? null,
    base_ref: state.baseRef?.slice(0, 200) ?? null,
    phase: state.phase ?? null,
    phase_detail: state.phaseDetail?.slice(0, 300) ?? null,
    current_surface: state.current?.surface ?? null,
    current_attempt: state.current?.attempt ?? null,
    current_progress: state.current
      ? {
          steps: state.current.steps ?? 0,
          last_step: state.current.lastStep ? syncableStep(state.current.lastStep) : null,
          files: (state.current.files ?? []).slice(0, 20).map((f) => f.slice(0, 300)),
          started_at: state.current.startedAt,
          timeout_ms: state.current.timeoutMs ?? null,
        }
      : null,
    error: state.error?.slice(0, 1000) ?? null,
    branch: state.branch,
    base_sha: state.baseSha,
    cli_version: null,
    started_at: state.createdAt,
    finished_at: finished || status === 'failed' ? (state.finishedAt ?? new Date().toISOString()) : null,
    surfaces: state.surfaces.map((s) => {
      const kept = lastKept(s)
      const key = s.surface.key
      const shots: Record<string, string> = {}
      for (const vp of VIEWPORT_NAMES) {
        for (const kind of ['before', 'after', 'diff']) {
          const name = have(`${key}/${kind}-${vp}.png`)
          if (name) shots[`${kind}-${vp}`] = name
        }
      }
      return {
        surface_key: key,
        kind: s.surface.kind,
        path: s.surface.path,
        label: s.surface.label.slice(0, 300),
        status: s.status,
        note: s.note?.slice(0, 1000) ?? null,
        penalty_before: worstPenalty(s.baseline),
        penalty_after: kept ? worstPenalty(kept.after) : null,
        probe_before: probeSummary(s.baseline.desktop?.probes),
        probe_after: probeSummary(kept?.after.desktop?.probes),
        judge: s.judge?.length
          ? s.judge.map((j) => ({
              viewport: j.viewport,
              model: j.model,
              preferred: j.preferred,
              confidence: j.confidence,
              summary: j.summary.slice(0, 2000),
              better: j.better.slice(0, 20).map((c) => ({ what: c.what.slice(0, 500), why: c.why.slice(0, 500) })),
              worse: j.worse.slice(0, 20).map((c) => ({ what: c.what.slice(0, 500), why: c.why.slice(0, 500) })),
              ...(j.error ? { error: j.error.slice(0, 500) } : {}),
            }))
          : null,
        thumbs: { before: shots['before-desktop'] ?? null, after: shots['after-desktop'] ?? null, diff: shots['diff-desktop'] ?? null },
        shots,
        iterations: s.iterations.map((it) => {
          const itShots: Record<string, string> = {}
          for (const vp of VIEWPORT_NAMES) {
            for (const kind of ['after', 'diff']) {
              const name = have(`${key}/iter${it.n}-${kind}-${vp}.png`)
              if (name) itShots[`${kind}-${vp}`] = name
            }
          }
          return {
            n: it.n,
            agent: it.agent,
            model: it.model,
            duration_ms: it.durationMs,
            outcome: it.outcome,
            reason: it.reason.slice(0, 1000),
            commit_sha: it.commitSha,
            pixel_diff: it.pixelDiff,
            penalty_after: worstPenalty(it.after),
            steps: syncableSteps(it.logTail),
            shots: itShots,
          }
        }),
      }
    }),
  }
}

export interface SyncHandle {
  /** Final sync; resolves with an error message when it did not land. */
  finish(): Promise<string | null>
}

export function startSync(dir: string, cfg: SyncConfig, events: EventEmitter, log: (m: string) => void): SyncHandle {
  /** Upload name → the run-dir file last uploaded under it. */
  const uploaded = new Map<string, string>()
  let timer: NodeJS.Timeout | null = null
  let running: Promise<void> = Promise.resolve()
  let lastError: string | null = null
  let warned = false

  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'X-Mushi-Api-Key': cfg.apiKey,
    'X-Mushi-Project': cfg.projectId,
    'Content-Type': 'application/json',
  }

  async function api(method: string, path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${cfg.endpoint}/v1/admin/projects/${cfg.projectId}/ux-runs/${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | null
    if (json?.error?.code === 'INSUFFICIENT_SCOPE') {
      // An SDK ingest key (report:write only) cannot sync; a browser login mints mcp:write.
      throw new Error('this Mushi key cannot write to the console. Run `mushi login` (browser sign-in) for a key that can, then retry')
    }
    if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
    return json.data
  }

  async function uploadShots(state: RunState): Promise<void> {
    // A later kept attempt replaces after-/diff- under the same name, so compare the source file too.
    const todo = wantedShots(state).filter((w) => uploaded.get(w.name) !== w.rel)
    for (let i = 0; i < todo.length; i += UPLOAD_BATCH) {
      const batch = todo.slice(i, i + UPLOAD_BATCH)
      const data = (await api('POST', `${state.runId}/uploads`, { names: batch.map((w) => w.name) })) as {
        uploads: Array<{ name: string; signedUrl: string }>
      }
      for (const u of data.uploads) {
        const want = batch.find((w) => w.name === u.name)
        if (!want) continue
        const png = cropTop(readFileSync(join(dir, want.rel)), 2400)
        const put = await fetch(u.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png', 'x-upsert': 'true' },
          body: new Uint8Array(png),
          signal: AbortSignal.timeout(60_000),
        })
        if (!put.ok) throw new Error(`screenshot upload failed (HTTP ${put.status})`)
        uploaded.set(want.name, want.rel)
      }
    }
  }

  async function syncOnce(finished: boolean): Promise<void> {
    const state = loadState(dir)
    if (!state) return
    try {
      await api('PUT', state.runId, toSnapshot(state, false, uploaded, cfg.mode))
      await uploadShots(state)
      await api('PUT', state.runId, toSnapshot(state, finished, uploaded, cfg.mode))
      lastError = null
    } catch (err) {
      lastError = (err as Error).message
      if (!warned) {
        log(`Console sync failed (will retry): ${lastError}`)
        warned = true
      }
    }
  }

  const schedule = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      running = running.then(() => syncOnce(false))
    }, 1500)
  }
  events.on('event', (e: LoopEvent) => {
    if (e.type === 'state' || e.type === 'phase') schedule()
  })

  return {
    async finish() {
      if (timer) clearTimeout(timer)
      timer = null
      await running
      await syncOnce(true)
      return lastError
    },
  }
}
