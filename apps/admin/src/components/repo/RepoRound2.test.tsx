/**
 * @vitest-environment jsdom
 *
 * Repo round-2 fixes (fresh-eyes 2026-11-18): a missing GitHub token is said
 * once, first, with "Add token"; the clean-up explainer sits behind the info
 * mark; check wording reads for one check; the readout does not repeat counts.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ usePageData: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/usePageData', () => ({ usePageData: mocks.usePageData }))
vi.mock('../../lib/supabase', () => ({ apiFetchMutate: mocks.apiFetchMutate }))

import { RepoCleanup, howCleanupWorks } from './RepoCleanup'
import { checksPassedText } from './OpenPullRequests'
import { cleanupBlockers, GITHUB_TOKEN_SETTINGS_PATH } from '../../lib/repoCleanup'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TOKEN_ERR = 'No GitHub token is stored for this app. Store a fine-grained token in the app’s GitHub settings.'

const repo = (name: string, error: string | null) => ({
  repo: name,
  error,
  defaultBranch: 'main',
  deleteBranchOnMerge: null,
  canChangeSetting: false,
  settingPending: false,
  branches: [],
  prs: [],
  kept: [],
  keptCount: 0,
  gone: 0,
  truncated: false,
})

const view = (repos: unknown[]) => ({
  projectId: 'p1',
  staleDays: 14,
  repos,
  actions: [],
  restorable: [],
  migrationPending: false,
  canDecide: true,
  canRequest: true,
  limits: { maxItems: 50, perHour: 5, approvalMinutes: 60 },
  raceNote: 'A push in that second could be lost.',
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('cleanupBlockers', () => {
  it('groups identical repo errors into one blocker and flags a token fix', () => {
    const b = cleanupBlockers([repo('o/web', TOKEN_ERR), repo('o/api', TOKEN_ERR), repo('o/ok', null)])
    expect(b).toEqual([{ message: TOKEN_ERR, repos: ['o/web', 'o/api'], needsToken: true }])
    expect(cleanupBlockers([repo('o/web', 'GitHub returned 502')])[0].needsToken).toBe(false)
  })
})

describe('RepoCleanup blocker', () => {
  it('says the missing token once, first, with Add token, and the explainer only behind the info mark', () => {
    mocks.usePageData.mockReturnValue({ data: view([repo('o/web', TOKEN_ERR), repo('o/api', TOKEN_ERR)]), loading: false, error: null, reload: vi.fn() })
    act(() => root.render(createElement(MemoryRouter, null, createElement(RepoCleanup, { projectId: 'p1' }))))
    const text = host.textContent ?? ''
    expect(text.split('No GitHub token is stored').length - 1).toBe(1)
    const blocker = host.querySelector('[data-testid="repo-cleanup-blocker"]')!
    // First thing in the tab.
    expect(host.firstElementChild?.firstElementChild?.contains(blocker)).toBe(true)
    const add = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Add token')
    expect(add?.getAttribute('href')).toBe(GITHUB_TOKEN_SETTINGS_PATH.replace(/#.*/, '') + '#platform-card-github')
    expect(text).not.toContain('Nothing changes until an owner or admin approves')
    expect(text).toContain('A push in that second could be lost.')
  })

  it('keeps the rules available for the info mark', () => {
    expect(howCleanupWorks({ maxItems: 50, perHour: 5, approvalMinutes: 60 })).toContain('the approval lasts 60 minutes')
  })
})

describe('checksPassedText', () => {
  it('reads naturally for one check and for many', () => {
    expect(checksPassedText(1, 1, 'main')).toBe('its required check passed')
    expect(checksPassedText(3, 3, 'main')).toBe('all 3 required checks passed')
    expect(checksPassedText(0, 0, 'main')).toBe('main requires no checks')
  })
})
