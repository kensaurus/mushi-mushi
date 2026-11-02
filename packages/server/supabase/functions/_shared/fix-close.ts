/**
 * FILE: packages/server/supabase/functions/_shared/fix-close.ts
 * PURPOSE: Close a fix's pull request without merging, the one way Mushi does
 *          it: GitHub closes the PR, the merge queue drops it, the fix and its
 *          report record "closed unmerged", and the reason becomes a team
 *          note on the report. Used by /pipeline's `close` action and by the
 *          repo clean-up's `close_prs` act (ADR 0051), so both leave the same
 *          trail.
 */

import type { getServiceClient } from './db.ts'
import { fetchWithTimeout } from './http.ts'
import { finalizeFixClosedUnmerged } from './fix-merge.ts'
import { postTeamNote } from './reporter-comms.ts'
import { log } from './logger.ts'
import type { GithubRepoRef } from './github.ts'

type Db = ReturnType<typeof getServiceClient>

export interface ClosableFix {
  id: string
  project_id: string
  report_id: string | null
  agent: string | null
  branch: string | null
  commit_sha: string | null
  pr_url: string | null
  pr_number: number | null
}

/** PATCH the pull request to closed; true when GitHub took it. */
export async function closePullRequest(token: string, ref: GithubRepoRef, n: number): Promise<boolean> {
  const res = await fetchWithTimeout(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${n}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  }).catch(() => null)
  return res?.ok === true
}

/**
 * Close and record. `closePull` does the GitHub call (injected so tests and
 * callers with their own fetch can run it); everything after it is the same
 * for every caller. The note is "Pull request #n closed without merging: <reason>".
 */
export async function closeFixPullRequest(
  db: Db,
  input: { fix: ClosableFix; prNumber: number; reason: string; author: string; now: Date; source: 'console' },
  closePull: () => Promise<boolean>,
): Promise<{ ok: boolean; message: string }> {
  const { fix, prNumber, reason, author, now } = input
  const closed = await closePull()
  if (!closed) return { ok: false, message: 'GitHub did not close the pull request.' }
  await db
    .from('fix_merge_queue')
    .update({ state: 'removed', detail: `Closed from the console: ${reason}`.slice(0, 500), updated_at: now.toISOString(), claimed_until: null })
    .eq('fix_attempt_id', fix.id)
    .in('state', ['queued', 'waiting', 'resolving', 'blocked'])
  if (fix.report_id) {
    await finalizeFixClosedUnmerged(
      db,
      { id: fix.id, project_id: fix.project_id, report_id: fix.report_id, agent: fix.agent, branch: fix.branch, commit_sha: fix.commit_sha, pr_url: fix.pr_url, pr_number: fix.pr_number },
      { prNumber, closedAt: now.toISOString(), source: input.source },
    ).catch((err) => log.child('fix-close').warn('finalize after a console close failed', { fixId: fix.id, err: String(err).slice(0, 200) }))
  }
  let noteErr: string | null = 'No report to keep the note on.'
  if (fix.report_id) {
    const res = await postTeamNote(db, { projectId: fix.project_id, reportId: fix.report_id, body: `Pull request #${prNumber} closed without merging: ${reason}`, authorName: author })
    noteErr = res.ok ? null : `The note was not saved: ${res.error}`
  }
  return { ok: true, message: noteErr ? `Closed. ${noteErr}` : 'Closed; the reason is a note on the report.' }
}
