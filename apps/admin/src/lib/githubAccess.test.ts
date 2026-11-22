import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ apiFetch: vi.fn() }))

import { githubAccessFromPreflight, plainIndexError } from './githubAccess'
import type { PreflightCheck } from './useDispatchPreflight'

const check = (ready: boolean): PreflightCheck => ({ key: 'github', ready, label: 'GitHub repo connected', hint: '', fixHref: '/integrations/config#platform-card-github' })

describe('githubAccessFromPreflight', () => {
  it('reads the three states from the repo and the GitHub check', () => {
    const base = { loading: false, error: null }
    expect(githubAccessFromPreflight({ ...base, checks: [check(true)], repoUrl: 'https://github.com/kensaurus/kensaur.us' })).toEqual({ state: 'connected', repo: 'kensaurus/kensaur.us' })
    expect(githubAccessFromPreflight({ ...base, checks: [check(false)], repoUrl: 'https://github.com/kensaurus/kensaur.us' })).toEqual({ state: 'repo_no_access', repo: 'kensaurus/kensaur.us' })
    expect(githubAccessFromPreflight({ ...base, checks: [check(false)], repoUrl: null })).toEqual({ state: 'not_connected', repo: null })
  })

  it('is unknown while loading or when the preflight failed', () => {
    expect(githubAccessFromPreflight({ loading: true, error: null, checks: [], repoUrl: null })).toBeNull()
    expect(githubAccessFromPreflight({ loading: false, error: 'boom', checks: [], repoUrl: null })).toBeNull()
  })
})

describe('plainIndexError', () => {
  it('turns the no_token code into one plain sentence and keeps the code for support', () => {
    const raw = 'no_token: neither github_app_installation_id nor project_settings.github_installation_token_ref resolved'
    expect(plainIndexError(raw, 'kensaurus/kensaur.us')).toEqual({
      text: "Mushi Mushi can't read this repo yet: give the Mushi Mushi GitHub App access to kensaurus/kensaur.us.",
      code: raw,
    })
  })

  it('never shows a raw code as the sentence', () => {
    for (const raw of ['tree fetch 404', 'Resource not accessible by integration (403)', 'filter_matches_nothing: src/**']) {
      const out = plainIndexError(raw, 'a/b')
      expect(out.text).not.toBe(raw)
      expect(out.code).toBe(raw)
    }
  })
})
