/**
 * @vitest-environment jsdom
 *
 * The docs navbar is a static export. Its first HTML is what a signed-out
 * visitor can click before JS runs. That shell used to be "Console" linking
 * at the admin root, which the console redirects to /login.
 *
 * A stored session hides that same shell before first paint (the links keep
 * their box) and the signed-in chrome replaces it after hydration. If that
 * bundle never hydrates, the hide comes off after a few seconds so the links
 * return.
 */
import { runInThisContext } from 'node:vm'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavbarAuthChrome } from '../components/NavbarAuthChrome'
import {
  DOCS_NAV_AUTH_SHELL_STYLE_ID,
  DOCS_NAV_HYDRATED_ATTR,
  DOCS_NAV_HYDRATION_FALLBACK_MS,
  DOCS_NAV_SESSION_PROBE,
} from './docs-nav-session-probe'
import { ADMIN_CONSOLE_URL, DOCS_AUTH_SESSION_KEY, getDocsAuthSession } from './migrationProgress'

const ADMIN = ADMIN_CONSOLE_URL

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function liveSession(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'secret-token',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    email: 'ada@example.com',
    projectId: null,
    organizationId: null,
    adminOrigin: 'https://kensaur.us',
    apiUrl: 'https://example.test/functions/v1/api',
    ...overrides,
  }
}

function staticHtml(): string {
  return renderToStaticMarkup(createElement(NavbarAuthChrome))
}

function runProbe(): void {
  runInThisContext(DOCS_NAV_SESSION_PROBE)
}

function startFreeLink(root: ParentNode = document.body): HTMLAnchorElement | undefined {
  return [...root.querySelectorAll('a')].find((a) => a.textContent === 'Start free')
}

function consoleLink(root: ParentNode): HTMLAnchorElement | undefined {
  return [...root.querySelectorAll('a')].find((a) => a.textContent === 'Console')
}

function storeSession(raw: unknown): void {
  sessionStorage.setItem(DOCS_AUTH_SESSION_KEY, JSON.stringify(raw))
}

describe('NavbarAuthChrome signed-out shell', () => {
  it('offers sign-up and sign-in in the static HTML, not Console to the gated admin root', () => {
    const html = staticHtml()
    const host = document.createElement('div')
    host.innerHTML = html
    expect(startFreeLink(host)?.getAttribute('href')).toBe(`${ADMIN}/signup?src=docs-nav`)
    const signIn = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Sign in')
    expect(signIn?.getAttribute('href')).toBe(`${ADMIN}/login`)
    expect(consoleLink(host)).toBeUndefined()
    expect(host.querySelector('[data-docs-nav="signed-out"]')).not.toBeNull()
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<style')
  })
})

describe('NavbarAuthChrome pre-paint session shell', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.getElementById(DOCS_NAV_AUTH_SHELL_STYLE_ID)?.remove()
    document.documentElement.removeAttribute(DOCS_NAV_HYDRATED_ATTR)
    sessionStorage.clear()
    document.body.replaceChildren()
  })

  it('hides the signed-out links before paint when a session is stored, keeping their box', () => {
    storeSession(liveSession())
    expect(getDocsAuthSession()?.email).toBe('ada@example.com')
    document.body.innerHTML = staticHtml()
    runProbe()

    const shell = document.getElementById(DOCS_NAV_AUTH_SHELL_STYLE_ID)
    expect(shell?.textContent).toBe('[data-docs-nav="signed-out"]{visibility:hidden}')
    const startFree = startFreeLink()
    expect(startFree?.getAttribute('href')).toBe(`${ADMIN}/signup?src=docs-nav`)
    expect(getComputedStyle(startFree!).visibility).toBe('hidden')
    expect(document.documentElement.innerHTML).not.toContain('secret-token')
  })

  it('leaves the sign-up links visible when nothing usable is stored', () => {
    const unusable = [
      null,
      '{',
      JSON.stringify(liveSession({ accessToken: '' })),
      JSON.stringify(liveSession({ expiresAt: Math.floor(Date.now() / 1000) - 60 })),
      JSON.stringify(liveSession({ expiresAt: Math.floor(Date.now() / 1000) + 3 })),
    ]
    for (const raw of unusable) {
      document.getElementById(DOCS_NAV_AUTH_SHELL_STYLE_ID)?.remove()
      sessionStorage.clear()
      if (raw !== null) sessionStorage.setItem(DOCS_AUTH_SESSION_KEY, raw)
      expect(() => runProbe()).not.toThrow()
      expect(document.getElementById(DOCS_NAV_AUTH_SHELL_STYLE_ID)).toBeNull()
    }
  })

  it('restores the signed-out links if the bundle never hydrates', () => {
    storeSession(liveSession())
    document.body.innerHTML = staticHtml()
    runProbe()
    const startFree = startFreeLink()
    expect(getComputedStyle(startFree!).visibility).toBe('hidden')
    vi.advanceTimersByTime(DOCS_NAV_HYDRATION_FALLBACK_MS - 1)
    expect(document.getElementById(DOCS_NAV_AUTH_SHELL_STYLE_ID)).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(document.getElementById(DOCS_NAV_AUTH_SHELL_STYLE_ID)).toBeNull()
    expect(getComputedStyle(startFree!).visibility).toBe('visible')
    expect(startFree?.getAttribute('href')).toBe(`${ADMIN}/signup?src=docs-nav`)
  })

  it('keeps the pre-paint hide when the navbar hydrates before the fallback', () => {
    storeSession(liveSession())
    document.body.innerHTML = staticHtml()
    runProbe()
    document.documentElement.setAttribute(DOCS_NAV_HYDRATED_ATTR, '1')
    vi.advanceTimersByTime(DOCS_NAV_HYDRATION_FALLBACK_MS)
    expect(document.getElementById(DOCS_NAV_AUTH_SHELL_STYLE_ID)?.textContent).toBe(
      '[data-docs-nav="signed-out"]{visibility:hidden}',
    )
    expect(getComputedStyle(startFreeLink()!).visibility).toBe('hidden')
  })
})

describe('NavbarAuthChrome after hydration', () => {
  let host: HTMLDivElement
  let root: Root | undefined

  afterEach(() => {
    const mounted = root
    if (mounted) act(() => mounted.unmount())
    root = undefined
    document.getElementById(DOCS_NAV_AUTH_SHELL_STYLE_ID)?.remove()
    document.documentElement.removeAttribute(DOCS_NAV_HYDRATED_ATTR)
    sessionStorage.clear()
    document.body.replaceChildren()
  })

  function render(): void {
    const previous = root
    if (previous) act(() => previous.unmount())
    host = document.createElement('div')
    document.body.appendChild(host)
    const next = createRoot(host)
    root = next
    act(() => {
      next.render(createElement(NavbarAuthChrome))
    })
  }

  it('shows Start free and Sign in when no session is stored, and marks the document hydrated', () => {
    render()
    expect(startFreeLink(host)?.getAttribute('href')).toBe(`${ADMIN}/signup?src=docs-nav`)
    expect([...host.querySelectorAll('a')].find((a) => a.textContent === 'Sign in')?.getAttribute('href')).toBe(
      `${ADMIN}/login`,
    )
    expect(consoleLink(host)).toBeUndefined()
    expect(host.querySelector(`a[href="${ADMIN}/dashboard"]`)).toBeNull()
    expect(host.innerHTML).not.toContain('<script')
    expect(host.innerHTML).not.toContain('<style')
    expect(document.documentElement.getAttribute(DOCS_NAV_HYDRATED_ATTR)).toBe('1')
  })

  it('shows Console on the dashboard when a session is stored', () => {
    storeSession(liveSession())
    render()
    expect(consoleLink(host)?.getAttribute('href')).toBe(`${ADMIN}/dashboard`)
    expect(host.querySelector('[aria-label="Signed in as ada@example.com — open console"]')).not.toBeNull()
    expect(startFreeLink(host)).toBeUndefined()
    expect(host.querySelector('[data-docs-nav="signed-in"]')).not.toBeNull()
    expect(host.innerHTML).not.toContain('<style')
  })

  it('stays signed out when the stored session is expired or empty', () => {
    for (const raw of [
      liveSession({ accessToken: '' }),
      liveSession({ expiresAt: Math.floor(Date.now() / 1000) - 60 }),
      liveSession({ expiresAt: Math.floor(Date.now() / 1000) + 3 }),
    ]) {
      storeSession(raw)
      render()
      expect(startFreeLink(host)?.getAttribute('href')).toBe(`${ADMIN}/signup?src=docs-nav`)
      expect(consoleLink(host)).toBeUndefined()
      sessionStorage.clear()
    }
  })

  it('drops the pre-paint hide on sign-out so Start free is visible', () => {
    const style = document.createElement('style')
    style.id = DOCS_NAV_AUTH_SHELL_STYLE_ID
    style.textContent = '[data-docs-nav="signed-out"]{visibility:hidden}'
    document.head.appendChild(style)
    storeSession(liveSession())
    render()
    const button = host.querySelector('button')
    expect(button?.textContent).toBe('Sign out')
    act(() => {
      button!.click()
    })
    expect(document.getElementById(DOCS_NAV_AUTH_SHELL_STYLE_ID)).toBeNull()
    const startFree = startFreeLink(host)
    expect(startFree?.getAttribute('href')).toBe(`${ADMIN}/signup?src=docs-nav`)
    expect(getComputedStyle(startFree!).visibility).toBe('visible')
    expect(consoleLink(host)).toBeUndefined()
  })

  it('switches to Console when the bridge reports a session, without inserting a script', () => {
    render()
    storeSession(liveSession())
    act(() => {
      window.dispatchEvent(new CustomEvent('mushi:docs:auth-change'))
    })
    expect(consoleLink(host)?.getAttribute('href')).toBe(`${ADMIN}/dashboard`)
    expect(host.innerHTML).not.toContain('<script')
    expect(document.documentElement.getAttribute(DOCS_NAV_HYDRATED_ATTR)).toBe('1')
  })
})
