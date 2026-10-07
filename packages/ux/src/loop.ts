// SPDX-License-Identifier: MIT
/**
 * The loop. One run:
 *
 *   worktree + dev server → discover surfaces → for each surface:
 *     baseline (desktop + mobile) → prompt packet → agent edits →
 *     recapture → pixel diff + probes → keep (commit) or roll back →
 *     re-check a sample of finished screens for collateral changes
 *
 * State is saved after every step, so `--resume <runId>` continues an
 * interrupted run. Events go to the dashboard (dashboard.ts) as they happen.
 */

import type { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { attemptLogBase, describeAgentLine, formatStep, sessionIdOf } from './agent-events.js'
import { getAgent, type AgentAdapter, type AgentName, type AgentRunOptions } from './agents.js'
import { captureSurface, openSession, type BrowserSession } from './capture.js'
import { discover } from './discover.js'
import type { AllowRule } from './guard.js'
import { checkStep, type CheckerSpec } from './checker.js'
import { pixelDiff } from './image.js'
import { judgeSurface } from './judge.js'
import { buildPacket, buildPlanPacket, findDesignFiles, MAX_PLAN_STEPS, MAX_STEP_FILES, parsePlan, PLAN_POINTER_PROMPT, POINTER_PROMPT } from './packet.js'
import { preflightAgent } from './preflight.js'
import { screenFiles } from './routes.js'
import { isFrameworkNoise, probePenalty } from './probes.js'
import { expectedHead, saveSkillFiles } from './resume.js'
import { appEnv, run, type RunResult } from './proc.js'
import type { ResolvedSkill } from './skills.js'
import {
  loadState,
  newRunId,
  runDir,
  saveState,
  savePng,
  type IterationRecord,
  type PlanStep,
  type RunPhase,
  type RunState,
  type ShotRef,
  type SurfaceState,
} from './state.js'
import { VIEWPORTS, type ProbeResult } from './types.js'
import { agentFinalMessage, assistantText, clsNeedsSecondLook, decide, explainNoEdit, steadierCls } from './verdict.js'
import {
  changedFiles,
  commitAll,
  createWorktree,
  diffText,
  detectInstallCommand,
  headSha,
  resetRunBranch,
  revertAll,
  SCRATCH_DIR,
  startDevServer,
  type DevServer,
} from './worktree.js'

/** Share of a finished screen's content that must move to count as collateral. */
const REGRESSION_CONTENT_RATIO = 0.05
/** Ignore tiny moves (a clock, a counter) below this many pixels. */
const REGRESSION_MIN_PIXELS = 200
/** The planning pass of steps mode gets at most this long. */
const PLAN_TIMEOUT_MS = 4 * 60_000
/** "Time is up" continuations of the same agent session, when a box ran out with nothing to show. */
const PLAN_NUDGE_MS = 2 * 60_000
const EDIT_NUDGE_MS = 3 * 60_000
const PLAN_NUDGE =
  'Time is up. Do not read any more files. Write .mushi-ux/PLAN.md now with the improvements you found, one per line starting with "- ", then stop.'
const EDIT_NUDGE =
  'Time is up. Do not read any more files. Make the one change you have decided on now, touching at most 3 files, then stop.'
/** How often a working attempt checks in (git status + state save). */
export const HEARTBEAT_MS = 30_000

export type LoopEvent =
  | { type: 'log'; message: string }
  | { type: 'agent'; surface: string; line: string; kind?: string }
  | { type: 'state' }
  | { type: 'phase'; phase: RunPhase; detail: string | null }

export interface LoopOptions {
  repoRoot: string
  devCommand: string
  /** null skips the install; undefined detects it from the lockfile. */
  installCommand?: string | null
  startPaths?: string[]
  agent: AgentName
  /** Overrides `agent` with a custom adapter (tests, other harnesses). */
  agentAdapter?: AgentAdapter
  model?: string | null
  iterations?: number
  maxSurfaces?: number
  agentTimeoutMs?: number
  skillText?: string | null
  /** A skill folder (SKILL.md + references); wins over skillText. */
  skill?: ResolvedSkill | null
  /** Git ref the worktree branches from. Default HEAD. */
  baseRef?: string
  allow?: AllowRule[]
  /** Selectors that are not the app's UI, on top of DEFAULT_IGNORE (ignore.ts). */
  ignore?: string[]
  profileDir?: string
  regressionSample?: number
  /** Model for the final pairwise review; null turns it off. */
  judgeModel?: string | null
  resumeRunId?: string
  /** Follow links from startPaths too. Off: only the named pages and the states they open. */
  crawl?: boolean
  /** Aborting stops the run between steps and kills a running agent. */
  signal?: AbortSignal
  /** Check the agent can read a file before anything slow starts. Default on (off for a custom adapter and the cloud agent). */
  preflight?: boolean
  /** Plan each screen into small steps first, then make one step per attempt (iterations caps the steps). */
  steps?: boolean
  /**
   * A second model that reviews each kept step and may roll it back, never
   * keep a rejected one (ADR 0021). null: measurements alone decide.
   */
  checker?: CheckerSpec | null
  /** Keep an edit with nothing visible, flagged for review (ADR 0021). Default on. */
  keepInvisible?: boolean
  /** Saved with the run for a later resume only: the login URL behind profileDir, and whether it synced. */
  loginUrl?: string | null
  sync?: boolean
  events?: EventEmitter
}

export interface LoopHandle {
  runId: string
  dir: string
  done: Promise<RunState>
}

function emit(events: EventEmitter | undefined, e: LoopEvent) {
  events?.emit('event', e)
}

/** The screenshot a finished screen should still look like. */
function referenceShot(s: SurfaceState, viewport: string): ShotRef | undefined {
  const kept = [...s.iterations].reverse().find((i) => i.outcome === 'accepted')
  return kept?.after[viewport] ?? s.baseline[viewport]
}

/**
 * Saved probes from before a noise rule existed still carry framework
 * console messages; a resumed run must not score or brief them.
 */
/** What the next attempt is told after one ran out of time without an edit. */
function timeoutNote(timeoutMs: number): string {
  const minutes = Math.round(timeoutMs / 60_000)
  return `It read for ${minutes} minutes without making any edit and was stopped. Start from the files under "Start here", pick one change, and make it within ${Math.max(1, Math.round(minutes / 3))} minutes.`
}

function scrubFrameworkNoise(state: RunState): void {
  const clean = (ref: ShotRef | undefined) => {
    if (!ref) return
    const kept = ref.probes.consoleErrors.filter((e) => !isFrameworkNoise(e))
    if (kept.length === ref.probes.consoleErrors.length) return
    ref.probes = { ...ref.probes, consoleErrors: kept }
    ref.penalty = probePenalty(ref.probes)
  }
  for (const s of state.surfaces) {
    Object.values(s.baseline).forEach(clean)
    for (const it of s.iterations) Object.values(it.after).forEach(clean)
  }
}

/**
 * Pure: why mapping found no screen, from the "skipped" lines and the dev
 * server's first error. Every page failing the same way (all HTTP 500) points
 * at the app, not the pages, so that case leads with the dev server.
 * @internal Exported for tests only.
 */
export function noScreensMessage(skipped: string[], devError: string | null): string {
  const reasons = skipped.map((s) => s.replace(/^\S+:\s*/, ''))
  const unique = [...new Set(reasons)]
  const lines: string[] = []
  if (skipped.length && unique.length === 1 && /HTTP 5\d\d/.test(unique[0])) {
    lines.push(`No screen to work on: every page returned ${unique[0]}, so the app's dev server is failing, not the pages.`)
  } else if (skipped.length) {
    lines.push(`No screen to work on: all ${new Set(skipped.map((s) => s.split(':')[0])).size} page(s) were skipped (${unique.slice(0, 3).join('; ')}).`)
  } else {
    lines.push('No screen to work on: mapping found no page. Name the pages to work on, or check that the home page loads.')
  }
  if (devError) lines.push(`The dev server said: ${devError}`)
  lines.push('Fix the app or the dev command (for example a different bundler flag), then start a new run. The full output is in run.log.')
  return lines.join('\n')
}

/** A commit subject's summary stops here, at a whole word. */
const SUMMARY_MAX = 72
const DANGLING = /[\s,]+(?:a|an|and|as|at|between|by|for|from|in|into|is|of|on|or|so|that|the|to|while|with)$/i

/**
 * Pure: the commit message for a kept attempt. Host apps lint commits as
 * conventional commits (glot.it allows only the standard types) and turn the
 * subjects into their in-app changelog, so the subject is `fix(ux):` and a
 * plain sentence that ends on a whole word, without file names; the screen,
 * the step and the measurements go in the body.
 * @internal Exported for tests only.
 */
export function commitMessage(path: string, screen: string, step: string | null, reason: string): string {
  const name = screen.split(/\s+[—|–]\s+/)[0].trim() || path
  const summary = (step ? stepSummary(step) : '') || `improve the ${name} screen`
  const body = [step ? `${name} (${path}): ${step}` : `${name} (${path})`, reason]
  return [`fix(ux): ${lowerFirst(summary)}`, ...body.map((p) => wrapAt(p, BODY_WIDTH))].join('\n\n')
}

/** Conventional-commit lint rejects body lines over 100 characters. */
const BODY_WIDTH = 100

function wrapAt(text: string, width: number): string {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && [...`${line} ${word}`].length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.join('\n')
}

/** "Fix the caption" → "fix the caption"; "CTA buttons" and quoted text stay as they are. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

const isPath = (code: string) => code.includes('/') || /\.[a-z]{2,4}$/i.test(code)

function stepSummary(step: string): string {
  // Plans lead with a plain summary before a colon ("Fix the caption contrast: in `x.tsx`, ...").
  const lead = step.match(/^([^:`]{8,90}):\s/)?.[1]
  let s = lead ?? step.replace(/^(?:In\s+)?`[^`]+`(?:\s*\([^)]*\))?\s*[,:]?\s*/i, '').split(/(?<=\.)\s|;\s/)[0]
  s = s
    .replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (inner.includes('`') ? '' : m))
    // A file named after "in" or "from" goes with its preposition.
    .replace(/\s+(?:in|from|of|on)\s+`([^`]*)`/gi, (m, inner: string) => (isPath(inner) ? '' : m))
    // Code spans pair left to right: paths go, other code stays as words.
    .replace(/`([^`]*)`/g, (_m, inner: string) => (isPath(inner) ? ' ' : inner.replace(/["']/g, '')))
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (s.length > SUMMARY_MAX) {
    const cut = s.lastIndexOf(' ', SUMMARY_MAX)
    s = s.slice(0, cut > 0 ? cut : SUMMARY_MAX)
    const open = s.lastIndexOf('(')
    if (open > s.lastIndexOf(')')) s = s.slice(0, open)
    // A cut sentence should not end on a word that needs the next one.
    while (DANGLING.test(s)) s = s.replace(DANGLING, '')
  }
  s = s.replace(/^[\s,;:.—–-]+|[\s,;:.—–-]+$/g, '')
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

export function startLoop(opts: LoopOptions): LoopHandle {
  const runId = opts.resumeRunId ?? newRunId()
  const dir = runDir(opts.repoRoot, runId)
  const done = runLoop(opts, runId, dir)
  return { runId, dir, done }
}

async function runLoop(opts: LoopOptions, runId: string, dir: string): Promise<RunState> {
  const events = opts.events
  // Also kept in run.log, so a past or failed run still shows what happened.
  const log = (message: string) => {
    emit(events, { type: 'log', message })
    try {
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, 'run.log'), `${new Date().toISOString().slice(11, 19)} ${message}\n`)
    } catch {
      /* the log is a convenience; the run goes on without it */
    }
  }
  const agent = opts.agentAdapter ?? getAgent(opts.agent)
  const iterations = opts.iterations ?? 2
  const timeoutMs = opts.agentTimeoutMs ?? 10 * 60_000

  const state: RunState = loadState(dir) ?? {
    version: 1,
    runId,
    baseUrl: '',
    createdAt: new Date().toISOString(),
    updatedAt: '',
    agent: agent.name,
    model: opts.model ?? null,
    skill: opts.skill ? { name: opts.skill.name, source: opts.skill.source } : null,
    baseRef: opts.baseRef ?? 'HEAD',
    phase: 'starting',
    worktree: null,
    branch: null,
    baseSha: null,
    surfaces: [],
  }
  scrubFrameworkNoise(state)
  const resuming = Boolean(state.updatedAt)
  if (resuming) {
    // A resumed run starts clean: the old stop or error is history, kept in run.log.
    state.error = null
    state.finishedAt = null
    state.stopped = false
    state.current = null
  }
  // Everything a later resume needs, so it takes only the run id.
  if (!state.options) {
    state.options = {
      agent: String(opts.agent),
      model: opts.model ?? null,
      devCommand: opts.devCommand,
      installCommand: opts.installCommand,
      startPaths: opts.startPaths,
      crawl: opts.crawl,
      iterations,
      checker: opts.checker ?? null,
      keepInvisible: opts.keepInvisible !== false,
      maxSurfaces: opts.maxSurfaces ?? 10,
      agentTimeoutMs: timeoutMs,
      ignore: opts.ignore,
      allow: opts.allow,
      judgeModel: opts.judgeModel ?? null,
      loginUrl: opts.loginUrl ?? null,
      sync: opts.sync,
      steps: opts.steps,
    }
  }
  if (opts.skill) {
    state.skill = { name: opts.skill.name, source: opts.skill.source }
    try {
      saveSkillFiles(dir, opts.skill)
    } catch {
      // Only a later resume needs the copy; it says so if it is missing.
    }
  }
  const persist = () => {
    saveState(dir, state)
    emit(events, { type: 'state' })
  }
  const phase = (p: RunPhase, detail: string | null = null) => {
    state.phase = p
    state.phaseDetail = detail
    emit(events, { type: 'phase', phase: p, detail })
    persist()
  }
  const skillText = opts.skill?.text ?? opts.skillText ?? null

  // The run checks in every 30 s in every phase (a save stamps updatedAt), so
  // the studio and the console can tell a long install from a dead process.
  const beat = setInterval(() => {
    try {
      persist()
    } catch {
      // The next beat, or the next real state change, saves again.
    }
  }, HEARTBEAT_MS)
  try {
    return await runSteps()
  } catch (err) {
    const stopped = Boolean(opts.signal?.aborted)
    state.stopped = stopped
    state.error = stopped ? 'Stopped from the studio.' : (err as Error).message.slice(0, 2000)
    // A stop can land mid-edit: leave the branch at its last kept commit.
    if (stopped && state.worktree) await revertAll(state.worktree).catch(() => undefined)
    state.current = null
    state.finishedAt = new Date().toISOString()
    phase('failed', state.error.split('\n')[0].slice(0, 200))
    throw err
  } finally {
    clearInterval(beat)
  }

  async function runSteps(): Promise<RunState> {
    if (opts.preflight !== false && !opts.agentAdapter && agent.name !== 'cursor-cloud') {
      log(`Checking that ${agent.name} can read files…`)
      phase('starting', 'Checking the agent can read files')
      const problem = await preflightAgent(agent, { model: opts.model, signal: opts.signal })
      if (opts.signal?.aborted) throw new Error('Stopped.')
      if (problem) throw new Error(problem)
      log('Agent check passed.')
    }
    if (!state.worktree) {
      log('Creating a worktree for the agent…')
      phase('worktree', `from ${state.baseRef ?? 'HEAD'}`)
      const wt = await createWorktree(opts.repoRoot, runId, state.baseRef ?? 'HEAD')
      state.worktree = wt.path
      state.branch = wt.branch
      state.baseSha = wt.baseSha
      persist()
    } else if (!existsSync(state.worktree)) {
      throw new Error(`The run's worktree ${state.worktree} is gone, so this run cannot continue. Start a new run.`)
    }
    // Runs from before the flag existed: one that got as far as mapping was installed.
    if (state.installed === undefined && state.surfaces.length > 0) state.installed = true
    if (!state.installed) {
      const install = opts.installCommand === undefined ? detectInstallCommand(state.worktree) : opts.installCommand
      if (install) {
        log(`Installing dependencies: ${install}`)
        phase('install', install)
        const res = await run(install, [], { cwd: state.worktree, shell: true, timeoutMs: 15 * 60_000, env: appEnv() })
        if (res.exitCode !== 0) throw new Error(`Install failed in the worktree:\n${res.tail}`)
      }
      state.installed = true
      persist()
    }
    const wtPath = state.worktree
    if (resuming) await restoreWorktree(wtPath)
    const designFiles = findDesignFiles(wtPath)

    log(`Starting the dev server in the worktree: ${opts.devCommand}`)
    phase('dev-server', opts.devCommand)
    // The dev server's first error line names the cause when every page fails.
    let devError: string | null = null
    const server: DevServer = await startDevServer(wtPath, opts.devCommand, {
      path: opts.startPaths?.[0],
      onLine: (l) => {
        log(`[dev] ${l.slice(0, 200)}`)
        if (!devError && /\b(error|module not found)\b/i.test(l)) devError = l.trim().slice(0, 300)
      },
    })
    state.baseUrl = server.url
    persist()

    const session: BrowserSession = await openSession({ profileDir: opts.profileDir, allow: opts.allow, ignore: opts.ignore })
    try {
      if (state.surfaces.length === 0) {
        log('Mapping screens…')
        phase('mapping', null)
        // Ask for every named page at once first: the dev server compiles them
        // together instead of one per visit (mapping took 10 min for 8 pages
        // on glot.it's webpack dev server, 2026-10-07). Plain GETs only.
        if (opts.startPaths?.length) {
          const t0 = Date.now()
          await Promise.all(
            // Follow redirects: /chat answers 308 → /chat/ at once, and only the target compiles.
            opts.startPaths.map((p) => fetch(new URL(p, server.url), { signal: AbortSignal.timeout(180_000) }).then((r) => r.arrayBuffer()).catch(() => null)),
          )
          log(`warmed ${opts.startPaths.length} page(s) in ${Math.round((Date.now() - t0) / 1000)} s`)
        }
        const skipped: string[] = []
        const found = await discover(session, {
          baseUrl: server.url,
          startPaths: opts.startPaths,
          onlyStartPaths: Boolean(opts.startPaths?.length) && !opts.crawl,
          sourceDir: wtPath,
          signal: opts.signal,
          onProgress: (m) => {
            log(`found ${m}`)
            if (m.startsWith('skipped ')) skipped.push(m.slice('skipped '.length))
            // The studio shows the latest mapping line under the phase.
            phase('mapping', m.slice(0, 200))
          },
        })
        // Nothing to work on is a failed run, not a finished one: say why.
        if (found.length === 0) throw new Error(noScreensMessage(skipped, devError))
        state.surfaces = found.slice(0, opts.maxSurfaces ?? 10).map((surface) => ({
          surface,
          status: 'pending',
          note: null,
          baseline: {},
          iterations: [],
        }))
        log(`${state.surfaces.length} screen(s) on the burndown (${found.length} found).`)
        persist()
      }

      // Captures start from a visited app, the same for every screen (capture.ts warmUp).
      log('Opening every screen once, so each capture starts from a loaded app…')
      await session.warmUp(server.url, [...new Set(state.surfaces.map((x) => x.surface.path))])
      phase('working', null)
      for (const s of state.surfaces) {
        if (opts.signal?.aborted) throw new Error('Stopped.')
        if (!['pending', 'baseline', 'iterating'].includes(s.status)) continue
        if (s.status === 'iterating') await revertAll(wtPath) // interrupted mid-edit
        await processSurface(s)
      }
      state.current = null
      if (opts.judgeModel) {
        phase('reviewing', opts.judgeModel)
        await runJudge(opts.judgeModel)
      }
      state.finishedAt = new Date().toISOString()
      phase('done', null)
      log(`Done. Branch ${state.branch} holds every kept change; open a draft PR from it when you are happy.`)
      return state
    } finally {
      await session.close()
      server.stop()
      persist()
    }

    /**
     * Before a resumed run goes on: the branch back on its last saved kept
     * commit (a crash can land between an attempt's commit and the save), and
     * a half-finished attempt's edits thrown away. That attempt runs again.
     */
    async function restoreWorktree(wt: string): Promise<void> {
      const want = expectedHead(state)
      const head = await headSha(wt)
      if (want && head !== want) {
        try {
          await resetRunBranch(wt, want)
        } catch {
          throw new Error(
            `The run branch ${state.branch} no longer holds its last kept commit ${want.slice(0, 8)}: it was changed outside the run. Start a new run.`,
          )
        }
        log(`The run branch was ahead of its last saved attempt (${head.slice(0, 8)}); moved it back to ${want.slice(0, 8)}. That attempt runs again.`)
      }
      await revertAll(wt)
      log('Resumed: unfinished edits cleared; carrying on from the first unfinished screen.')
    }

    /**
     * Run the agent; if its time box runs out with nothing to show (no plan,
     * no edit) and it can resume its session, continue that same session once
     * with "time is up, write it now" and a short extra box. Grok 4.7 xhigh
     * read for whole attempts and ignored in-prompt deadlines (glot.it,
     * 2026-10-06); the continuation keeps everything it read.
     */
    async function runWithNudge(
      runOpts: AgentRunOptions & { nudge: { prompt: string; ms: number; needed: () => Promise<boolean> } },
    ): Promise<RunResult> {
      const { nudge, ...base } = runOpts
      const first = await agent.run(base)
      if (!first.timedOut || !agent.canResume || opts.signal?.aborted) return first
      const session = sessionIdOf(first.stdout)
      if (!session || !(await nudge.needed())) return first
      log(`  time is up: asking the agent to finish now (${Math.round(nudge.ms / 60_000)} more min, same session)`)
      const second = await agent.run({ ...base, prompt: nudge.prompt, timeoutMs: nudge.ms, resumeSession: session })
      return {
        exitCode: second.exitCode,
        timedOut: second.timedOut,
        durationMs: first.durationMs + second.durationMs,
        tail: second.tail,
        stdout: `${first.stdout}\n${second.stdout}`,
      }
    }

    /** Fresh scratch dir for one agent run: the skill, and the screenshots to start from. */
    function prepareScratch(current: Record<string, ShotRef>): { shots: Record<string, string>; probes: Record<string, ProbeResult> } {
      const scratch = join(wtPath, SCRATCH_DIR)
      rmSync(scratch, { recursive: true, force: true })
      mkdirSync(scratch, { recursive: true })
      if (opts.skill) {
        for (const [rel, buf] of Object.entries(opts.skill.files)) {
          const target = join(scratch, 'skill', ...rel.split('/'))
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, buf)
        }
      }
      const shots: Record<string, string> = {}
      for (const [vp, ref] of Object.entries(current)) {
        writeFileSync(join(scratch, `${vp}.png`), readFileSync(join(dir, ref.png)))
        shots[vp] = `${SCRATCH_DIR}/${vp}.png`
      }
      return { shots, probes: Object.fromEntries(Object.entries(current).map(([vp, r]) => [vp, r.probes])) }
    }

    /**
     * Steps mode: one short agent run that lists small, separate improvements
     * for the screen and edits nothing (anything it does edit is thrown
     * away). Null when it produced no usable list: the screen then gets
     * whole-screen attempts instead.
     */
    async function planSurface(s: SurfaceState, current: Record<string, ShotRef>, entryFiles: string[]): Promise<{ steps: PlanStep[]; session?: string | null } | null> {
      const planMs = Math.min(timeoutMs, PLAN_TIMEOUT_MS)
      const { shots, probes } = prepareScratch(current)
      const maxSteps = Math.min(MAX_PLAN_STEPS, iterations)
      writeFileSync(
        join(wtPath, SCRATCH_DIR, 'PROMPT.md'),
        buildPlanPacket({ surface: s.surface, shots, probes, designFiles, skillText, skillDir: `${SCRATCH_DIR}/skill`, timeBudgetMin: Math.round(planMs / 60_000), entryFiles }, maxSteps),
      )
      s.status = 'iterating'
      const startedAt = new Date().toISOString()
      state.current = { surface: s.surface.key, attempt: 1, startedAt, timeoutMs: planMs, steps: 0, lastStep: null, files: [], heartbeatAt: startedAt }
      phase('working', `${s.surface.label}, planning small steps`)
      log(`  planning ${s.surface.label} in small steps…`)
      // Its steps go to agent/<screen>-plan.steps.log, so a failed plan can be read.
      const planLog = join(dir, 'agent', `${attemptLogBase(s.surface.key, 0).slice(0, -2)}-plan.steps.log`)
      try {
        mkdirSync(dirname(planLog), { recursive: true })
        writeFileSync(planLog, '')
      } catch {
        // The log is for reading later only.
      }
      const planFile = join(wtPath, SCRATCH_DIR, 'PLAN.md')
      const res = await runWithNudge({
        cwd: wtPath,
        prompt: PLAN_POINTER_PROMPT,
        model: opts.model,
        timeoutMs: planMs,
        signal: opts.signal,
        nudge: {
          prompt: PLAN_NUDGE,
          ms: PLAN_NUDGE_MS,
          needed: async () => !existsSync(planFile) || parsePlan(readFileSync(planFile, 'utf8')).length === 0,
        },
        onLine: (line) => {
          for (const step of describeAgentLine(line, wtPath)) {
            const text = formatStep(step)
            try {
              appendFileSync(planLog, `${text}\n`)
            } catch {
              // See above.
            }
            emit(events, { type: 'agent', surface: s.surface.key, line: text, kind: step.kind })
          }
        },
      })
      if (opts.signal?.aborted) throw new Error('Stopped.')
      // The file first (written early, refined later); then the reply; then anything the agent said before it was stopped.
      const fromFile = existsSync(planFile) ? readFileSync(planFile, 'utf8') : ''
      const text = parsePlan(fromFile).length ? fromFile : (agentFinalMessage(res.stdout) ?? assistantText(res.stdout))
      await revertAll(wtPath) // planning never edits
      const items = parsePlan(text, maxSteps)
      if (items.length === 0) {
        log(`  no plan came back${res.timedOut ? ' (the agent ran out of time)' : ''}; working on the whole screen instead.`)
        return null
      }
      log(`  plan: ${items.map((t, i) => `${i + 1}. ${t}`).join('  ')}`)
      return { steps: items.map((t) => ({ text: t, status: 'pending' as const })), session: agent.canResume ? sessionIdOf(res.stdout) : null }
    }

    /** Record which plan step an attempt worked on, and how it went. */
    function markStep(
      step: PlanStep | null,
      info: { index: number; total: number } | null,
      record: IterationRecord,
      status: PlanStep['status'],
    ): void {
      if (!step || !info) return
      step.status = status
      step.attempt = record.n
      record.step = step.text
      record.reason = `Step ${info.index}/${info.total}: ${record.reason}`
      step.reason = record.reason
    }

    async function capture(s: SurfaceState): Promise<Record<string, { png: Buffer; probes: ProbeResult }>> {
      // Each capture has its own clean browser context, so the viewports run side by side.
      const shots = await Promise.all(VIEWPORTS.map((vp) => captureSurface(session, state.baseUrl, s.surface, vp)))
      return Object.fromEntries(VIEWPORTS.map((vp, i) => [vp.name, shots[i]]))
    }

    function shotRefs(s: SurfaceState, label: string, shots: Record<string, { png: Buffer; probes: ProbeResult }>) {
      const refs: Record<string, ShotRef> = {}
      for (const [vp, shot] of Object.entries(shots)) {
        refs[vp] = { png: savePng(dir, `shots/${s.surface.key}/${label}-${vp}.png`, shot.png), probes: shot.probes, penalty: probePenalty(shot.probes) }
      }
      return refs
    }

    async function processSurface(s: SurfaceState): Promise<void> {
      log(`▶ ${s.surface.label}`)
      if (Object.keys(s.baseline).length === 0) {
        try {
          s.baseline = shotRefs(s, 'baseline', await capture(s))
        } catch (err) {
          s.status = 'blocked'
          s.note = `Could not capture the screen: ${(err as Error).message.slice(0, 200)}`
          persist()
          return
        }
      }
      s.status = 'baseline'
      persist()

      // A resumed screen carries on from what it already has: compare against
      // the last kept version, tell the agent why its last try was rolled
      // back, and stop where a finished attempt would have stopped.
      const entryFiles = screenFiles(wtPath, s.surface.path)
      const lastKept = [...s.iterations].reverse().find((i) => i.outcome === 'accepted')
      let current = lastKept ? lastKept.after : s.baseline
      const last = s.iterations[s.iterations.length - 1]
      let previousRejection: string | null =
        last?.outcome === 'rejected' ? last.reason : last?.outcome === 'agent_failed' && last.timedOut ? timeoutNote(timeoutMs) : null
      // Steps mode: plan once (no edits), then one plan step per attempt.
      // Plan again when planning failed and nothing has come of the screen since (only failed attempts).
      if (opts.steps && (s.plan === undefined || (s.plan === null && s.iterations.every((i) => i.outcome === 'agent_failed')))) {
        s.plan = await planSurface(s, current, entryFiles)
        persist()
      }
      const plan = opts.steps && s.plan?.steps.length ? s.plan : null
      // The session each step resumes, so the agent keeps the files it already read
      // (each fresh step re-read 5-19 files and ran 3-23 searches, glot.it 2026-10-07).
      // Only while the files match its memory: after the plan or a kept step.
      let carrySession: string | null = plan && agent.canResume && !s.iterations.some((i) => i.outcome !== 'accepted') ? plan.session ?? null : null
      const pending = plan ? plan.steps.filter((p) => p.status === 'pending').length : 0
      const settled = last?.outcome === 'no_change' || (last?.outcome === 'agent_failed' && !last.timedOut)
      const first = s.iterations.length + 1
      const lastAttempt = plan ? first + pending - 1 : settled ? 0 : iterations
      for (let n = first; n <= lastAttempt; n++) {
        const step = plan?.steps.find((p) => p.status === 'pending') ?? null
        const stepInfo = step && plan
          ? { text: step.text, index: plan.steps.indexOf(step) + 1, total: plan.steps.length, done: plan.steps.filter((p) => p.status === 'done').map((p) => p.text) }
          : null
        const { shots, probes } = prepareScratch(current)
        writeFileSync(
          join(wtPath, SCRATCH_DIR, 'PROMPT.md'),
          buildPacket({ surface: s.surface, iteration: n, shots, probes, designFiles, skillText, skillDir: `${SCRATCH_DIR}/skill`, previousRejection, timeBudgetMin: Math.round(timeoutMs / 60_000), entryFiles, step: stepInfo }),
        )
        s.status = 'iterating'
        const startedAt = new Date().toISOString()
        const live = { surface: s.surface.key, attempt: n, startedAt, timeoutMs, steps: 0, lastStep: null as string | null, files: [] as string[], heartbeatAt: startedAt }
        state.current = live
        phase('working', stepInfo ? `${s.surface.label}, step ${stepInfo.index} of ${stepInfo.total}` : `${s.surface.label}, attempt ${n} of ${iterations}`)

        // Readable steps for the live view and the saved log tail.
        const steps: string[] = []
        const logDir = join(dir, 'agent')
        const logBase = join(logDir, attemptLogBase(s.surface.key, n))
        try {
          mkdirSync(logDir, { recursive: true })
          writeFileSync(`${logBase}.steps.log`, '')
        } catch {
          // Only the reload view of the studio needs the file; the run goes on without it.
        }
        // Check in while the agent works, so a viewer can tell a slow attempt from a dead run.
        const heartbeat = setInterval(() => {
          void changedFiles(wtPath)
            .then((f) => {
              if (state.current !== live) return
              live.files = f.slice(0, 50)
              live.heartbeatAt = new Date().toISOString()
              persist()
            })
            .catch(() => undefined)
        }, HEARTBEAT_MS)
        let res
        try {
          res = await runWithNudge({
            cwd: wtPath,
            prompt: carrySession ? `${POINTER_PROMPT}\n\nThis continues your session for this screen: you have already read its files. Do not read them again unless you need a file you have not seen. Make this step's change now.` : POINTER_PROMPT,
            model: opts.model,
            timeoutMs,
            signal: opts.signal,
            resumeSession: carrySession ?? undefined,
            nudge: {
              prompt: EDIT_NUDGE,
              ms: EDIT_NUDGE_MS,
              needed: async () => (await changedFiles(wtPath).catch(() => [])).length === 0,
            },
            onLine: (line) => {
              for (const step of describeAgentLine(line, wtPath)) {
                const text = formatStep(step)
                steps.push(text)
                if (steps.length > 400) steps.splice(0, 200)
                live.steps++
                live.lastStep = text
                try {
                  appendFileSync(`${logBase}.steps.log`, `${text}\n`)
                } catch {
                  // See above: never fail an attempt over the step file.
                }
                emit(events, { type: 'agent', surface: s.surface.key, line: text, kind: step.kind })
              }
            },
          })
        } finally {
          clearInterval(heartbeat)
        }
        try {
          mkdirSync(logDir, { recursive: true })
          writeFileSync(`${logBase}.log`, res.stdout)
        } catch {
          // The raw log is for debugging only; never fail an attempt over it.
        }
        if (opts.signal?.aborted) throw new Error('Stopped.')
        const files = await changedFiles(wtPath)
        const record: IterationRecord = {
          n,
          agent: agent.name,
          model: opts.model ?? null,
          startedAt,
          durationMs: res.durationMs,
          outcome: 'no_change',
          reason: '',
          commitSha: null,
          pixelDiff: {},
          after: {},
          diffPng: {},
          logTail: (steps.length ? steps.join('\n') : res.tail).slice(-2000),
        }

        if ((res.exitCode !== 0 || res.timedOut) && files.length === 0) {
          record.outcome = 'agent_failed'
          record.timedOut = res.timedOut
          const minutes = Math.round(timeoutMs / 60_000)
          record.reason = res.timedOut
            ? `The agent ran out of time (${minutes} min) after ${steps.length} steps without editing anything.`
            : `The agent exited with code ${res.exitCode}.`
          markStep(step, stepInfo, record, 'failed')
          s.iterations.push(record)
          persist()
          log(`  attempt ${n}: ${record.reason}`)
          // A crash or a blocked agent will fail again: stop. Running out of
          // time is worth one more try with a firmer brief (glot.it /practice,
          // 2026-10-06: 15 minutes of reading, no edit).
          if (!res.timedOut) break
          previousRejection = timeoutNote(timeoutMs)
          continue
        }

        let afterShots: Record<string, { png: Buffer; probes: ProbeResult }> | null = null
        if (files.length > 0) {
          await new Promise((r) => setTimeout(r, 2000)) // let the dev server rebuild
          afterShots = await capture(s).catch(() => null)
          const beforeProbes = Object.fromEntries(Object.entries(current).map(([vp, r]) => [vp, r.probes]))
          const afterProbes = afterShots ? Object.fromEntries(Object.entries(afterShots).map(([vp, r]) => [vp, r.probes])) : null
          if (afterShots && afterProbes && clsNeedsSecondLook(beforeProbes, afterProbes)) {
            // One more shot once the reload has settled; keep the lower layout shift.
            await new Promise((r) => setTimeout(r, 2000))
            const again = await capture(s).catch(() => null)
            if (again) {
              const steady = steadierCls(afterProbes, Object.fromEntries(Object.entries(again).map(([vp, r]) => [vp, r.probes])))
              for (const vp of Object.keys(afterShots)) afterShots[vp] = { ...afterShots[vp]!, probes: steady[vp]! }
            }
          }
        }
        const ratios: Record<string, number> = {}
        if (afterShots) {
          record.after = shotRefs(s, `iter${n}`, afterShots)
          for (const [vp, shot] of Object.entries(afterShots)) {
            const before = readFileSync(join(dir, current[vp].png))
            const d = pixelDiff(before, shot.png)
            ratios[vp] = Math.round(d.ratio * 10_000) / 10_000
            record.diffPng[vp] = savePng(dir, `shots/${s.surface.key}/iter${n}-${vp}-diff.png`, d.diffPng)
            record.changes = { ...record.changes, [vp]: { width: d.width, height: d.height, boxes: d.regions } }
          }
        }
        record.pixelDiff = ratios
        const verdict = decide({
          filesChanged: files.length,
          before: Object.fromEntries(Object.entries(current).map(([vp, r]) => [vp, r.probes])),
          after: afterShots ? Object.fromEntries(Object.entries(afterShots).map(([vp, r]) => [vp, r.probes])) : null,
          pixelRatios: ratios,
          keepInvisible: opts.keepInvisible !== false,
        })
        record.outcome = verdict.outcome
        record.reason = verdict.reason
        // Only an attempt with no edits is explained by the agent's words; one whose
        // edits changed nothing visible keeps that reason (it said "made no edits"
        // for a real edit to flow-layout.ts on glot.it, 2026-10-07).
        if (verdict.outcome === 'no_change' && files.length === 0) {
          const why = explainNoEdit(agentFinalMessage(res.stdout))
          record.outcome = why.outcome
          record.reason = why.reason
        }
        record.timedOut = res.timedOut || undefined
        // A step is one small change: a sprawling edit is rolled back as too big.
        if (step && record.outcome === 'accepted' && files.length > MAX_STEP_FILES) {
          record.outcome = 'rejected'
          record.reason = `Too big for one step: ${files.length} files changed (at most ${MAX_STEP_FILES}). Make a smaller change.`
        }
        if (record.outcome === 'accepted') record.needsReview = verdict.needsReview || undefined
        // The checker only ever vetoes: it reviews what the measurements kept (ADR 0021).
        if (record.outcome === 'accepted' && opts.checker) {
          log(`  checking with ${opts.checker.model}…`)
          phase('working', `${s.surface.label}: ${opts.checker.model} reviews the change`)
          const vp = afterShots?.mobile ? 'mobile' : Object.keys(afterShots ?? {})[0]
          const visible = !record.needsReview && vp && afterShots?.[vp]
          const review = await checkStep({
            dir,
            name: `${s.surface.key}-iter${n}`,
            screen: s.surface.label,
            step: step?.text ?? 'Improve this screen for the person using it.',
            visual: visible ? { before: readFileSync(join(dir, current[vp].png)), after: afterShots![vp]!.png, regions: record.changes?.[vp]?.boxes ?? [] } : null,
            diff: await diffText(wtPath).catch(() => ''),
            repoDir: wtPath,
            spec: opts.checker,
            signal: opts.signal,
          })
          record.checker = review
          if (review.verdict === 'revert') {
            record.outcome = 'rejected'
            record.reason = `Rolled back by ${review.model}: ${review.summary}`.slice(0, 600)
          } else if (review.error) {
            log(`  ${review.model} review failed: ${review.error}`)
            record.reason += ` The ${review.model} review could not run (${review.error.slice(0, 160)}), so the measurements decided.`
          } else {
            record.reason += ` ${review.model}: ${review.verdict === 'keep' ? 'agrees' : 'unsure, kept on the measurements'}.`
          }
        }
        markStep(step, stepInfo, record, record.outcome === 'accepted' ? 'done' : record.outcome === 'no_change' ? 'skipped' : 'failed')
        log(`  attempt ${n}: ${record.reason}`)

        if (record.outcome === 'accepted') {
          record.commitSha = await commitAll(wtPath, commitMessage(s.surface.path, s.surface.label, step?.text ?? null, record.reason))
          current = record.after
          s.status = 'accepted'
          s.iterations.push(record)
          persist()
          carrySession = agent.canResume ? sessionIdOf(res.stdout) ?? carrySession : null
          continue
        }
        await revertAll(wtPath)
        s.iterations.push(record)
        persist()
        // Whole-screen mode stops at "no change"; steps mode moves to the next
        // step. A blocked agent (it said so) stops either way.
        if (verdict.outcome === 'no_change' && (!step || record.outcome === 'agent_failed')) break
        previousRejection = record.outcome === 'rejected' ? record.reason : null
        // A rolled-back edit is gone from the files but not from the session's memory: start fresh.
        carrySession = null
      }

      // Decided from the records: a later no-change attempt must not hide a kept one.
      const kept = s.iterations.filter((i) => i.outcome === 'accepted')
      // Once per screen, not after every kept step: the screens it might have moved
      // are re-shot once for all of this screen's steps.
      if (kept.length > 0) await checkRegressions(s)
      if (kept.length > 0) {
        s.status = 'accepted'
        s.note = kept[kept.length - 1].reason
      } else {
        const rejected = s.iterations.some((i) => i.outcome === 'rejected' || i.outcome === 'capture_failed')
        // Only failed attempts: the agent never finished, which is not "no change needed".
        const neverFinished = s.iterations.length > 0 && s.iterations.every((i) => i.outcome === 'agent_failed')
        s.status = rejected ? 'reverted' : neverFinished ? 'blocked' : 'skipped'
        s.note = s.iterations[s.iterations.length - 1]?.reason ?? null
      }
      rmSync(join(wtPath, SCRATCH_DIR), { recursive: true, force: true })
      persist()
    }

    /** Second-opinion review of every kept change. Advisory: it never reverts anything. */
    async function runJudge(model: string): Promise<void> {
      state.judgeModel = model
      const changed = state.surfaces.filter((x) => x.iterations.some((i) => i.outcome === 'accepted'))
      if (changed.length === 0) return
      log(`Reviewing ${changed.length} changed screen(s) with ${model}…`)
      for (const s of changed) {
        if (s.judge?.length) continue
        const verdicts = []
        for (const vp of VIEWPORTS) {
          const v = await judgeSurface(s, vp.name, { dir, repoRoot: wtPath, designFiles, model })
          if (v) verdicts.push(v)
        }
        s.judge = verdicts
        const errors = verdicts.filter((v) => v.error)
        if (errors.length) log(`  review of ${s.surface.label} failed: ${errors[0].error}`)
        const prefersBefore = verdicts.filter((v) => !v.error && v.preferred === 'before' && v.confidence !== 'low')
        if (prefersBefore.length) {
          log(`  ⚠ reviewer prefers the original ${s.surface.label} (${prefersBefore.map((v) => v.viewport).join(', ')}) — check it before merging`)
        }
        persist()
      }
    }

    /** After a kept change, re-shoot a sample of finished screens and flag any that moved. */
    async function checkRegressions(changed: SurfaceState): Promise<void> {
      const finished = state.surfaces
        .filter((x) => x !== changed && ['accepted', 'reverted', 'skipped'].includes(x.status))
        .slice(-(opts.regressionSample ?? 5))
      const desktop = VIEWPORTS[0]
      for (const other of finished) {
        const ref = referenceShot(other, desktop.name)
        if (!ref) continue
        const refPng = readFileSync(join(dir, ref.png))
        const moved = (png: Buffer) => {
          const diff = pixelDiff(refPng, png)
          return diff.contentRatio > REGRESSION_CONTENT_RATIO && diff.changedPixels > REGRESSION_MIN_PIXELS ? diff : null
        }
        let now = await captureSurface(session, state.baseUrl, other.surface, desktop).catch(() => null)
        if (!now || !moved(now.png)) continue
        // Confirm with a second shot: right after an edit the dev server
        // recompiles, and one shot of a half-loaded page is not a regression
        // (glot.it /words caught as skeletons after Account was kept, 2026-10-06).
        await new Promise((r) => setTimeout(r, 3000))
        now = await captureSurface(session, state.baseUrl, other.surface, desktop).catch(() => null)
        const d = now ? moved(now.png) : null
        if (now && d) {
          const pct = (d.contentRatio * 100).toFixed(0)
          other.status = 'regressed'
          other.note = `${pct}% of this screen changed after "${changed.surface.label}" was kept. Check whether a shared component or token moved.`
          savePng(dir, `shots/${other.surface.key}/regressed-${desktop.name}.png`, now.png)
          log(`  ⚠ ${other.surface.label}: ${pct}% of the screen moved — marked regressed`)
        }
      }
      persist()
    }
  }
}
