/**
 * @vitest-environment jsdom
 */

/**
 * Connect GitHub (live journey 2026-10-30): the button signs in first, so a
 * person who already installed the App is not left on GitHub's "Configure"
 * page; the repo named like the app is offered first with the only primary
 * button; "Refresh the list" re-reads after adding repos on GitHub.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/supabase', () => api)

import { GitHubConnectCard } from './GitHubConnectCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = '11111111-1111-4111-8111-111111111111'
const LIST = {
  githubLogin: 'kensaurus',
  repos: [
    { fullName: 'kensaurus/kensaur.us', private: true, defaultBranch: 'main', installationId: 7, pushedAt: null },
    { fullName: 'kensaurus/old', private: false, defaultBranch: 'master', installationId: 7, pushedAt: null },
  ],
  unreachableInstallations: [],
  manageUrl: 'https://github.com/apps/mushi-mushi-app/installations/new',
  currentRepoUrl: null,
  suggestedFullName: 'kensaurus/kensaur.us',
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}

const button = (label: RegExp) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined

describe('GitHubConnectCard', () => {
  let container: HTMLDivElement
  let root: Root
  const assign = vi.fn()

  beforeEach(() => {
    api.apiFetch.mockReset()
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith('/github/connect')) {
        return { ok: true, data: { installUrl: 'https://github.com/install', authorizeUrl: 'https://github.com/login/oauth/authorize?x=1', expiresAt: '' } }
      }
      if (path.endsWith('/github/repos')) return { ok: true, data: LIST }
      return { ok: true, data: [] }
    })
    sessionStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, hash: '', pathname: '/connect', search: '' })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    assign.mockReset()
  })

  async function mount() {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(GitHubConnectCard, { projectId: PROJECT, returnTo: 'connect', currentRepoUrl: null })))
    })
    await flush()
  }

  it('Connect GitHub signs in first, with one button and no install-or-continue choice', async () => {
    await mount()
    expect(button(/Already installed/)).toBeUndefined()
    act(() => button(/^Connect GitHub$/)!.click())
    await flush()
    expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?x=1')
  })

  it('offers the repo named like the app first, with the only primary button, and refreshes on request', async () => {
    sessionStorage.setItem(`mushi:github-grant:${PROJECT}`, 'grant-1')
    await mount()
    const rows = Array.from(document.body.querySelectorAll('li'))
    expect(rows[0]!.textContent).toContain('kensaurus/kensaur.us')
    expect(rows[0]!.textContent).toContain('Matches this app')
    expect(rows[1]!.textContent).not.toContain('Matches this app')
    const useButtons = rows.map((r) => r.querySelector('button')!)
    expect(useButtons[0]!.className).not.toEqual(useButtons[1]!.className)
    const before = api.apiFetch.mock.calls.filter(([p]) => String(p).endsWith('/github/repos')).length
    act(() => button(/Refresh the list/)!.click())
    await flush()
    expect(api.apiFetch.mock.calls.filter(([p]) => String(p).endsWith('/github/repos')).length).toBe(before + 1)
  })

  // Owner, 2026-11-17 (kensaur.us): the repo was linked but the App could not
  // reach it; the card still said "Connected", and relinking meant "Change
  // repository", then picking the same repo and pressing Keep.
  describe('a linked repo the GitHub App cannot reach', () => {
    const access = { state: 'repo_no_access' as const, repo: 'kensaurus/kensaur.us' }
    const linked = 'https://github.com/kensaurus/kensaur.us'

    async function mountLinked() {
      act(() => {
        root.render(
          createElement(MemoryRouter, null, createElement(GitHubConnectCard, { projectId: PROJECT, returnTo: 'integrations', currentRepoUrl: linked, access })),
        )
      })
      await flush()
    }

    it('says so in amber with a shape, and offers one "Finish connecting" button', async () => {
      await mountLinked()
      const badge = document.body.querySelector('[data-testid="github-access-missing"]')
      expect(badge?.textContent).toContain('Repo linked · app access missing')
      expect(badge?.textContent).toContain('⚠')
      expect(document.body.textContent).not.toContain('Connected: kensaurus/kensaur.us')
      expect(document.body.textContent).toContain("Mushi Mushi can't read this repo yet: give the Mushi Mushi GitHub App access to kensaurus/kensaur.us.")
      expect(button(/Change repository/)).toBeUndefined()
      act(() => button(/^Finish connecting$/)!.click())
      await flush()
      expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?x=1')
      expect(sessionStorage.getItem(`mushi:github-finish:${PROJECT}`)).toBe('1')
    })

    it('back from GitHub, links the same repo again on its own', async () => {
      api.apiFetch.mockImplementation(async (path: string) => {
        if (path.endsWith('/github/repos')) return { ok: true, data: { ...LIST, currentRepoUrl: linked } }
        if (path.endsWith('/github/repo')) {
          return { ok: true, data: { repoUrl: linked, fullName: 'kensaurus/kensaur.us', defaultBranch: 'main', private: true } }
        }
        return { ok: true, data: [] }
      })
      sessionStorage.setItem(`mushi:github-grant:${PROJECT}`, 'grant-1')
      sessionStorage.setItem(`mushi:github-finish:${PROJECT}`, '1')
      await mountLinked()
      const saves = api.apiFetch.mock.calls.filter(([p]) => String(p).endsWith('/github/repo'))
      expect(saves).toHaveLength(1)
      expect(JSON.parse(String((saves[0]![1] as { body: string }).body))).toMatchObject({ fullName: 'kensaurus/kensaur.us' })
      expect(document.body.textContent).toContain('Connected kensaurus/kensaur.us')
      expect(sessionStorage.getItem(`mushi:github-finish:${PROJECT}`)).toBeNull()
    })
  })
})
