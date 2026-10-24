/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-ci-read.ts
 * PURPOSE: Read an SDK upgrade PR's CI on its current head commit.
 *
 * The job row stores the bump commit. A later lockfile push moves the head.
 * Checking those at the same time used the stored commit, so a green `gate`
 * on the head was saved as a failure (help-her-take-photo pull 137).
 */

/** Head commit when GitHub returned one, otherwise the stored bump commit. */
export function upgradeCiCommitSha(
  headSha: string | null | undefined,
  storedSha: string | null | undefined,
): string | null {
  const head = headSha?.trim()
  if (head) return head
  const stored = storedSha?.trim()
  return stored ? stored : null
}

/**
 * Fetch the pull request, then its checks and deploy status for that head.
 * The two GitHub reads must not run together: the check read needs the head.
 */
export async function readUpgradeGithubState<
  TPr extends { headSha?: string | null },
  TChecks,
  TDeploy,
>(opts: {
  storedSha: string | null
  fetchPr: () => Promise<TPr | null>
  fetchChecks: (sha: string) => Promise<TChecks | null>
  fetchDeploy: (sha: string) => Promise<TDeploy | null>
}): Promise<{
  pr: TPr | null
  commitSha: string | null
  checks: TChecks | null
  deploy: TDeploy | null
}> {
  const pr = await opts.fetchPr()
  const commitSha = upgradeCiCommitSha(pr?.headSha, opts.storedSha)
  if (!commitSha) return { pr, commitSha: null, checks: null, deploy: null }
  const [checks, deploy] = await Promise.all([
    opts.fetchChecks(commitSha),
    opts.fetchDeploy(commitSha),
  ])
  return { pr, commitSha, checks, deploy }
}
