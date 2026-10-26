/**
 * FILE: packages/server/src/__tests__/sdk-upgrade-ci.test.ts
 * PURPOSE: An upgrade PR's CI is read on the live head, not the stored bump.
 *
 * A lockfile push (or any later commit) moves the head. Reading checks on
 * the bump SHA keeps a red conclusion after the head's required check is
 * green — the Update center then stays on "CI failing".
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  pull: vi.fn(),
  checks: vi.fn(),
  workflow: vi.fn(),
  deploy: vi.fn(),
}))

vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  fetchPullRequestDetails: (...args: unknown[]) => calls.pull(...args),
  fetchLatestCheckRun: (...args: unknown[]) => calls.checks(...args),
  fetchLatestWorkflowRunForSha: (...args: unknown[]) => calls.workflow(...args),
  fetchLatestDeploymentStatusForSha: (...args: unknown[]) => calls.deploy(...args),
}))

import { fetchUpgradeCiOnHead, upgradeCheckCommitSha } from '../../supabase/functions/_shared/sdk-upgrade-ci.ts'

const REF = { owner: 'acme', repo: 'app' }

describe('upgradeCheckCommitSha', () => {
  it('prefers the PR head over the stored bump commit', () => {
    expect(upgradeCheckCommitSha('head-green', 'bump-red')).toBe('head-green')
  })

  it('falls back to the stored sha when GitHub did not return a head', () => {
    expect(upgradeCheckCommitSha(null, 'bump-red')).toBe('bump-red')
    expect(upgradeCheckCommitSha('', 'bump-red')).toBe('bump-red')
    expect(upgradeCheckCommitSha(undefined, undefined)).toBeNull()
  })
})

describe('fetchUpgradeCiOnHead', () => {
  beforeEach(() => {
    calls.pull.mockReset()
    calls.checks.mockReset()
    calls.workflow.mockReset()
    calls.deploy.mockReset()
  })

  it('reads checks on the PR head after the pull request, not on the stored bump', async () => {
    const order: string[] = []
    calls.pull.mockImplementation(async () => {
      order.push('pull')
      return { headSha: 'head-green', baseRef: 'main', state: 'open', merged: false }
    })
    calls.checks.mockImplementation(async (_token: string, _ref: unknown, sha: string) => {
      order.push(`checks:${sha}`)
      return { status: 'completed', conclusion: sha === 'head-green' ? 'success' : 'failure' }
    })
    calls.deploy.mockImplementation(async (_token: string, _ref: unknown, sha: string) => {
      order.push(`deploy:${sha}`)
      return null
    })
    calls.workflow.mockResolvedValue({ htmlUrl: 'https://example.test/run' })

    const snap = await fetchUpgradeCiOnHead('tok', REF, 12, 'bump-red', { workflow: true })

    expect(order).toEqual(['pull', 'checks:head-green', 'deploy:head-green'])
    expect(snap.commitSha).toBe('head-green')
    expect(snap.checks).toEqual({ status: 'completed', conclusion: 'success' })
    expect(calls.checks).not.toHaveBeenCalledWith('tok', REF, 'bump-red')
    expect(calls.workflow).toHaveBeenCalledWith('tok', REF, 'main', 'head-green')
  })

  it('uses the stored sha when the pull request cannot be read', async () => {
    calls.pull.mockRejectedValue(new Error('github down'))
    calls.checks.mockResolvedValue({ status: 'completed', conclusion: 'failure' })
    calls.deploy.mockResolvedValue(null)

    const snap = await fetchUpgradeCiOnHead('tok', REF, 12, 'bump-red')

    expect(snap.pr).toBeNull()
    expect(snap.commitSha).toBe('bump-red')
    expect(calls.checks).toHaveBeenCalledWith('tok', REF, 'bump-red')
    expect(calls.workflow).not.toHaveBeenCalled()
  })
})

describe('both CI writers use the head snapshot', () => {
  const functions = resolve(__dirname, '../../supabase/functions')

  it('the 5-minute sync does not read checks on the stored commit itself', () => {
    const src = readFileSync(resolve(functions, 'sdk-release-sync/index.ts'), 'utf8')
    expect(src).toContain('fetchUpgradeCiOnHead(')
    expect(src).not.toContain('fetchLatestCheckRun(')
  })

  it('the on-demand sync route does not read checks on the stored commit itself', () => {
    const src = readFileSync(resolve(functions, 'api/routes/sdk-upgrade.ts'), 'utf8')
    expect(src).toContain('fetchUpgradeCiOnHead(')
    expect(src).not.toContain('fetchLatestCheckRun(')
  })
})
