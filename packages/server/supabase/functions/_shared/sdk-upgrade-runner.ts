/**
 * Shared SDK upgrade job runner — invoked inline from the api route
 * (reliable, same isolate) and from the sdk-upgrade-worker edge function
 * (HTTP fallback for retries / pg_cron sweeper).
 */

import { getServiceClient } from './db.ts'
import { log as rootLog } from './logger.ts'
import { resolveProjectGithubToken, parseGithubRepoUrl } from './github.ts'
import {
  createPrFromFiles,
  createBranchWithSingleCommit,
  ghFetchOptional,
  findOpenPrByHeadPrefix,
  commitFilesToBranch,
  openPullRequestForBranch,
  resolveBaseBranch,
  type FileChange,
} from './github-pr.ts'
import {
  SDK_UPGRADE_PR_LABELS,
  SDK_UPGRADE_PR_TITLE,
  buildUpgradePrBody,
  hasLockfileHelper,
  lockfileNeedsSentence,
  type LockfileOutcome,
} from './sdk-upgrade-pr.ts'
import { collectLockfileChanges, decodeGithubBase64 } from './sdk-upgrade-npm-lock.ts'
import {
  archivedDirsFrom,
  computeBumpPlan,
  isUnderArchivedDir,
  fetchAllLatestVersions,
  type BumpEntry,
} from './sdk-upgrade-plan.ts'
import { UPGRADE_BRANCH_PREFIX, completedJobCockpitFields } from './sdk-upgrade-gates.ts'
import { pickSdkUpgradeRepo, type SdkUpgradeRepoRow } from './sdk-upgrade-repo.ts'
import { SDK_UPGRADE_STALE_MS, shouldClaimSdkUpgradeJob } from './sdk-upgrade-reclaim.ts'

const log = rootLog.child('sdk-upgrade-runner')

// Always-scanned paths (the common layouts). Discovery below augments these so
// repos that keep @mushi-mushi/* deps elsewhere (packages/*, frontend/, client/,
// monorepos) no longer get a false "already up to date" / completed_no_pr.
const FIXED_PKG_PATH_CANDIDATES = [
  'package.json',
  'apps/web/package.json',
  'apps/mobile/package.json',
  'apps/app/package.json',
  'src/package.json',
]

// Upper bound on package.json files read + bumped per run. Raised from the
// original 5 now that we discover dynamically — still bounded so a pathological
// repo can't fan out into hundreds of contents-API calls.
const MAX_PKG_FILES = 25

// Dependency/build/vendor dirs whose package.json files must never be bumped.
const PKG_PATH_IGNORE_RE =
  /(^|\/)(node_modules|dist|build|out|\.next|\.turbo|\.output|coverage|vendor|\.git)\//

interface RepoBlob {
  path: string
  sha?: string
}

interface ScanResult {
  allBumps: BumpEntry[]
  filesToCommit: FileChange[]
  blobs: RepoBlob[]
  /** False when the git tree could not be listed or came back truncated. */
  treeComplete: boolean
}

export type SdkUpgradeRunResult =
  | { ok: true; status: 'completed' | 'completed_no_pr'; prUrl?: string }
  | { ok: true; status: 'awaiting_lockfile'; branch: string }
  | { ok: false; status: 'failed' | 'skipped'; error: string }

export async function runSdkUpgradeJob(jobId: string): Promise<SdkUpgradeRunResult> {
  const db = getServiceClient()

  const { data: job } = await db
    .from('sdk_upgrade_jobs')
    .select('id, project_id, status, started_at')
    .eq('id', jobId)
    .single()

  if (!job) {
    return { ok: false, status: 'skipped', error: `Job ${jobId} not runnable (status=missing)` }
  }

  const claim = shouldClaimSdkUpgradeJob({
    status: job.status,
    started_at: job.started_at,
  })
  if (claim === 'skip') {
    return {
      ok: false,
      status: 'skipped',
      error: `Job ${jobId} not runnable (status=${job.status})`,
    }
  }

  const startedAt = new Date().toISOString()
  const staleIso = new Date(Date.now() - SDK_UPGRADE_STALE_MS).toISOString()
  let claimQuery = db
    .from('sdk_upgrade_jobs')
    .update({ status: 'running', started_at: startedAt })
    .eq('id', jobId)
  claimQuery = claim === 'claim'
    ? claimQuery.eq('status', 'queued')
    : claimQuery
      .eq('status', 'running')
      .or(`started_at.is.null,started_at.lte.${staleIso}`)
  const { data: claimed, error: runErr } = await claimQuery.select('id')

  if (runErr || !claimed?.length) {
    log.warn('sdk-upgrade-runner: could not mark job running', {
      jobId,
      claim,
      error: runErr?.message,
    })
    return { ok: false, status: 'skipped', error: 'Job already started by another worker.' }
  }

  const finalize = async (
    status: string,
    extra: {
      pr_url?: string
      pr_number?: number
      branch?: string
      commit_sha?: string
      plan?: BumpEntry[]
      error?: string
    } = {},
  ) => {
    const finishedAt = new Date().toISOString()
    const cockpit = completedJobCockpitFields(status, extra.pr_url)
    await db
      .from('sdk_upgrade_jobs')
      .update({ status, finished_at: finishedAt, ...cockpit, ...extra })
      .eq('id', jobId)
    // No SDK observation here: an opened PR is not an installed version.
    // Recording plan[0].to made the Update center say the app ran the new
    // version before the PR merged; heartbeats and reports record the truth.
  }

  try {
    const [{ data: repoRows }, { data: settings }] = await Promise.all([
      db
        .from('project_repos')
        .select('repo_url, role, is_primary, default_branch, github_app_installation_id')
        .eq('project_id', job.project_id),
      db
        .from('project_settings')
        .select('github_repo_url')
        .eq('project_id', job.project_id)
        .maybeSingle(),
    ])

    const choice = pickSdkUpgradeRepo(
      (repoRows ?? []) as SdkUpgradeRepoRow[],
      settings?.github_repo_url ?? null,
    )
    const repoRef = parseGithubRepoUrl(choice?.repoUrl ?? null)
    if (!choice || !repoRef) {
      await finalize('completed_no_pr', { error: 'No linked GitHub repo, or its URL is invalid.' })
      return { ok: true, status: 'completed_no_pr' }
    }

    const token = await resolveProjectGithubToken(db, job.project_id, choice.installationId)
    if (!token) {
      log.warn('sdk-upgrade-runner: no GitHub token', { projectId: job.project_id })
      await finalize('completed_no_pr', { error: 'No GitHub token configured for this project.' })
      return { ok: true, status: 'completed_no_pr' }
    }

    const { owner, repo } = repoRef
    const baseHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }

    // GitHub is the truth. project_repos.default_branch is NOT NULL DEFAULT
    // 'main', so a row can say main for a master repo; trusting it first would
    // scan a missing ref and finish "already up to date" with no PR.
    const repoInfoRes = await ghFetchOptional(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: baseHeaders },
    )
    const githubDefault =
      repoInfoRes && typeof repoInfoRes === 'object' &&
      typeof (repoInfoRes as Record<string, unknown>).default_branch === 'string'
        ? ((repoInfoRes as Record<string, unknown>).default_branch as string)
        : null
    const defaultBranch = githubDefault ?? choice.defaultBranch ?? 'main'

    const latestVersions = await fetchAllLatestVersions()

    // Discover every package.json in the repo via one recursive Git Trees call,
    // filtering out dependency/build dirs. Falls back silently to the fixed
    // candidates if the tree can't be fetched (huge/truncated tree, 409 empty
    // repo, permission edge cases) so discovery can only ever add coverage,
    // never remove it.
    const discoverPackageJsonPaths = async (
      ref: string,
    ): Promise<{ paths: string[]; archived: Set<string>; blobs: RepoBlob[]; treeComplete: boolean }> => {
      const none = { paths: [] as string[], archived: new Set<string>(), blobs: [] as RepoBlob[], treeComplete: false }
      const treeRes = await ghFetchOptional(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        { headers: baseHeaders },
      )
      if (!treeRes || typeof treeRes !== 'object') return none
      const body = treeRes as { truncated?: boolean; tree?: Array<{ path?: string; type?: string; sha?: string }> }
      const tree = body.tree
      if (!Array.isArray(tree)) return none
      const blobs = tree
        .filter((e) => e?.type === 'blob' && typeof e.path === 'string')
        .map((e) => ({ path: e.path as string, ...(typeof e.sha === 'string' ? { sha: e.sha } : {}) }))
      const archived = archivedDirsFrom(blobs.map((b) => b.path))
      const paths = blobs
        .map((b) => b.path)
        .filter((p) => /(^|\/)package\.json$/.test(p) && !PKG_PATH_IGNORE_RE.test(p))
        .filter((p) => !isUnderArchivedDir(p, archived))
      return { paths, archived, blobs, treeComplete: body.truncated !== true }
    }

    // Scan every candidate package.json on a given ref and compute the bumps
    // needed to reach the latest npm versions. Reused for both the default
    // branch (the canonical plan) and an existing upgrade branch (to decide
    // whether that branch needs refreshing). Fixed candidates stay first so the
    // root package.json remains the primary observation bump.
    const scanForBumps = async (ref: string): Promise<ScanResult> => {
      const allBumps: BumpEntry[] = []
      const filesToCommit: FileChange[] = []
      const discovered = await discoverPackageJsonPaths(ref)
      const pkgPaths = Array.from(
        new Set([...FIXED_PKG_PATH_CANDIDATES, ...discovered.paths]),
      )
        .filter((p) => !isUnderArchivedDir(p, discovered.archived))
        .slice(0, MAX_PKG_FILES)
      for (const pkgPath of pkgPaths) {
        const fileRes = await ghFetchOptional(
          `https://api.github.com/repos/${owner}/${repo}/contents/${pkgPath}?ref=${encodeURIComponent(ref)}`,
          { headers: baseHeaders },
        )
        if (!fileRes) continue

        const fileObj = fileRes as Record<string, unknown>
        const encoded = fileObj.content as string | undefined
        if (!encoded) continue

        let pkgText: string
        try {
          // atob() yields one char per byte; decode UTF-8 or an em dash in a
          // description is written back as mojibake (glot.it, tsumagoi PRs).
          const bin = atob(encoded.replace(/\s/g, ''))
          pkgText = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))
        } catch {
          continue
        }

        let pkg: Record<string, unknown>
        try {
          pkg = JSON.parse(pkgText)
        } catch {
          continue
        }

        const { bumps, updatedPkg } = computeBumpPlan(pkg, latestVersions)
        if (bumps.length === 0) continue

        filesToCommit.push({
          path: pkgPath,
          contents: JSON.stringify(updatedPkg, null, 2) + '\n',
          reason: `bump ${bumps.map((b) => `${b.package} ${b.from} → ${b.to}`).join(', ')}`,
        })
        allBumps.push(...bumps.map((b) => ({ ...b, path: pkgPath })))
      }
      return { allBumps, filesToCommit, blobs: discovered.blobs, treeComplete: discovered.treeComplete }
    }

    const readersFor = (ref: string) => ({
      readBlob: async (sha: string) => decodeGithubBase64(await ghFetchOptional(
        `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
        { headers: baseHeaders },
      )),
      readContents: async (path: string) => decodeGithubBase64(await ghFetchOptional(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
        { headers: baseHeaders },
      )),
    })

    const { allBumps, filesToCommit, blobs, treeComplete } = await scanForBumps(defaultBranch)

    if (filesToCommit.length === 0 || allBumps.length === 0) {
      log.info('sdk-upgrade-runner: all packages already up to date', { projectId: job.project_id })
      await finalize('completed_no_pr', {
        plan: [],
        error: 'All @mushi-mushi/* packages are already at the latest version.',
      })
      return { ok: true, status: 'completed_no_pr' }
    }

    // ADR 0019: the workflow is read on the default branch. When it is there,
    // the package manager refreshes the lockfile. ADR 0042 edits an npm
    // lockfile only when that workflow is absent.
    const helperPresent = await hasLockfileHelper(owner, repo, defaultBranch, baseHeaders)
    const ghLog = {
      info: (msg: string, ctx?: unknown) => log.info(msg, ctx as Record<string, unknown>),
      warn: (msg: string, ctx?: unknown) => log.warn(msg, ctx as Record<string, unknown>),
    }

    const withLockfiles = async (scan: ScanResult, ref: string) => {
      if (helperPresent) return { files: scan.filesToCommit, outcome: 'helper_missing' as LockfileOutcome, commands: [] as string[] }
      const edited = await collectLockfileChanges({
        blobs: scan.blobs,
        treeComplete: scan.treeComplete,
        manifests: scan.filesToCommit,
        bumps: scan.allBumps,
        ...readersFor(ref),
      })
      if (edited.reasons.length) log.warn('sdk-upgrade-runner: lockfile edit', { reasons: edited.reasons })
      const outcome: LockfileOutcome = edited.outcome === 'npm_updated'
        ? 'npm_updated'
        : edited.outcome === 'manual'
          ? 'manual'
          : 'helper_missing'
      return { files: [...scan.filesToCommit, ...edited.files], outcome, commands: edited.commands }
    }

    // Dedup guard: if an upgrade PR is already open, reuse it instead of
    // stacking a duplicate. Refresh its branch only if newer versions have
    // shipped since it was opened; otherwise reuse it as-is.
    const existingPr = await findOpenPrByHeadPrefix(token, owner, repo, UPGRADE_BRANCH_PREFIX)
    if (existingPr) {
      const onBranch = await scanForBumps(existingPr.headRef)
      if (onBranch.filesToCommit.length > 0) {
        const refreshed = await withLockfiles(onBranch, existingPr.headRef)
        const commitSha = await commitFilesToBranch(
          token,
          owner,
          repo,
          existingPr.headRef,
          refreshed.files,
          ghLog,
        )
        log.info('sdk-upgrade-runner: refreshed existing upgrade PR', {
          projectId: job.project_id,
          prNumber: existingPr.number,
          lockfile: refreshed.outcome,
        })
        await finalize('completed', {
          pr_url: existingPr.url,
          pr_number: existingPr.number,
          branch: existingPr.headRef,
          commit_sha: commitSha,
          plan: allBumps,
          ...(refreshed.commands.length ? { error: lockfileNeedsSentence(refreshed.commands) } : {}),
        })
      } else {
        log.info('sdk-upgrade-runner: reusing already-current upgrade PR', {
          projectId: job.project_id,
          prNumber: existingPr.number,
        })
        await finalize('completed', {
          pr_url: existingPr.url,
          pr_number: existingPr.number,
          branch: existingPr.headRef,
          plan: allBumps,
        })
      }
      return { ok: true, status: 'completed', prUrl: existingPr.url }
    }

    const branch = `${UPGRADE_BRANCH_PREFIX}-${Date.now().toString(36)}`

    // ADR 0019: when the host has the lockfile helper workflow, push the bump
    // as one commit and let that workflow refresh the lockfile. The PR opens
    // later (sdk-release-sync) so its CI runs on the refreshed lockfile.
    if (helperPresent) {
      const base = await resolveBaseBranch(token, owner, repo, defaultBranch, ghLog)
      const commitSha = await createBranchWithSingleCommit({
        token,
        owner,
        repo,
        branch,
        baseSha: base.sha,
        message: [
          'chore(deps): bump @mushi-mushi/* SDK packages',
          '',
          ...filesToCommit.map((f) => `- ${f.path}: ${f.reason}`),
        ].join('\n'),
        files: filesToCommit,
      })
      // Not finalize(): the job is not finished, and finished_at stays empty
      // until the PR opens. sdk-release-sync measures the wait from started_at.
      await db
        .from('sdk_upgrade_jobs')
        .update({ status: 'awaiting_lockfile', branch, commit_sha: commitSha, plan: allBumps })
        .eq('id', jobId)
      log.info('sdk-upgrade-runner: bump pushed, waiting for the host lockfile workflow', {
        projectId: job.project_id,
        branch,
      })
      return { ok: true, status: 'awaiting_lockfile', branch }
    }

    const edited = await withLockfiles({ allBumps, filesToCommit, blobs, treeComplete }, defaultBranch)
    const prBody = buildUpgradePrBody(allBumps, edited.files.map((f) => f.path), edited.outcome, edited.commands)
    const note = edited.commands.length ? lockfileNeedsSentence(edited.commands) : null
    const lockfileInCommit = edited.files.length > filesToCommit.length

    log.info('sdk-upgrade-runner: opening upgrade PR', {
      projectId: job.project_id,
      bumps: allBumps.length,
      files: edited.files.length,
      lockfile: edited.outcome,
    })

    // A rewritten npm lockfile has to land with the package.json bump. Separate
    // commits would push the manifest first and fail `npm ci` before the lockfile.
    const prResult = lockfileInCommit
      ? await (async () => {
          const base = await resolveBaseBranch(token, owner, repo, defaultBranch, ghLog)
          const commitSha = await createBranchWithSingleCommit({
            token,
            owner,
            repo,
            branch,
            baseSha: base.sha,
            message: [
              'chore(deps): bump @mushi-mushi/* SDK packages',
              '',
              ...edited.files.map((f) => `- ${f.path}: ${f.reason}`),
            ].join('\n'),
            files: edited.files,
          })
          const pr = await openPullRequestForBranch({
            token,
            owner,
            repo,
            base: base.branch,
            branch,
            headSha: commitSha,
            title: SDK_UPGRADE_PR_TITLE,
            body: prBody,
            labels: SDK_UPGRADE_PR_LABELS,
          }, ghLog)
          return { url: pr.url, number: pr.number, branch, commitSha }
        })()
      : await createPrFromFiles(
          {
            token,
            owner,
            repo,
            defaultBranch,
            branch,
            title: SDK_UPGRADE_PR_TITLE,
            body: prBody,
            files: edited.files,
            labels: SDK_UPGRADE_PR_LABELS,
          },
          ghLog,
        )

    await finalize('completed', {
      pr_url: prResult.url,
      pr_number: prResult.number,
      branch: prResult.branch,
      commit_sha: prResult.commitSha,
      plan: allBumps,
      ...(note ? { error: note } : {}),
    })

    log.info('sdk-upgrade-runner: PR opened', { prUrl: prResult.url, jobId })
    return { ok: true, status: 'completed', prUrl: prResult.url }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('sdk-upgrade-runner: unexpected error', { jobId, error: message })
    await finalize('failed', { error: message.slice(0, 500) })
    return { ok: false, status: 'failed', error: message }
  }
}
