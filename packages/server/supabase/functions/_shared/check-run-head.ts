/**
 * FILE: packages/server/supabase/functions/_shared/check-run-head.ts
 * PURPOSE: What a check_run delivery stores on fix_attempts.
 *
 * The report page reads one conclusion for the PR head. GitHub's delivery is
 * one check, and an older failed run of a workflow stays on the list after a
 * re-run GitHub already scores as green (report 9e2ec6f0). Both webhook
 * paths (the GitHub App indexer and the repo App webhook in public.ts) store
 * the head rollup from fetchLatestCheckRun. A green rollup also clears
 * fix_attempts.ci_infra so a stale infra flag cannot outlive the failure.
 *
 * The timeline event still describes the delivery itself; only the columns
 * the report page reads are the rollup.
 */

import { fetchLatestCheckRun, type GithubRepoRef } from './github.ts'

export interface StoredHeadCheck {
  status: string | null
  conclusion: string | null
  /** True when fetchLatestCheckRun returned a snapshot for this head. */
  rolledUp: boolean
  /** The stored update must set ci_infra to null. */
  clearInfra: boolean
}

interface HeadCheckUpdate {
  eq(column: string, value: string): PromiseLike<unknown>
  in(column: string, values: readonly string[]): PromiseLike<unknown>
}

export interface HeadCheckDb {
  from(table: string): {
    update(values: Record<string, unknown>): HeadCheckUpdate
  }
}

const GREEN_ROLLUP = new Set(['success', 'neutral', 'skipped'])

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export async function resolveStoredHeadCheck(input: {
  eventStatus: string | null
  eventConclusion: string | null
  token: string | null
  ref: GithubRepoRef | null
  sha: string | null
  onRollupError?: (err: unknown) => void
}): Promise<StoredHeadCheck> {
  let status = normalize(input.eventStatus)
  let conclusion = normalize(input.eventConclusion)
  let rolledUp = false
  if (input.token && input.ref && input.sha) {
    try {
      const snapshot = await fetchLatestCheckRun(input.token, input.ref, input.sha)
      if (snapshot) {
        rolledUp = true
        status = normalize(snapshot.status)
        conclusion = normalize(snapshot.conclusion)
      }
    } catch (err) {
      input.onRollupError?.(err)
    }
  }
  const storedConclusion = conclusion || null
  return {
    status: status || null,
    conclusion: storedConclusion,
    rolledUp,
    clearInfra: rolledUp && GREEN_ROLLUP.has(storedConclusion ?? ''),
  }
}

/** Columns written on fix_attempts. A green rollup wins over an infra verdict. */
export function headCheckPatch(
  head: StoredHeadCheck,
  infra: unknown,
  now: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    check_run_status: head.status,
    check_run_conclusion: head.conclusion,
    check_run_updated_at: now,
  }
  if (head.clearInfra) patch.ci_infra = null
  else if (infra) patch.ci_infra = infra
  return patch
}

/**
 * Read the head rollup and write it onto these fix attempts.
 * `one` matches a single id (the indexer). `many` matches every id (one
 * delivery can hit several attempts that share the commit).
 */
export async function applyHeadCheckRollup<T>(
  db: HeadCheckDb,
  ids: readonly string[],
  match: 'one' | 'many',
  input: {
    eventStatus: string | null
    eventConclusion: string | null
    token: string | null
    ref: GithubRepoRef | null
    sha: string | null
    now?: Date
    onRollupError?: (err: unknown) => void
    /** Skipped by the caller when the rollup is already green. */
    classifyInfra?: (head: StoredHeadCheck) => Promise<T | null>
  },
): Promise<{ head: StoredHeadCheck; infra: T | null }> {
  const head = await resolveStoredHeadCheck(input)
  const infra = input.classifyInfra ? await input.classifyInfra(head) : null
  if (ids.length === 0) return { head, infra }
  const patch = headCheckPatch(head, infra, (input.now ?? new Date()).toISOString())
  const query = db.from('fix_attempts').update(patch)
  if (match === 'one') {
    const id = ids[0]
    if (id) await query.eq('id', id)
  } else {
    await query.in('id', [...ids])
  }
  return { head, infra }
}
