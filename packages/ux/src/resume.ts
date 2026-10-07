// SPDX-License-Identifier: MIT
/**
 * Resuming a run that stopped for any reason: the studio or terminal was
 * closed, the machine slept, or the process was killed (on 2026-10-06 the
 * host ran low on memory and took the studio, and its run, with it).
 *
 * A resume needs only the run id. The settings and the skill's files were
 * saved when the run started; the loop then puts the worktree back on the
 * last kept commit, throws away a half-finished attempt and carries on from
 * the first unfinished screen.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { ResolvedSkill } from './skills.js'
import { loadState, runDir, type RunState, type SavedRunOptions } from './state.js'

/** A live run saves at least every 30 s; past this it is not running anywhere. */
const ALIVE_WITHIN_MS = 90_000

/** Keep the skill beside the run state so a resume does not depend on GitHub or a checkout. */
export function saveSkillFiles(dir: string, skill: ResolvedSkill): void {
  const root = join(dir, 'skill')
  rmSync(root, { recursive: true, force: true })
  for (const [rel, buf] of Object.entries(skill.files)) {
    const target = join(root, ...rel.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, buf)
  }
}

function loadSkillFiles(dir: string, meta: { name: string; source: string }): ResolvedSkill | null {
  const root = join(dir, 'skill')
  if (!existsSync(join(root, 'SKILL.md'))) return null
  const files: Record<string, Buffer> = {}
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else files[relative(root, abs).replace(/\\/g, '/')] = readFileSync(abs)
    }
  }
  walk(root)
  return { name: meta.name, source: meta.source, text: files['SKILL.md']!.toString('utf8'), files }
}

/** True while the run saved its state recently and has not finished: it is running somewhere. */
export function isRunAlive(state: RunState, now = Date.now()): boolean {
  if (state.phase === 'done' || state.phase === 'failed') return false
  const at = Date.parse(state.updatedAt)
  return Number.isFinite(at) && now - at < ALIVE_WITHIN_MS
}

/**
 * The commit the run branch should be on: the last kept attempt's commit, or
 * the commit the run branched from. A crash between an attempt's commit and
 * the state save leaves the branch ahead of this; the resume moves it back
 * and the attempt runs again.
 */
export function expectedHead(state: RunState): string | null {
  const kept = state.surfaces
    .flatMap((s) => s.iterations)
    .filter((i) => i.outcome === 'accepted' && i.commitSha)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
  return kept.length ? kept[kept.length - 1]!.commitSha : state.baseSha
}

export interface ResumeSettings {
  state: RunState
  options: SavedRunOptions
  skill: ResolvedSkill | null
}

/** Settings to resume a run with, or an error that says why it cannot be resumed and what to do. */
export function resumeSettings(repoRoot: string, runId: string, now = Date.now()): ResumeSettings {
  const state = loadState(runDir(repoRoot, runId))
  if (!state) throw new Error(`No run ${runId} in ${join(repoRoot, '.mushi', 'ux')}.`)
  if (state.phase === 'done') throw new Error(`Run ${runId} already finished. Start a new run instead.`)
  if (isRunAlive(state, now)) {
    throw new Error(`Run ${runId} saved its state less than a minute ago, so it is still running somewhere. Stop it there first.`)
  }
  if (!state.options) {
    throw new Error(
      `Run ${runId} started before runs saved their settings. Resume it from the terminal with the same settings: ` +
        `mushi-ux run --resume ${runId} --dev "<your dev command>" (plus --agent, --model, --skill and --path as before).`,
    )
  }
  const skill = state.skill ? loadSkillFiles(runDir(repoRoot, runId), state.skill) : null
  if (state.skill && !skill) {
    throw new Error(`Run ${runId} used the skill ${state.skill.name}, but its saved copy is missing. Resume it with --skill ${state.skill.name}.`)
  }
  return { state, options: state.options, skill }
}
