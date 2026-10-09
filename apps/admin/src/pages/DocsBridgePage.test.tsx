/**
 * @vitest-environment jsdom
 *
 * The docs bridge hands the user's access token to the docs window that
 * opened it. It must only do so for an allowed docs origin, never post to a
 * local dev server from a production console, and never post without an
 * explicit Allow click.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { docsBridgeAllowedOrigins } from '../lib/docsBridgeOrigins'

const SESSION = {
  access_token: 'fake-access-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { email: 'dev@example.com' },
}

vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: SESSION, loading: false }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: SESSION } })),
      refreshSession: vi.fn(async () => ({ data: { session: SESSION } })),
    },
  },
}))
vi.mock('../lib/env', () => ({ RESOLVED_API_URL: 'https://api.example.test' }))
vi.mock('../lib/activeProject', () => ({ getActiveProjectIdSnapshot: () => 'project-1' }))
vi.mock('../lib/activeOrg', () => ({ getActiveOrgIdSnapshot: () => 'org-1' }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))

describe('docsBridgeAllowedOrigins', () => {
  it('allows only the hosted docs when the console runs in production', () => {
    const allowed = docsBridgeAllowedOrigins('kensaur.us')
    expect(allowed.has('https://kensaur.us')).toBe(true)
    expect(allowed.has('http://localhost:3000')).toBe(false)
    expect(allowed.has('http://127.0.0.1:3001')).toBe(false)
  })

  it('drops local origins added through the env allowlist in production', () => {
    const allowed = docsBridgeAllowedOrigins('kensaur.us', 'http://localhost:4000, https://docs.example.com')
    expect(allowed.has('http://localhost:4000')).toBe(false)
    expect(allowed.has('https://docs.example.com')).toBe(true)
  })

  it('allows local docs dev servers when the console itself runs locally', () => {
    const allowed = docsBridgeAllowedOrigins('localhost')
    expect(allowed.has('http://localhost:3000')).toBe(true)
    expect(allowed.has('http://127.0.0.1:3001')).toBe(true)
    expect(docsBridgeAllowedOrigins('127.0.0.1').has('http://localhost:3001')).toBe(true)
  })
})

describe('DocsBridgePage consent', () => {
  let container: HTMLDivElement
  let root: Root
  const postMessage = vi.fn()

  beforeEach(() => {
    postMessage.mockClear()
    Object.defineProperty(window, 'opener', { value: { postMessage }, configurable: true, writable: true })
    vi.spyOn(window, 'close').mockImplementation(() => {})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function render(returnOrigin: string) {
    const { DocsBridgePage } = await import('./DocsBridgePage')
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [`/docs-bridge?nonce=n1&returnOrigin=${encodeURIComponent(returnOrigin)}`] },
          createElement(DocsBridgePage),
        ),
      )
    })
  }

  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)

  it('asks before signing the docs in, and posts nothing until Allow', async () => {
    await render('https://kensaur.us')
    expect(container.textContent).toContain('Sign in to the docs as dev@example.com?')
    expect(container.textContent).toContain('https://kensaur.us')
    expect(postMessage).not.toHaveBeenCalled()

    await act(async () => {
      button('Allow')!.click()
    })
    expect(postMessage).toHaveBeenCalledTimes(1)
    const [payload, origin] = postMessage.mock.calls[0]
    expect(origin).toBe('https://kensaur.us')
    expect(payload).toMatchObject({ type: 'mushi:docs-bridge:token', nonce: 'n1', accessToken: 'fake-access-token' })
  })

  it('posts nothing when the user cancels', async () => {
    await render('https://kensaur.us')
    await act(async () => {
      button('Cancel')!.click()
    })
    expect(postMessage).not.toHaveBeenCalled()
    expect(container.textContent).toContain('The docs did not get your sign-in')
  })

  it('refuses an origin that is not on the allowlist without offering Allow', async () => {
    await render('https://evil.example')
    expect(button('Allow')).toBeUndefined()
    expect(container.textContent).toContain("isn't on the allowlist")
    expect(postMessage).not.toHaveBeenCalled()
  })
})
