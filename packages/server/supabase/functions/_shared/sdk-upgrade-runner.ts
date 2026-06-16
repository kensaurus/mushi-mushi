/**
 * Shared SDK upgrade job runner — invoked inline from the api route
 * (reliable, same isolate) and from the sdk-upgrade-worker edge function
 * (HTTP fallback for retries / pg_cron sweeper).
 */

import { getServiceClient } from './db.ts'
import { log as rootLog } from './logger.ts'
import { resolveProjectGithubToken, parseGithubRepoUrl } from './github.ts'
import { createPrFromFiles, ghFetchOptional } from './github-pr.ts'
import {
  computeBumpPlan,
  fetchAllLatestVersions,
  type BumpEntry,
} from './sdk-upgrade-plan.ts'

const log = rootLog.child('sdk-upgrade-runner')

const PKG_PATH_CANDIDATES = [
  'package.json',
  'apps/web/package.json',
  'apps/mobile/package.json',
  'apps/app/package.json',
  'src/package.json',
]

const MAX_PKG_FILES = 5

export type SdkUpgradeRunResult =
  | { ok: true; status: 'completed' | 'completed_no_pr'; prUrl?: string }
  | { ok: false; status: 'failed' | 'skipped'; error: string }

export async function runSdkUpgradeJob(jobId: string): Promise<SdkUpgradeRunResult> {
  const db = getServiceClient()

  const { data: job } = await db
    .from('sdk_upgrade_jobs')
    .select('id, project_id, status')
    .eq('id', jobId)
    .single()

  if (!job || (job.status !== 'queued' && job.status !== 'running')) {
    return { ok: false, status: 'skipped', error: `Job ${jobId} not runnable (status=${job?.status ?? 'missing'})` }
  }

  const { error: runErr } = await db
    .from('sdk_upgrade_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'queued')

  if (runErr) {
    log.warn('sdk-upgrade-runner: could not mark job running', { jobId, error: runErr.message })
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
    await db
      .from('sdk_upgrade_jobs')
      .update({ status, finished_at: new Date().toISOString(), ...extra })
      .eq('id', jobId)
  }

  try {
    const token = await resolveProjectGithubToken(db, job.project_id)
    if (!token) {
      log.warn('sdk-upgrade-runner: no GitHub token', { projectId: job.project_id })
      await finalize('completed_no_pr', { error: 'No GitHub token configured for this project.' })
      return { ok: true, status: 'completed_no_pr' }
    }

    const { data: settings } = await db
      .from('project_settings')
      .select('github_repo_url')
      .eq('project_id', job.project_id)
      .maybeSingle()

    const repoRef = parseGithubRepoUrl(settings?.github_repo_url ?? null)
    if (!repoRef) {
      await finalize('completed_no_pr', { error: 'github_repo_url is missing or invalid.' })
      return { ok: true, status: 'completed_no_pr' }
    }

    const { owner, repo } = repoRef
    const baseHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }

    const repoInfoRes = await ghFetchOptional(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: baseHeaders },
    )
    const defaultBranch =
      repoInfoRes && typeof repoInfoRes === 'object' &&
      'default_branch' in (repoInfoRes as Record<string, unknown>)
        ? ((repoInfoRes as Record<string, unknown>).default_branch as string)
        : 'main'

    const latestVersions = await fetchAllLatestVersions()
    const allBumps: BumpEntry[] = []
    const filesToCommit: Array<{ path: string; contents: string; reason: string }> = []

    for (const pkgPath of PKG_PATH_CANDIDATES.slice(0, MAX_PKG_FILES)) {
      const fileRes = await ghFetchOptional(
        `https://api.github.com/repos/${owner}/${repo}/contents/${pkgPath}?ref=${encodeURIComponent(defaultBranch)}`,
        { headers: baseHeaders },
      )
      if (!fileRes) continue

      const fileObj = fileRes as Record<string, unknown>
      const encoded = fileObj.content as string | undefined
      if (!encoded) continue

      let pkgText: string
      try {
        pkgText = atob(encoded.replace(/\s/g, ''))
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

      const updatedText = JSON.stringify(updatedPkg, null, 2) + '\n'
      filesToCommit.push({
        path: pkgPath,
        contents: updatedText,
        reason: `bump ${bumps.map((b) => `${b.package} ${b.from} → ${b.to}`).join(', ')}`,
      })
      allBumps.push(...bumps)
    }

    if (filesToCommit.length === 0 || allBumps.length === 0) {
      log.info('sdk-upgrade-runner: all packages already up to date', { projectId: job.project_id })
      await finalize('completed_no_pr', {
        plan: [],
        error: 'All @mushi-mushi/* packages are already at the latest version.',
      })
      return { ok: true, status: 'completed_no_pr' }
    }

    const branch = `mushi/sdk-upgrade-${Date.now().toString(36)}`
    const bumpTable = allBumps
      .map((b) => `| \`${b.package}\` | \`${b.from}\` | \`${b.to}\` |${b.migrateToWeb ? ' ⚠️ legacy → consider `@mushi-mushi/web`' : ''}`)
      .join('\n')

    const prBody = buildUpgradePrBody(bumpTable, filesToCommit.map((f) => f.path))

    log.info('sdk-upgrade-runner: opening upgrade PR', {
      projectId: job.project_id,
      bumps: allBumps.length,
      files: filesToCommit.length,
    })

    const prResult = await createPrFromFiles(
      {
        token,
        owner,
        repo,
        defaultBranch,
        branch,
        title: `chore: bump @mushi-mushi/* SDK packages`,
        body: prBody,
        files: filesToCommit,
        labels: ['mushi-sdk-upgrade'],
      },
      {
        info: (msg, ctx) => log.info(msg, ctx as Record<string, unknown>),
        warn: (msg, ctx) => log.warn(msg, ctx as Record<string, unknown>),
      },
    )

    await finalize('completed', {
      pr_url: prResult.url,
      pr_number: prResult.number,
      branch: prResult.branch,
      commit_sha: prResult.commitSha,
      plan: allBumps,
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

function buildUpgradePrBody(bumpTable: string, changedFiles: string[]): string {
  const fileList = changedFiles.map((f) => `- \`${f}\``).join('\n')
  return `## Mushi Mushi — SDK Upgrade

This PR was generated by the **Mushi Console one-click upgrade** feature.
It bumps all \`@mushi-mushi/*\` packages in your repository to their latest
stable versions.

### Packages bumped

| Package | From | To |
|---------|------|----|
${bumpTable}

### Files changed
${fileList}

### After merging

Run your package manager to refresh the lockfile:

\`\`\`sh
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install
\`\`\`

**Capacitor / React Native projects:** After the lockfile is updated, run:

\`\`\`sh
npx cap sync       # Capacitor — sync JS bundle into native shells
# or
npx pod-install    # React Native iOS
\`\`\`

---
*Review every change before merging. This PR only modifies \`@mushi-mushi/*\`
dependency version strings — no other files are touched.*`
}
