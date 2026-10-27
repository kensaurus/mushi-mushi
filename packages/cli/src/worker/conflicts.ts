/**
 * FILE: packages/cli/src/worker/conflicts.ts
 * PURPOSE: A local worker lane in `conflicts` mode (ADR 0049, amends ADR 0032,
 *          under ADR 0041's cap of 2 conflict agents per PR): resolve one
 *          merge-queue conflict on this machine. It replaces conflict-loop.sh
 *          (2026-10-27), which ran for a day in WSL.
 *
 *            1. The claim names a PR of the lane's own repository and the head
 *               Mushi saw. The clone's origin must be that repository, the PR
 *               must still be at that head, open, and from the same repository.
 *            2. Merge the base branch into that head in a worktree of Mushi's
 *               own cache (`--no-commit`). A clean merge needs no agent.
 *            3. The agent may edit only the files git stopped on, with every
 *               credential stripped (agentEnv) and no remote it can reach.
 *            4. Refused when a conflict marker remains, when any other file
 *               changed (in the working tree or the index), when the merge is
 *               no longer in progress, or when HEAD moved.
 *            5. Commit with the hooks, check the commit is a plain two-parent
 *               merge of the head and the base, and push it fast-forward only,
 *               right after checking the branch is still at the head Mushi saw.
 *
 *          The server re-queues the Opus review of the new head and moves the
 *          queue row on (POST /v1/worker/claims/:id/done).
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { agentEnv, clearWorktree, commitWithHooks, failureTail, git, installDeps, runProc, type WorkStage, classifyFailure } from '../commands/work.js'
import type { ConflictTarget } from './protocol.js'

const CONFLICT_AGENT_TIMEOUT_MS = 20 * 60_000

interface ConflictOutcome {
  result: 'pushed' | 'refused' | 'skipped' | 'timeout' | 'stopped' | 'failed'
  failureKind?: 'infra' | 'code'
  detail: string
  headAfter?: string
}

// ── Pure checks (exported for tests) ────────────────────────────────────────

/** owner/name of a GitHub remote URL (https or ssh), lower case; null for anything else. */
export function repoOfRemote(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null
}

/** One `git ls-files -s` entry: path → staged blobs by stage (0 = merged, 1-3 = a conflict). */
type IndexEntries = Map<string, Map<number, string>>

/** @internal Exported for tests only. Parse `git ls-files -s -z` output. */
export function parseLsFiles(out: string): IndexEntries {
  const entries: IndexEntries = new Map()
  for (const rec of out.split('\0')) {
    const m = rec.match(/^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t(.+)$/s)
    if (!m) continue
    const path = m[4]!
    const stages = entries.get(path) ?? new Map<number, string>()
    stages.set(Number(m[3]), `${m[1]} ${m[2]}`)
    entries.set(path, stages)
  }
  return entries
}

/** @internal Exported for tests only. The paths git stopped on: entries with a stage above 0. */
export function conflictedPaths(entries: IndexEntries): string[] {
  return [...entries].filter(([, stages]) => [...stages.keys()].some((s) => s > 0)).map(([p]) => p).sort()
}

/** @internal Exported for tests only. Conflict-marker lines (a git conflict's `<<<<<<< `, `=======`, `>>>>>>> `) in a file's text. */
export function markerLines(text: string): number[] {
  const out: number[] = []
  text.split('\n').forEach((line, i) => {
    if (/^(?:<{7}|>{7})(?: |$)/.test(line) || /^={7}$/.test(line.replace(/\r$/, ''))) out.push(i + 1)
  })
  return out
}

/**
 * @internal Exported for tests only. Every path the agent changed that it was
 * not allowed to: a merged (stage 0) index entry whose blob or mode is not the
 * one git merged, an index path that was not there, a path git merged that is
 * gone, and any loose path (a worktree edit not in the index, an untracked
 * file) that is not a conflicted one. Conflicted paths may change, or be
 * deleted. Not `git status`: during a merge it lists every file the base
 * brought in, which the agent never touched.
 */
export function outsideChanges(input: { before: IndexEntries; after: IndexEntries; conflicted: readonly string[]; loosePaths: readonly string[] }): string[] {
  const allowed = new Set(input.conflicted)
  const bad = new Set<string>()
  for (const [path, stages] of input.before) {
    if (allowed.has(path)) continue
    const now = input.after.get(path)
    if (!now || now.get(0) !== stages.get(0) || now.size !== 1) bad.add(path)
  }
  for (const path of input.after.keys()) if (!allowed.has(path) && !input.before.has(path)) bad.add(path)
  for (const path of input.loosePaths) if (!allowed.has(path)) bad.add(path)
  return [...bad].sort()
}

/** @internal Exported for tests only. NUL-separated paths (`-z` output). */
export function nulPaths(out: string): string[] {
  return out.split('\0').map((p) => p.replace(/^\n+|\n+$/g, '')).filter(Boolean)
}

/** Worktree edits the index does not have, and untracked files git does not ignore. */
async function loosePaths(wt: string): Promise<string[]> {
  const [edited, untracked] = await Promise.all([
    runProc('git', ['diff', '--name-only', '-z'], { cwd: wt }),
    runProc('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: wt }),
  ])
  if (edited.code !== 0 || untracked.code !== 0) throw new Error(`git could not list the worktree's changes: ${failureTail(edited.code !== 0 ? edited : untracked, 200)}`)
  return [...nulPaths(edited.stdout), ...nulPaths(untracked.stdout)]
}

/** @internal Exported for tests only. The agent's task: these files only, both intents kept, no git commands. */
export function conflictPromptLocal(t: { repo: string; prNumber: number; base: string; files: readonly string[] }): string {
  return [
    `This worktree is in the middle of 'git merge origin/${t.base}' into the branch of pull request #${t.prNumber} (${t.repo}). Git stopped on conflicts in these files:`,
    ...t.files.map((f) => `- ${f}`),
    '',
    `Resolve every conflict in those files only. Keep what the pull request changes AND what ${t.base} changed since; where they touch the same lines, combine them so both intents hold. Remove every conflict marker.`,
    `If a lockfile is conflicted, take ${t.base}'s version and regenerate only the lockfile with the repo's package manager (no upgrades).`,
    'Do not edit, create or delete any other file. Do not run git commit, git merge, git checkout, git reset, git stash or git add. The worker checks every file afterwards and refuses the whole result if anything else changed.',
    'When done, reply with one line per file saying what you kept.',
  ].join('\n')
}

// ── The run ─────────────────────────────────────────────────────────────────

interface ConflictRunOptions {
  repoDir: string
  model?: string
  log: (line: string) => void
  signal?: AbortSignal
}

/** Resolve one claimed conflict. Never throws: every end is an outcome the daemon reports. */
export async function resolveConflict(t: ConflictTarget, o: ConflictRunOptions): Promise<ConflictOutcome> {
  let stage: WorkStage = 'prepare'
  const root = join(homedir(), '.cache', 'mushi', 'conflicts', basename(o.repoDir))
  const wt = join(root, `pr-${t.prNumber}`)
  let keep = false
  try {
    const origin = await git(o.repoDir, ['remote', 'get-url', 'origin'])
    if (repoOfRemote(origin) !== t.repo.toLowerCase()) {
      return { result: 'skipped', detail: `this lane's clone is ${repoOfRemote(origin) ?? 'not a GitHub clone'}, not ${t.repo}` }
    }
    const view = await runProc('gh', ['pr', 'view', String(t.prNumber), '-R', t.repo, '--json', 'state,headRefName,headRefOid,baseRefName,isCrossRepository'], { timeoutMs: 60_000 })
    if (view.code !== 0) return { result: 'failed', failureKind: 'infra', detail: `gh pr view failed: ${failureTail(view, 200)}` }
    const pr = JSON.parse(view.stdout) as { state: string; headRefName: string; headRefOid: string; baseRefName: string; isCrossRepository: boolean }
    if (pr.state !== 'OPEN') return { result: 'skipped', detail: `the pull request is ${pr.state.toLowerCase()}` }
    if (pr.isCrossRepository) return { result: 'skipped', detail: 'the pull request comes from a fork; Mushi never pushes to one' }
    if (pr.headRefName !== t.headRef) return { result: 'skipped', detail: `the pull request's branch is ${pr.headRefName}, not ${t.headRef}` }
    if (pr.headRefOid !== t.headSha) return { result: 'skipped', detail: `the branch moved to ${pr.headRefOid.slice(0, 7)} after Mushi saw ${t.headSha.slice(0, 7)}` }
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(pr.baseRefName) || pr.baseRefName.startsWith('-')) return { result: 'skipped', detail: 'the base branch name is not a plain branch name' }
    const base = pr.baseRefName

    await git(o.repoDir, ['fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`, t.headSha])
    const baseSha = await git(o.repoDir, ['rev-parse', `refs/remotes/origin/${base}`])
    mkdirSync(root, { recursive: true })
    await clearWorktree(o.repoDir, wt)
    await git(o.repoDir, ['worktree', 'add', '--detach', wt, t.headSha])
    // The commit hooks (lint, types, tests) need the dependencies.
    await installDeps(wt, o.log)

    stage = 'agent'
    const merge = await runProc('git', ['merge', '--no-ff', '--no-commit', `refs/remotes/origin/${base}`], { cwd: wt, timeoutMs: 5 * 60_000 })
    const before = parseLsFiles(await git(wt, ['ls-files', '-s', '-z']))
    const files = conflictedPaths(before)
    if (merge.code !== 0 && files.length === 0) {
      return { result: 'failed', failureKind: 'code', detail: `git merge stopped without a conflicted file: ${failureTail(merge, 200)}` }
    }
    const mergeHead = () => runProc('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: wt })
    if ((await mergeHead()).code !== 0) return { result: 'skipped', detail: `the PR already contains ${base}; nothing to merge` }

    let agentNote = 'merged cleanly; no agent was needed'
    if (files.length) {
      // What the dependency install or the merge left loose is not the agent's doing.
      const conflictedSet = new Set(files)
      const looseBefore = new Set((await loosePaths(wt)).filter((p) => !conflictedSet.has(p)))
      o.log(`  conflicts in ${files.length} file(s): ${files.slice(0, 6).join(', ')}${files.length > 6 ? ', …' : ''}`)
      const empty = join(tmpdir(), `mushi-conflict-${process.pid}`)
      mkdirSync(empty, { recursive: true })
      const run = await runProc(
        'cursor-agent',
        ['-p', '--force', '--trust', '--output-format', 'text', '--workspace', wt, ...(o.model ? ['--model', o.model] : []), conflictPromptLocal({ repo: t.repo, prNumber: t.prNumber, base, files })],
        { cwd: wt, env: agentEnv(process.env, empty), timeoutMs: CONFLICT_AGENT_TIMEOUT_MS, signal: o.signal },
      )
      if (o.signal?.aborted) {
        keep = true
        return { result: 'stopped', detail: `stopped (lost the lease); the worktree is kept in ${wt}` }
      }
      if (run.timedOut) return { result: 'timeout', failureKind: 'code', detail: `the agent did not finish within ${CONFLICT_AGENT_TIMEOUT_MS / 60_000} min` }
      if (run.code !== 0) return { result: 'failed', failureKind: classifyFailure(failureTail(run, 300), 'agent'), detail: `cursor-agent exited ${run.code}: ${failureTail(run, 200)}` }
      agentNote = run.stdout.trim().split('\n').filter((l) => l.trim()).slice(-3).join(' ').slice(0, 300) || 'the agent resolved the conflicts'

      // The rules the result must pass before anything is staged or committed.
      if ((await mergeHead()).code !== 0) return { result: 'refused', detail: 'the merge is no longer in progress (the agent committed, aborted or reset it)' }
      if ((await git(wt, ['rev-parse', 'HEAD'])) !== t.headSha) return { result: 'refused', detail: 'HEAD moved during the agent run' }
      const marked = files.filter((f) => existsSync(join(wt, f)) && markerLines(readFileSync(join(wt, f), 'utf8')).length > 0)
      if (marked.length) return { result: 'refused', detail: `conflict markers remain in ${marked.slice(0, 5).join(', ')}` }
      await git(wt, ['add', '-A', '--', ...files])
      const after = parseLsFiles(await git(wt, ['ls-files', '-s', '-z']))
      if (conflictedPaths(after).length) return { result: 'refused', detail: `still unmerged: ${conflictedPaths(after).slice(0, 5).join(', ')}` }
      const changed = outsideChanges({ before, after, conflicted: files, loosePaths: (await loosePaths(wt)).filter((p) => !looseBefore.has(p)) })
      if (changed.length) return { result: 'refused', detail: `the agent changed files that had no conflict: ${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', …' : ''}` }
    }

    stage = 'commit'
    await commitWithHooks(wt, ['--no-edit', '--quiet'], o.log)
    const parents = (await git(wt, ['rev-list', '--parents', '-n', '1', 'HEAD'])).split(' ')
    const sha = parents[0]!
    if (parents.length !== 3 || parents[1] !== t.headSha || parents[2] !== baseSha) {
      return { result: 'refused', detail: 'the commit is not a plain merge of the PR head and the base branch' }
    }

    stage = 'push'
    // Pinned to the head Mushi saw: read the remote branch right before a fast-forward-only push.
    const remote = await runProc('git', ['ls-remote', 'origin', `refs/heads/${t.headRef}`], { cwd: o.repoDir, timeoutMs: 60_000 })
    const remoteSha = remote.stdout.split(/\s/)[0] ?? ''
    if (remote.code !== 0) return { result: 'failed', failureKind: 'infra', detail: `git ls-remote failed: ${failureTail(remote, 200)}` }
    if (remoteSha !== t.headSha) return { result: 'skipped', detail: `the branch moved to ${remoteSha.slice(0, 7) || 'nothing'} while the agent worked; nothing pushed` }
    await git(wt, ['push', '--quiet', 'origin', `HEAD:refs/heads/${t.headRef}`])
    return { result: 'pushed', headAfter: sha, detail: `merged ${base} (${baseSha.slice(0, 7)}) into the PR and pushed ${sha.slice(0, 7)}: ${agentNote}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    keep = stage !== 'prepare'
    return { result: 'failed', failureKind: classifyFailure(message, stage), detail: `${message.slice(0, 600)}${keep ? ` (the worktree is kept in ${wt})` : ''}` }
  } finally {
    if (!keep) await clearWorktree(o.repoDir, wt).catch(() => undefined)
  }
}
