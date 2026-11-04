/**
 * Re-run CI is offered only when the token in use can write Actions
 * (report 69fcafcb). An App permission is known before the click. A refusal
 * sticks to that token, not to the last settings save, and a row written
 * before fingerprints does not keep the button off once the token is known.
 */

import { describe, expect, it } from 'vitest'
import {
  actionsLevel,
  appRerunFingerprint,
  fingerprintFromPayload,
  githubRepoKey,
  installationBlocksRerun,
  installationIdsForProject,
  patRerunFingerprint,
  probeRerunAccess,
  projectsRerunRefused,
  rerunCiBlocked,
  type RerunAccess,
  type RepoInstallRow,
} from '../../supabase/functions/_shared/ci-rerun-permission.ts'

const DAY = 24 * 3600_000
const NOW = Date.parse('2026-10-26T12:00:00Z')
const P = 'p1'

function access(over: Partial<RerunAccess> = {}): RerunAccess {
  return { blocks: false, fingerprint: null, unreadable: false, ...over }
}

describe('installation permissions', () => {
  it('reads Actions write from the mint and ignores an empty map', () => {
    expect(actionsLevel({ actions: 'read', contents: 'write' })).toBe('read')
    expect(actionsLevel({ contents: 'write' })).toBe('none')
    expect(actionsLevel({})).toBeNull()
    expect(actionsLevel(null)).toBeNull()
    expect(installationBlocksRerun({ actions: 'read', contents: 'write' })).toBe(true)
    expect(installationBlocksRerun({ actions: 'write' })).toBe(false)
    expect(installationBlocksRerun({ actions: 'admin' })).toBe(false)
    expect(installationBlocksRerun({})).toBe(false)
    expect(installationBlocksRerun(null)).toBe(false)
  })

  it('keeps a repo name that contains a dot', () => {
    expect(githubRepoKey('https://github.com/kensaurus/glot.it/pull/152')).toBe('kensaurus/glot.it')
    expect(githubRepoKey('https://github.com/kensaurus/glot.it')).toBe('kensaurus/glot.it')
  })

  it('uses the pull request repo’s installation, not another repo’s', () => {
    const repos: RepoInstallRow[] = [
      { project_id: P, repo_url: 'https://github.com/kensaurus/glot.it', is_primary: true, github_app_installation_id: null },
      { project_id: P, repo_url: 'https://github.com/kensaurus/other', is_primary: false, github_app_installation_id: 9 },
    ]
    const open = { project_id: P, pr_url: 'https://github.com/kensaurus/glot.it/pull/1', pr_state: 'open' }
    expect(installationIdsForProject(repos, [open], P)).toEqual([])
    expect(installationIdsForProject(repos, [{ ...open, pr_state: 'draft', pr_url: 'https://github.com/kensaurus/other/pull/2' }], P)).toEqual([9])
    expect(installationIdsForProject(repos, [{ ...open, pr_state: 'closed' }], P)).toEqual([])
  })
})

describe('rerunCiBlocked', () => {
  const ttl = 7 * DAY
  const fp = 'pat:' + 'ab'.repeat(16)

  it('blocks when the App lacks Actions write, before any refusal', () => {
    expect(rerunCiBlocked({ nowMs: NOW, ttlMs: ttl, ...access({ blocks: true }), refusals: [] })).toBe(true)
  })

  it('keeps a matching token blocked with no expiry, and clears a different token', () => {
    const old = { at: '2026-09-01T00:00:00Z', fingerprint: fp }
    expect(rerunCiBlocked({ nowMs: NOW, ttlMs: ttl, ...access({ fingerprint: fp }), refusals: [old] })).toBe(true)
    expect(rerunCiBlocked({ nowMs: NOW, ttlMs: ttl, ...access({ fingerprint: 'pat:' + 'cd'.repeat(16) }), refusals: [old] })).toBe(false)
  })

  it('does not let a pre-fingerprint refusal outlive a token Mushi can name', () => {
    const legacy = { at: '2026-10-26T10:00:00Z', fingerprint: null }
    expect(rerunCiBlocked({ nowMs: NOW, ttlMs: ttl, ...access({ fingerprint: fp }), refusals: [legacy] })).toBe(false)
    expect(rerunCiBlocked({ nowMs: NOW, ttlMs: ttl, ...access(), refusals: [legacy] })).toBe(true)
    expect(rerunCiBlocked({ nowMs: NOW, ttlMs: ttl, ...access(), refusals: [{ at: '2026-10-01T00:00:00Z', fingerprint: null }] })).toBe(false)
  })

  it('keeps a fingerprinted refusal when the token could not be read', () => {
    expect(
      rerunCiBlocked({
        nowMs: NOW,
        ttlMs: ttl,
        ...access({ unreadable: true }),
        refusals: [{ at: '2026-09-01T00:00:00Z', fingerprint: fp }],
      }),
    ).toBe(true)
  })

  it('reads only a well-formed fingerprint from the event', () => {
    expect(fingerprintFromPayload({ tokenFingerprint: fp })).toBe(fp)
    expect(fingerprintFromPayload({ tokenFingerprint: 'app:42:read' })).toBe('app:42:read')
    expect(fingerprintFromPayload({ tokenFingerprint: 'ghp_secret' })).toBeNull()
    expect(fingerprintFromPayload(null)).toBeNull()
  })
})

describe('probeRerunAccess', () => {
  const attempt = { project_id: P, pr_url: 'https://github.com/kensaurus/glot.it/pull/1', pr_state: 'open' }
  const repos: RepoInstallRow[] = [
    { project_id: P, repo_url: 'https://github.com/kensaurus/glot.it', is_primary: true, github_app_installation_id: 42 },
  ]

  it('blocks from the App’s Actions permission without a previous 403', async () => {
    const accessByProject = await probeRerunAccess([P], [attempt], [], {
      repos: async () => repos,
      mint: async () => ({ permissions: { actions: 'read', contents: 'write', pull_requests: 'write' } }),
      pat: async () => {
        throw new Error('the token must not be read when the App answered')
      },
    })
    expect(accessByProject.get(P)).toEqual({ blocks: true, fingerprint: 'app:42:read', unreadable: false })
    expect(projectsRerunRefused([P], accessByProject, [], NOW, 7 * DAY)).toEqual(new Set([P]))
  })

  it('drops the block when the App’s Actions permission becomes write', async () => {
    const accessByProject = await probeRerunAccess(
      [P],
      [attempt],
      [{ project_id: P, fingerprint: 'app:42:read' }],
      {
        repos: async () => repos,
        mint: async () => ({ permissions: { actions: 'write', contents: 'write' } }),
        pat: async () => null,
      },
    )
    expect(accessByProject.get(P)?.blocks).toBe(false)
    expect(accessByProject.get(P)?.fingerprint).toBe(appRerunFingerprint(42, 'write'))
    expect(projectsRerunRefused([P], accessByProject, [{ project_id: P, at: '2026-09-01T00:00:00Z', fingerprint: 'app:42:read' }], NOW, 7 * DAY).size).toBe(0)
  })

  it('hashes the personal access token only after a refusal, and a new token does not match', async () => {
    let pats = 0
    const old = await patRerunFingerprint('ghp_old')
    const none = await probeRerunAccess([P], [attempt], [], {
      repos: async () => [{ ...repos[0], github_app_installation_id: null }],
      mint: async () => null,
      pat: async () => {
        pats += 1
        return 'ghp_old'
      },
    })
    expect(pats).toBe(0)
    expect(none.size).toBe(0)
    const same = await probeRerunAccess([P], [attempt], [{ project_id: P, fingerprint: old }], {
      repos: async () => [{ ...repos[0], github_app_installation_id: null }],
      mint: async () => null,
      pat: async () => 'ghp_old',
    })
    expect(projectsRerunRefused([P], same, [{ project_id: P, at: '2026-09-01T00:00:00Z', fingerprint: old }], NOW, 7 * DAY)).toEqual(new Set([P]))
    const replaced = await probeRerunAccess([P], [attempt], [{ project_id: P, fingerprint: old }], {
      repos: async () => [{ ...repos[0], github_app_installation_id: null }],
      mint: async () => null,
      pat: async () => 'ghp_new',
    })
    expect(projectsRerunRefused([P], replaced, [{ project_id: P, at: '2026-10-26T10:00:00Z', fingerprint: old }], NOW, 7 * DAY).size).toBe(0)
  })

  it('keeps a fingerprinted refusal when the mint does not answer, and lets an unnamed refusal expire', async () => {
    const fp = 'app:42:read'
    const refused = await probeRerunAccess([P], [attempt], [{ project_id: P, fingerprint: fp }], {
      repos: async () => repos,
      mint: async () => null,
      pat: async () => {
        throw new Error('the token must not be read when an App installation is in use')
      },
    })
    expect(refused.get(P)).toEqual({ blocks: false, fingerprint: null, unreadable: true })
    expect(projectsRerunRefused([P], refused, [{ project_id: P, at: '2026-09-01T00:00:00Z', fingerprint: fp }], NOW, 7 * DAY)).toEqual(new Set([P]))

    const legacy = await probeRerunAccess([P], [attempt], [{ project_id: P, fingerprint: null }], {
      repos: async () => repos,
      mint: async () => null,
      pat: async () => null,
    })
    expect(legacy.get(P)).toEqual({ blocks: false, fingerprint: null, unreadable: false })
    expect(projectsRerunRefused([P], legacy, [{ project_id: P, at: '2026-10-26T10:00:00Z', fingerprint: null }], NOW, 7 * DAY)).toEqual(new Set([P]))
    expect(projectsRerunRefused([P], legacy, [{ project_id: P, at: '2026-10-01T00:00:00Z', fingerprint: null }], NOW, 7 * DAY).size).toBe(0)
  })
})
