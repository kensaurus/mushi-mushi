import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readUpgradeGithubState, upgradeCiCommitSha } from '../../supabase/functions/_shared/sdk-upgrade-ci-read.ts'

describe('upgradeCiCommitSha', () => {
  it('prefers the pull request head over the stored bump commit', () => {
    expect(upgradeCiCommitSha('head', 'bump')).toBe('head')
    expect(upgradeCiCommitSha(null, 'bump')).toBe('bump')
    expect(upgradeCiCommitSha('  ', 'bump')).toBe('bump')
    expect(upgradeCiCommitSha(null, null)).toBeNull()
  })
})

describe('readUpgradeGithubState', () => {
  it('does not read checks until the pull request head is known', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    let checksSha: string | null = null
    const pending = readUpgradeGithubState({
      storedSha: 'bump',
      fetchPr: async () => {
        await gate
        return { headSha: 'head' }
      },
      fetchChecks: async (sha) => {
        checksSha = sha
        return { conclusion: 'success' }
      },
      fetchDeploy: async (sha) => ({ sha }),
    })
    await Promise.resolve()
    expect(checksSha).toBeNull()
    release()
    const result = await pending
    expect(checksSha).toBe('head')
    expect(result.commitSha).toBe('head')
    expect(result.checks).toEqual({ conclusion: 'success' })
    expect(result.deploy).toEqual({ sha: 'head' })
  })

  it('uses the stored commit when GitHub returns no head', async () => {
    const result = await readUpgradeGithubState({
      storedSha: 'bump',
      fetchPr: async () => null,
      fetchChecks: async (sha) => ({ sha }),
      fetchDeploy: async () => null,
    })
    expect(result.commitSha).toBe('bump')
    expect(result.checks).toEqual({ sha: 'bump' })
  })

  it('skips check reads when there is no commit to ask about', async () => {
    let checks = 0
    const result = await readUpgradeGithubState({
      storedSha: null,
      fetchPr: async () => ({ headSha: null }),
      fetchChecks: async () => { checks += 1; return null },
      fetchDeploy: async () => null,
    })
    expect(result.commitSha).toBeNull()
    expect(checks).toBe(0)
  })
})

describe('sdk-release-sync wiring', () => {
  it('asks for the head before the check runs, not the stored bump commit', () => {
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/sdk-release-sync/index.ts'),
      'utf8',
    )
    expect(src).toContain('readUpgradeGithubState(')
    expect(src).not.toContain('fetchLatestCheckRun(token, ref, rawJob.commit_sha)')
  })
})
