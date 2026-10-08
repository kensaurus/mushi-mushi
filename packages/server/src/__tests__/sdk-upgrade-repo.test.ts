/**
 * FILE: sdk-upgrade-repo.test.ts
 * PURPOSE: Which linked repo an SDK upgrade PR targets when a project links
 *          several (frontend + backend, docs, ...), and the legacy fallback.
 */

import { describe, expect, it } from 'vitest'
import {
  pickSdkUpgradeRepo,
  type SdkUpgradeRepoRow,
} from '../../supabase/functions/_shared/sdk-upgrade-repo.ts'

const row = (over: Partial<SdkUpgradeRepoRow>): SdkUpgradeRepoRow => ({
  repo_url: 'https://github.com/acme/app',
  role: 'other',
  is_primary: false,
  default_branch: null,
  github_app_installation_id: null,
  ...over,
})

describe('pickSdkUpgradeRepo', () => {
  it('takes the primary repo with its branch and installation', () => {
    const choice = pickSdkUpgradeRepo(
      [
        row({ repo_url: 'https://github.com/acme/api', role: 'backend' }),
        row({ repo_url: 'https://github.com/acme/web', role: 'frontend', is_primary: true, default_branch: 'develop', github_app_installation_id: 42 }),
      ],
      'https://github.com/acme/legacy',
    )
    expect(choice).toEqual({ repoUrl: 'https://github.com/acme/web', defaultBranch: 'develop', installationId: 42 })
  })

  it('prefers an SDK-hosting role over a primary docs or infra repo', () => {
    const choice = pickSdkUpgradeRepo(
      [
        row({ repo_url: 'https://github.com/acme/docs', role: 'docs', is_primary: true }),
        row({ repo_url: 'https://github.com/acme/api', role: 'backend' }),
      ],
      null,
    )
    expect(choice?.repoUrl).toBe('https://github.com/acme/api')
  })

  it('ranks frontend ahead of backend when nothing is primary', () => {
    const choice = pickSdkUpgradeRepo(
      [
        row({ repo_url: 'https://github.com/acme/api', role: 'backend' }),
        row({ repo_url: 'https://github.com/acme/web', role: 'frontend' }),
      ],
      null,
    )
    expect(choice?.repoUrl).toBe('https://github.com/acme/web')
  })

  it('still uses a docs repo when it is the only link', () => {
    expect(pickSdkUpgradeRepo([row({ repo_url: 'https://github.com/acme/docs', role: 'docs' })], null)?.repoUrl)
      .toBe('https://github.com/acme/docs')
  })

  it('falls back to the legacy settings column, then to null', () => {
    expect(pickSdkUpgradeRepo([row({ repo_url: '  ' })], 'https://github.com/acme/legacy')).toEqual({
      repoUrl: 'https://github.com/acme/legacy',
      defaultBranch: null,
      installationId: null,
    })
    expect(pickSdkUpgradeRepo([], null)).toBeNull()
  })
})
