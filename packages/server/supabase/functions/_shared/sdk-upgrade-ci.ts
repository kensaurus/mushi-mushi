/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-ci.ts
 * PURPOSE: Read an SDK upgrade PR's checks on its live head commit.
 *
 * OVERVIEW:
 * The job row stores the bump commit. A later lockfile (or any other) push
 * moves the PR head. Check runs on the stored SHA stay red after that head
 * is green, and the Update center then shows "CI failing" on a clean PR.
 *
 * USAGE:
 * POST /sdk-upgrade/:id/sync and the sdk-release-sync cron both call
 * `fetchUpgradeCiOnHead`, so a page-open refresh and the 5-minute sweep
 * store the same commit's conclusion.
 *
 * DEPENDENCIES: `_shared/github.ts` (pull request, check runs, deployments).
 */

import {
  fetchLatestCheckRun,
  fetchLatestDeploymentStatusForSha,
  fetchLatestWorkflowRunForSha,
  fetchPullRequestDetails,
  type CheckRunSnapshot,
  type DeploymentStatusSnapshot,
  type GithubRepoRef,
  type PullRequestDetails,
  type WorkflowRunSnapshot,
} from './github.ts'

/**
 * Head SHA when GitHub returned one. The stored bump SHA is only the
 * fallback when the pull request could not be read.
 */
export function upgradeCheckCommitSha(
  headSha: string | null | undefined,
  storedSha: string | null | undefined,
): string | null {
  if (typeof headSha === 'string' && headSha.length > 0) return headSha
  if (typeof storedSha === 'string' && storedSha.length > 0) return storedSha
  return null
}

export interface UpgradeCiSnapshot {
  pr: PullRequestDetails | null
  commitSha: string | null
  checks: CheckRunSnapshot | null
  workflow: WorkflowRunSnapshot | null
  deploy: DeploymentStatusSnapshot | null
}

/**
 * Load the pull request, then its checks and deployment on that head.
 * Checks are never read on the stored bump SHA when the head is known.
 * The workflow run is optional: the on-demand sync wants it, the cron does not.
 */
export async function fetchUpgradeCiOnHead(
  token: string,
  ref: GithubRepoRef,
  prNumber: number,
  storedSha: string | null | undefined,
  opts?: { workflow?: boolean },
): Promise<UpgradeCiSnapshot> {
  const pr = await fetchPullRequestDetails(token, ref, prNumber).catch(() => null)
  const commitSha = upgradeCheckCommitSha(pr?.headSha, storedSha)
  if (!commitSha) return { pr, commitSha, checks: null, workflow: null, deploy: null }
  const [checks, workflow, deploy] = await Promise.all([
    fetchLatestCheckRun(token, ref, commitSha).catch(() => null),
    opts?.workflow
      ? fetchLatestWorkflowRunForSha(token, ref, pr?.baseRef ?? null, commitSha).catch(() => null)
      : Promise.resolve(null),
    fetchLatestDeploymentStatusForSha(token, ref, commitSha).catch(() => null),
  ])
  return { pr, commitSha, checks, workflow, deploy }
}
