// SPDX-License-Identifier: MIT
/**
 * A finished run's pull request. The studio's "Open draft PR" pushes the run
 * branch and opens a draft PR into the default branch, or, when the run
 * started from a branch that already has an open PR, adds the run's commits to
 * that PR with a fast-forward push. Nothing merges here: merging is a person's
 * click in the Mushi console (ADR 0017).
 *
 * Uses the person's own `git` and `gh` sign-in. The PR's URL and number are
 * saved in state.json and synced to the console.
 */

import type { IterationRecord, RunState } from './state.js'

export interface RunPullRequest {
  url: string
  number: number
  /** true: the run's commits went onto an existing PR instead of a new one. */
  added: boolean
}

/** Runs a command in the repo; rejects with its output when it exits non-zero. */
export type Exec = (cmd: string, args: readonly string[]) => Promise<string>

const PR_URL_RE = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/

/**
 * Pure: the branch an existing PR may be on, from the ref the run started at
 * ("origin/mushi-ux/review-2026-10-06" → "mushi-ux/review-2026-10-06"). The
 * default branch and HEAD never qualify: those get a new PR.
 * @internal Exported for tests only.
 */
export function continuedBranch(baseRef: string | undefined, defaultBranch: string): string | null {
  const m = baseRef?.match(/^origin\/(.+)$/)
  if (!m || m[1] === defaultBranch || m[1] === 'HEAD') return null
  return m[1]
}

const keptOf = (iterations: readonly IterationRecord[]) => iterations.filter((it) => it.outcome === 'accepted' && it.commitSha)

/**
 * Pure: a conventional-commit title (hosts lint PR titles and build release
 * notes from them), lowercase after the type, at most 72 characters.
 * @internal Exported for tests only.
 */
export function prTitle(state: RunState): string {
  const names = state.surfaces.filter((s) => keptOf(s.iterations).length > 0).map((s) => s.surface.label.split(/\s+[—|–·]\s+/)[0].trim())
  const joined =
    names.length <= 1 ? (names[0] ?? 'app') : names.length <= 3 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
  const title = `fix(ux): polish the ${joined} screen${names.length === 1 ? '' : 's'}`
  return title.length <= 72 ? title : `fix(ux): polish ${names.length} screens`
}

/**
 * Pure: what the run kept, what a person must read, and what the checker said,
 * one section per screen.
 * @internal Exported for tests only.
 */
export function prBody(state: RunState): string {
  const lines = [
    `Made by Mushi's UX loop (\`mushi ux\`): ${state.agent}${state.model ? ` · ${state.model}` : ''}${state.skill?.name ? ` · skills: ${state.skill.name}` : ''}.`,
    'Each commit is one step that did not make accessibility, layout or console measurements worse; a second model could roll a kept step back. Each commit can be kept or dropped on its own.',
    '',
  ]
  const review: string[] = []
  for (const s of state.surfaces) {
    const kept = keptOf(s.iterations)
    const tried = s.iterations.length
    if (tried === 0) continue
    lines.push(`### ${s.surface.label} \`${s.surface.path}\``, `${kept.length} of ${tried} attempts kept.`, '')
    for (const it of kept) {
      const what = (it.step ?? it.reason).replace(/\s+/g, ' ').slice(0, 220)
      const checker = it.checker ? ` ${it.checker.model}: ${it.checker.error ? 'could not review' : it.checker.verdict === 'keep' ? 'agrees' : 'unsure'}.` : ''
      lines.push(`- \`${it.commitSha!.slice(0, 9)}\` ${what}${it.needsReview ? ' **Needs your review.**' : ''}${checker}`)
      if (it.needsReview) review.push(`\`${it.commitSha!.slice(0, 9)}\` (${s.surface.label})`)
    }
    const vetoed = s.iterations.filter((it) => it.checker?.verdict === 'revert')
    for (const it of vetoed) lines.push(`- Rolled back by ${it.checker!.model}: ${it.checker!.summary.replace(/\s+/g, ' ').slice(0, 200)}`)
    lines.push('')
  }
  if (review.length) lines.push('## Read these diffs', `Nothing visible changed in a screenshot, so the measurements could not judge them: ${review.join(', ')}.`, '')
  lines.push(`Run \`${state.runId}\`, branch \`${state.branch}\`. Screenshots of every attempt are on the Mushi console's UX runs page.`)
  return lines.join('\n')
}

/**
 * Opens the run's PR or adds the run to the PR its base branch already has.
 * `exec` runs git and gh in the repo root.
 */
export async function openRunPullRequest(state: RunState, exec: Exec): Promise<RunPullRequest> {
  if (!state.branch) throw new Error('This run has no branch yet.')
  if (!state.surfaces.some((s) => keptOf(s.iterations).length > 0)) throw new Error('This run kept no change, so there is nothing to open a pull request for.')
  if (state.pr) return state.pr
  const defaultBranch = (await exec('gh', ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'])).trim() || 'main'
  const onto = continuedBranch(state.baseRef, defaultBranch)
  if (onto) {
    const open = JSON.parse((await exec('gh', ['pr', 'list', '--head', onto, '--state', 'open', '--json', 'number,url', '--limit', '1'])) || '[]') as Array<{ number: number; url: string }>
    if (open[0]) {
      // Fast-forward only: the run branched from this PR's head, so a plain push adds its commits.
      await exec('git', ['push', 'origin', `${state.branch}:${onto}`])
      return { url: open[0].url, number: open[0].number, added: true }
    }
  }
  await exec('git', ['push', '-u', 'origin', state.branch])
  const out = await exec('gh', ['pr', 'create', '--draft', '--base', defaultBranch, '--head', state.branch, '--title', prTitle(state), '--body', prBody(state)])
  const m = out.match(PR_URL_RE)
  if (!m) throw new Error(`gh did not print the new pull request's URL: ${out.trim().slice(0, 200)}`)
  return { url: m[0], number: Number(m[1]), added: false }
}
