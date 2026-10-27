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
 * `syncSdkReleaseJob` calls `fetchUpgradeCiOnHead`. The on-demand sync
 * route and the sdk-release-sync cron both call `syncSdkReleaseJob`, so a
 * page-open refresh and the 5-minute sweep store the same commit's conclusion.
 * A failed pull-request, check, or deploy read throws. Callers store nothing.
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
 * Head SHA when GitHub returned one. The stored bump SHA is the fallback
 * only when the pull request was read and has no head. A failed read throws
 * from `fetchUpgradeCiOnHead`; callers then store nothing.
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
 * A failed pull-request, check, or deploy read throws so the caller stores
 * nothing. The workflow run is optional and display-only: a failed workflow
 * read becomes null. The on-demand sync asks for it; the cron does not.
 */
export async function fetchUpgradeCiOnHead(
  token: string,
  ref: GithubRepoRef,
  prNumber: number,
  storedSha: string | null | undefined,
  opts?: { workflow?: boolean },
): Promise<UpgradeCiSnapshot> {
  const pr = await fetchPullRequestDetails(token, ref, prNumber)
  const commitSha = upgradeCheckCommitSha(pr?.headSha, storedSha)
  if (!commitSha) return { pr, commitSha, checks: null, workflow: null, deploy: null }
  const [checks, workflow, deploy] = await Promise.all([
    fetchLatestCheckRun(token, ref, commitSha),
    opts?.workflow
      ? fetchLatestWorkflowRunForSha(token, ref, pr?.baseRef ?? null, commitSha).catch(() => null)
      : Promise.resolve(null),
    fetchLatestDeploymentStatusForSha(token, ref, commitSha),
  ])
  return { pr, commitSha, checks, workflow, deploy }
}
