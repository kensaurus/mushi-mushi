/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-pr.ts
 * PURPOSE: The one place an SDK upgrade PR's title, labels and body are made,
 *          so the runner (PR opened at once) and sdk-release-sync (PR opened
 *          after the host's lockfile workflow pushed) write the same PR.
 *
 * ADR 0019: a host that adds `.github/workflows/mushi-sdk-lockfile.yml` gets
 * the bump pushed first; its own workflow refreshes the lockfile with the
 * package manager CLI, and the PR opens after that. Mushi never writes a
 * workflow into a host repo.
 *
 * ADR 0043: with no workflow, package-lock.json (v2 or v3) @mushi-mushi/*
 * entries are updated in the bump commit. pnpm and yarn lockfiles are left
 * as they are and the PR names the install command.
 */

import { ghFetchOptional, openPullRequestForBranch } from './github-pr.ts'
import type { BumpEntry } from './sdk-upgrade-plan.ts'

export const SDK_UPGRADE_PR_TITLE = 'chore: bump @mushi-mushi/* SDK packages'
export const SDK_UPGRADE_PR_LABELS = ['mushi-sdk-upgrade']

/** The workflow file whose presence on the default branch turns on the deferred PR. */
export const LOCKFILE_HELPER_WORKFLOW_PATH = '.github/workflows/mushi-sdk-lockfile.yml'

/** Public docs page with the workflow template. */
export const LOCKFILE_HELPER_DOCS_URL = 'https://kensaur.us/mushi-mushi/docs/admin/sdk-upgrade-lockfile'

/**
 * - `refreshed`: the host workflow pushed a lockfile commit before the PR opened.
 * - `helper_missing`: no workflow and no lockfile to update; the PR opens with the bump.
 * - `timeout`: the workflow exists but no lockfile commit arrived in time.
 * - `npm_updated`: package-lock.json @mushi-mushi/* entries were updated in the bump commit.
 * - `manual`: pnpm, yarn, or an npm lockfile this worker could not edit.
 */
export type LockfileOutcome = 'refreshed' | 'helper_missing' | 'timeout' | 'npm_updated' | 'manual'

/** The sentence the PR body and the Update center share. */
export function lockfileNeedsSentence(commands: readonly string[]): string {
  const list = commands.length > 0 ? commands : ['npm install --package-lock-only']
  if (list.length === 1) return `This PR needs \`${list[0]}\`.`
  return `This PR needs ${list.map((c) => `\`${c}\``).join(' and ')}.`
}

type Headers = Record<string, string>

/** True when the host repo has the lockfile helper workflow on `ref`. */
export async function hasLockfileHelper(
  owner: string,
  repo: string,
  ref: string,
  headers: Headers,
): Promise<boolean> {
  const res = await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}/contents/${LOCKFILE_HELPER_WORKFLOW_PATH}?ref=${encodeURIComponent(ref)}`,
    { headers },
  )
  return Boolean(res && typeof res === 'object' && (res as { type?: string }).type === 'file')
}

/** Unique package.json paths in plan order (each bump records the file it came from). */
export function changedManifestPaths(plan: BumpEntry[]): string[] {
  return Array.from(new Set(plan.map((b) => b.path).filter((p): p is string => typeof p === 'string')))
}

function lockfileSection(lockfile: LockfileOutcome, commands?: readonly string[]): string {
  if (lockfile === 'refreshed') {
    return `### Lockfile

The lockfile was refreshed on this branch by your \`mushi-sdk-lockfile\`
workflow (package manager CLI, \`--ignore-scripts\`), so a frozen install
(\`npm ci\` / \`pnpm install --frozen-lockfile\`) should pass.`
  }
  if (lockfile === 'npm_updated') {
    return `### Lockfile

The npm lockfile entries for \`@mushi-mushi/*\` were updated in this commit
(version, resolved URL, integrity, and the ranges that depend on them), so
\`npm ci\` should pass.

> Tip: add the Mushi lockfile workflow so upgrade PRs refresh pnpm and yarn lockfiles too: ${LOCKFILE_HELPER_DOCS_URL}`
  }
  if (lockfile === 'manual') {
    const sentence = lockfileNeedsSentence(commands ?? [])
    return `### Lockfile

> **${sentence}** Mushi cannot edit this lockfile from the upgrade worker, so CI stays red until that command has updated it and the result is pushed to this branch.

> Tip: add the Mushi lockfile workflow so this happens on its own: ${LOCKFILE_HELPER_DOCS_URL}`
  }
  const note = lockfile === 'timeout'
    ? `> **Lockfile not refreshed** — add the Mushi lockfile workflow (${LOCKFILE_HELPER_DOCS_URL}).
> The workflow is in this repo but pushed no lockfile commit within 30 minutes;
> check its run on this branch.`
    : `> Tip: add the Mushi lockfile workflow so upgrade PRs arrive with a refreshed lockfile: ${LOCKFILE_HELPER_DOCS_URL}`
  return `### After merging

Run your package manager to refresh the lockfile:

\`\`\`sh
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install
\`\`\`

${note}`
}

export function buildUpgradePrBody(
  plan: BumpEntry[],
  changedFiles: string[],
  lockfile: LockfileOutcome,
  commands?: readonly string[],
): string {
  const bumpTable = plan
    .map((b) => `| \`${b.package}\` | \`${b.from}\` | \`${b.to}\` |${b.migrateToWeb ? ' ⚠️ legacy → consider `@mushi-mushi/web`' : ''}`)
    .join('\n')
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

${lockfileSection(lockfile, commands)}

**Capacitor / React Native projects:** After the lockfile is updated, run:

\`\`\`sh
npx cap sync       # Capacitor — sync JS bundle into native shells
# or
npx pod-install    # React Native iOS
\`\`\`

---
${lockfile === 'helper_missing'
    ? `*Review every change before merging. This PR only modifies \`@mushi-mushi/*\`
dependency version strings — no other files are touched.*`
    : lockfile === 'npm_updated'
      ? `*Review every change before merging. This PR updates \`@mushi-mushi/*\` versions and the matching entries in the npm lockfile.*`
      : lockfile === 'manual'
        ? `*Review every change before merging. This PR updates \`@mushi-mushi/*\` versions. The lockfile still needs the command above.*`
        : `*Review every change before merging. Mushi only modifies \`@mushi-mushi/*\`
dependency version strings; the lockfile commit comes from your own workflow.*`}`
}

type SimpleLogger = {
  info: (msg: string, ctx?: unknown) => void
  warn: (msg: string, ctx?: unknown) => void
}

/** Open the upgrade PR for a branch the bump was already pushed to. */
export function openSdkUpgradePr(
  opts: {
    token: string
    owner: string
    repo: string
    base: string
    branch: string
    plan: BumpEntry[]
    lockfile: LockfileOutcome
  },
  log?: SimpleLogger,
): Promise<{ url: string; number: number }> {
  return openPullRequestForBranch(
    {
      token: opts.token,
      owner: opts.owner,
      repo: opts.repo,
      base: opts.base,
      branch: opts.branch,
      title: SDK_UPGRADE_PR_TITLE,
      body: buildUpgradePrBody(opts.plan, changedManifestPaths(opts.plan), opts.lockfile),
      labels: SDK_UPGRADE_PR_LABELS,
    },
    log,
  )
}
