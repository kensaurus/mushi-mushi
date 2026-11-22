import { describe, expect, it } from 'vitest'
import { normaliseRepoUrl, originMatchesRepos, redactRemote, wrongRepoMessage } from './work-repo.js'

describe('normaliseRepoUrl', () => {
  it('reads https, ssh and scp-like spellings of one repo the same', () => {
    const want = 'github.com/acme/lets-talk'
    expect(normaliseRepoUrl('https://github.com/acme/lets-talk')).toBe(want)
    expect(normaliseRepoUrl('https://github.com/acme/lets-talk.git')).toBe(want)
    expect(normaliseRepoUrl('https://github.com/acme/lets-talk/')).toBe(want)
    expect(normaliseRepoUrl('git@github.com:acme/lets-talk.git')).toBe(want)
    expect(normaliseRepoUrl('ssh://git@github.com/acme/lets-talk.git')).toBe(want)
    expect(normaliseRepoUrl('ssh://git@github.com:22/acme/lets-talk')).toBe(want)
    expect(normaliseRepoUrl('  HTTPS://GitHub.com/Acme/Lets-Talk.GIT  ')).toBe(want)
    expect(normaliseRepoUrl('https://x-access-token:mushi_example_key@github.com/acme/lets-talk.git')).toBe(want)
    expect(normaliseRepoUrl('acme/lets-talk')).toBe(want)
  })

  it('keeps the host, so the same path on another host differs', () => {
    expect(normaliseRepoUrl('https://gitlab.com/acme/lets-talk')).toBe('gitlab.com/acme/lets-talk')
  })

  it('is null for an empty remote', () => {
    expect(normaliseRepoUrl('')).toBeNull()
    expect(normaliseRepoUrl('   ')).toBeNull()
  })
})

describe('originMatchesRepos', () => {
  const linked = ['https://github.com/acme/lets-talk']

  it('matches across https and ssh', () => {
    expect(originMatchesRepos('git@github.com:ACME/lets-talk.git', linked)).toBe(true)
  })

  it('matches any of several linked repos', () => {
    expect(originMatchesRepos('git@github.com:acme/web.git', ['https://github.com/acme/app', 'https://github.com/acme/web'])).toBe(true)
  })

  it('does not match another repo', () => {
    expect(originMatchesRepos('git@github.com:acme/solo-boss-cloud_backend.git', linked)).toBe(false)
  })

  it('does not match a clone with no origin', () => {
    expect(originMatchesRepos(null, linked)).toBe(false)
  })

  it('matches anything when no repo is linked', () => {
    expect(originMatchesRepos('git@github.com:acme/anything.git', [])).toBe(true)
    expect(originMatchesRepos(null, [])).toBe(true)
  })
})

describe('redactRemote', () => {
  it('drops the user and token from a URL', () => {
    expect(redactRemote('https://x-access-token:mushi_example_key@github.com/acme/app.git')).toBe('https://github.com/acme/app.git')
  })

  it('leaves an scp-like remote alone', () => {
    expect(redactRemote('git@github.com:acme/app.git')).toBe('git@github.com:acme/app.git')
  })
})

describe('wrongRepoMessage', () => {
  const base = { projectName: 'lets-talk', projectId: 'p-1', repoUrls: ['https://github.com/acme/lets-talk'], repoDir: '/src/backend' }

  it('names the project, its repos, the origin and the fix', () => {
    const r = wrongRepoMessage({ ...base, origin: 'https://x-access-token:mushi_example_key@github.com/acme/backend.git' })
    expect(r).not.toBeNull()
    expect(r!.message).toContain('lets-talk (p-1)')
    expect(r!.message).toContain('https://github.com/acme/lets-talk')
    expect(r!.message).toContain('/src/backend has origin https://github.com/acme/backend.git')
    expect(r!.message).not.toContain('mushi_example_key')
    expect(r!.hint).toContain('mushi login --upgrade-scope --project-id')
    expect(r!.hint).toContain('--repo-dir')
    expect(r!.hint).toContain('--any-repo')
  })

  it('says when the folder has no origin', () => {
    expect(wrongRepoMessage({ ...base, origin: null })!.message).toContain('(no origin remote)')
  })

  it('is null when the origin matches', () => {
    expect(wrongRepoMessage({ ...base, origin: 'git@github.com:acme/lets-talk.git' })).toBeNull()
  })

  it('is null when the server named no repos (older server or none linked)', () => {
    expect(wrongRepoMessage({ ...base, repoUrls: undefined, origin: 'git@github.com:acme/backend.git' })).toBeNull()
    expect(wrongRepoMessage({ ...base, repoUrls: [], origin: 'git@github.com:acme/backend.git' })).toBeNull()
  })
})
