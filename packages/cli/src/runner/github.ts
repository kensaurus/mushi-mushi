/**
 * FILE: packages/cli/src/runner/github.ts
 * PURPOSE: GitHub reads for `mushi runner add` and `mushi runner audit`,
 *          through the user's own `gh` CLI login on this machine (Mushi's
 *          GitHub App never registers runners). Read-only except
 *          `registrationToken`, which the executor pipes straight into the
 *          register step and never prints.
 */

import { spawnSync } from 'node:child_process'
import type { GhRunner } from './audit.js'
import { parseRunnerSha } from './add-plan.js'
import { workflowsWithPrTarget } from './audit.js'

export type GhResult = { ok: true; stdout: string } | { ok: false; error: string }
export type GhExec = (args: string[]) => GhResult

export const nodeGh: GhExec = (args) => {
  const res = spawnSync('gh', args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })
  if (res.error) {
    const missing = (res.error as NodeJS.ErrnoException).code === 'ENOENT'
    return { ok: false, error: missing ? 'gh is not installed (https://cli.github.com)' : res.error.message }
  }
  if (res.status !== 0) {
    const first = (res.stderr || res.stdout || '').trim().split('\n')[0] ?? ''
    return { ok: false, error: first.slice(0, 200) || `gh exited ${res.status}` }
  }
  return { ok: true, stdout: res.stdout }
}

/** Output of `gh auth status` (stdout and stderr: older gh printed it to stderr). */
export function ghAuthStatus(): { ok: boolean; text: string } {
  const res = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] })
  return { ok: !res.error && res.status === 0, text: `${res.stdout ?? ''}${res.stderr ?? ''}` }
}

export function repoIsPublic(gh: GhExec, repo: string): boolean | null {
  const r = gh(['api', `repos/${repo}`, '--jq', '.private'])
  if (!r.ok) return null
  const v = r.stdout.trim()
  return v === 'true' ? false : v === 'false' ? true : null
}

export function forkApprovalPolicy(gh: GhExec, repo: string): string | null {
  const r = gh(['api', `repos/${repo}/actions/permissions/fork-pr-contributor-approval`, '--jq', '.approval_policy'])
  if (!r.ok) return null
  const v = r.stdout.trim()
  return v && v !== 'null' ? v : null
}

/** Workflow files (≤ 30) under .github/workflows that use pull_request_target; null when unreadable. */
export function prTargetWorkflows(gh: GhExec, repo: string): string[] | null {
  const list = gh(['api', `repos/${repo}/contents/.github/workflows`, '--jq', '.[] | select(.type == "file") | .path'])
  if (!list.ok) return /404|Not Found/i.test(list.error) ? [] : null
  const paths = list.stdout.split('\n').map((s) => s.trim()).filter((p) => /\.ya?ml$/.test(p)).slice(0, 30)
  const files: Array<{ name: string; text: string }> = []
  for (const path of paths) {
    const r = gh(['api', `repos/${repo}/contents/${path}`, '--jq', '.content'])
    if (!r.ok) return null
    files.push({ name: path.split('/').pop()!, text: Buffer.from(r.stdout.replace(/\\n|\s/g, ''), 'base64').toString('utf8') })
  }
  return workflowsWithPrTarget(files)
}

export function latestRunnerRelease(gh: GhExec, target: string): { version: string; sha256: string } | null {
  const r = gh(['api', 'repos/actions/runner/releases/latest'])
  if (!r.ok) return null
  try {
    const data = JSON.parse(r.stdout) as { tag_name?: string; body?: string }
    const version = data.tag_name?.replace(/^v/, '')
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null
    const sha256 = parseRunnerSha(data.body ?? '', target)
    return sha256 ? { version, sha256 } : null
  } catch {
    return null
  }
}

export function listRunners(gh: GhExec, repo: string): { runners: GhRunner[] | null; error: string | null } {
  const r = gh(['api', '--paginate', `repos/${repo}/actions/runners`, '--jq', '.runners[]'])
  if (!r.ok) return { runners: null, error: r.error }
  const runners: GhRunner[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      runners.push(JSON.parse(line) as GhRunner)
    } catch {
      // skip a malformed line
    }
  }
  return { runners, error: null }
}

/** The caller's own repos (and orgs they belong to), up to 200. */
export function listOwnRepos(gh: GhExec): string[] | null {
  const r = gh(['repo', 'list', '--limit', '200', '--json', 'nameWithOwner', '--jq', '.[].nameWithOwner'])
  if (!r.ok) return null
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

/** The repo of the current folder's git remote, through gh. */
export function currentRepo(gh: GhExec): string | null {
  const r = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  return r.ok ? r.stdout.trim() || null : null
}

/** A fresh registration token (persistent mode). Never printed. */
export function registrationToken(gh: GhExec, repo: string): GhResult {
  return gh(['api', '-X', 'POST', `repos/${repo}/actions/runners/registration-token`, '--jq', '.token'])
}
