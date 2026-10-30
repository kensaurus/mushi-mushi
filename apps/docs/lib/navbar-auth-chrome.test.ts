/**
 * @vitest-environment jsdom
 *
 * The docs navbar is a static export. Its first HTML is what a signed-out
 * visitor can click before JS runs. That shell used to be "Console" linking
 * at the admin root, which the console redirects to /login.
 *
 * A stored session hides that same shell before first paint (the links keep
 * their box) and the signed-in chrome fades in after hydration. The probe
 * script is one inline script in the root layout head. If that bundle never
 * hydrates, the hide comes off after a few seconds so the links return.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInThisContext } from 'node:vm'
import { act, createElement } from 'react'

// react-dom logs this until the test runner sets the flag. Vitest's jsdom
// environment does not set it for this package.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
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
import { ADMIN_CONSOLE_URL } from './migrationProgress'

const ADMIN = ADMIN_CONSOLE_URL
const SESSION_KEY = 'mushi:docs:auth'
const SHELL_STYLE_ID = DOCS_NAV_AUTH_SHELL_STYLE_ID
const HYDRATED_ATTR = DOCS_NAV_HYDRATED_ATTR

const HERE = dirname(fileURLToPath(import.meta.url))
const layoutSource = readFileSync(join(HERE, '../app/layout.tsx'), 'utf8')
const chromeSource = readFileSync(join(HERE, '../components/NavbarAuthChrome.tsx'), 'utf8')

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
  expect(DOCS_NAV_SESSION_PROBE).not.toBe('')
  runInThisContext(DOCS_NAV_SESSION_PROBE)
}

describe('NavbarAuthChrome signed-out shell', () => {
  const html = staticHtml()

  it('offers sign-up and sign-in, not a Console link to the gated admin root', () => {
    expect(html).toContain(`href="${ADMIN}/signup?src=docs-nav"`)
    expect(html).toContain('>Start free<')
    expect(html).toContain(`href="${ADMIN}/login"`)
    expect(html).toContain('>Sign in<')
    expect(html).not.toContain('>Console<')
    expect(html).not.toContain(`href="${ADMIN}/"`)
    expect(html).not.toContain(`href="${ADMIN}"`)
  })
})

describe('NavbarAuthChrome probe placement', () => {
  it('renders no script tag from the client navbar', () => {
    expect(staticHtml()).not.toMatch(/<script[\s>/]/)
    expect(chromeSource).not.toMatch(/<script\b/)
  })

  it('emits the pre-paint probe once from the root layout head, before the navbar', () => {
    const headStart = layoutSource.indexOf('<Head>')
    const headEnd = layoutSource.indexOf('</Head>')
    expect(headStart).toBeGreaterThan(-1)
    expect(headEnd).toBeGreaterThan(headStart)
    const head = layoutSource.slice(headStart, headEnd)
    expect(head).toContain('<script')
    expect(head).toContain('dangerouslySetInnerHTML={{ __html: DOCS_NAV_SESSION_PROBE }}')
    expect(head).not.toContain('NavbarAuthChrome')
    expect(head).not.toContain('text/plain')
    expect(layoutSource.match(/<script\b/g)).toHaveLength(1)
    // The navbar const is declared above the layout return. In the document
    // the head script still precedes the body, where that navbar is mounted.
    const bodyStart = layoutSource.indexOf('<body>', headEnd)
    expect(bodyStart).toBeGreaterThan(headEnd)
    expect(layoutSource.slice(bodyStart)).toContain('navbar={navbar}')
  })
})

describe('NavbarAuthChrome pre-paint session shell', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.getElementById(SHELL_STYLE_ID)?.remove()
    document.documentElement.removeAttribute(HYDRATED_ATTR)
    sessionStorage.clear()
    document.body.replaceChildren()
  })

  it('hides the signed-out links before paint when a session is stored, keeping their box', () => {
    const html = staticHtml()
    expect(html).not.toMatch(/<script[\s>/]/)
    expect(html).toContain('data-docs-nav="signed-out"')
    expect(DOCS_NAV_SESSION_PROBE).toContain('[data-docs-nav="signed-out"]{visibility:hidden}')
    expect(DOCS_NAV_SESSION_PROBE).not.toContain('display:none')
    expect(html).not.toContain('display:none')
    expect(html).toContain('@keyframes docs-nav-auth-in{from{opacity:0}to{opacity:1}}')
    expect(html).toContain('@media (prefers-reduced-motion:reduce){[data-docs-nav="signed-in"]{animation:none}}')

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(liveSession()))
    document.body.innerHTML = html
    runProbe()

    const shell = document.getElementById(SHELL_STYLE_ID)
    expect(shell?.textContent).toBe('[data-docs-nav="signed-out"]{visibility:hidden}')
    const startFree = [...document.body.querySelectorAll('a')].find((a) => a.textContent === 'Start free')
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
      document.getElementById(SHELL_STYLE_ID)?.remove()
      sessionStorage.clear()
      if (raw !== null) sessionStorage.setItem(SESSION_KEY, raw)
      expect(() => runProbe()).not.toThrow()
      expect(document.getElementById(SHELL_STYLE_ID)).toBeNull()
    }
  })

  it('restores the signed-out links if the bundle never hydrates', () => {
    const html = staticHtml()
    expect(DOCS_NAV_SESSION_PROBE).toContain(String(DOCS_NAV_HYDRATION_FALLBACK_MS))
    expect(DOCS_NAV_HYDRATION_FALLBACK_MS).toBeGreaterThanOrEqual(2_000)
    expect(DOCS_NAV_HYDRATION_FALLBACK_MS).toBeLessThanOrEqual(8_000)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(liveSession()))
    document.body.innerHTML = html
    runProbe()
    const startFree = [...document.body.querySelectorAll('a')].find((a) => a.textContent === 'Start free')
    expect(getComputedStyle(startFree!).visibility).toBe('hidden')
    vi.advanceTimersByTime(DOCS_NAV_HYDRATION_FALLBACK_MS - 1)
    expect(document.getElementById(SHELL_STYLE_ID)).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(document.getElementById(SHELL_STYLE_ID)).toBeNull()
    expect(getComputedStyle(startFree!).visibility).toBe('visible')
    expect(startFree?.getAttribute('href')).toBe(`${ADMIN}/signup?src=docs-nav`)
  })

  it('keeps the pre-paint hide when the navbar hydrates before the fallback', () => {
    const html = staticHtml()
    expect(DOCS_NAV_SESSION_PROBE).toContain(HYDRATED_ATTR)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(liveSession()))
    document.body.innerHTML = html
    runProbe()
    document.documentElement.setAttribute(HYDRATED_ATTR, '1')
    vi.advanceTimersByTime(DOCS_NAV_HYDRATION_FALLBACK_MS)
    expect(document.getElementById(SHELL_STYLE_ID)?.textContent).toBe(
      '[data-docs-nav="signed-out"]{visibility:hidden}',
    )
    const startFree = [...document.body.querySelectorAll('a')].find((a) => a.textContent === 'Start free')
    expect(getComputedStyle(startFree!).visibility).toBe('hidden')
  })
})

describe('NavbarAuthChrome after hydration', () => {
  let host: HTMLDivElement
  let root: Root | undefined

  afterEach(() => {
    const mounted = root
    if (mounted) act(() => mounted.unmount())
    root = undefined
    document.getElementById(SHELL_STYLE_ID)?.remove()
    document.documentElement.removeAttribute(HYDRATED_ATTR)
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

  it('shows Start free and Sign in when no session is stored', () => {
    render()
    expect(host.innerHTML).toContain('>Start free<')
    expect(host.innerHTML).toContain('>Sign in<')
    expect(host.innerHTML).toContain(`href="${ADMIN}/signup?src=docs-nav"`)
    expect(host.innerHTML).toContain(`href="${ADMIN}/login"`)
    expect(host.innerHTML).not.toContain('>Console<')
    expect(host.querySelector(`a[href="${ADMIN}/dashboard"]`)).toBeNull()
  })

  it('marks the document hydrated and does not insert a script when the shell switches', () => {
    render()
    expect(host.innerHTML).not.toMatch(/<script[\s>/]/)
    expect(document.documentElement.getAttribute(HYDRATED_ATTR)).toBe('1')
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(liveSession()))
    act(() => {
      window.dispatchEvent(new CustomEvent('mushi:docs:auth-change'))
    })
    expect(host.innerHTML).not.toMatch(/<script[\s>/]/)
    expect(host.innerHTML).toContain('data-docs-nav="signed-in"')
    expect(document.documentElement.getAttribute(HYDRATED_ATTR)).toBe('1')
  })

  it('shows Console and the dashboard when a session is stored', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(liveSession()))
    render()
    const consoleLink = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Console')
    expect(consoleLink?.getAttribute('href')).toBe(`${ADMIN}/dashboard`)
    expect(host.innerHTML).toContain('Signed in as ada@example.com')
    expect(host.innerHTML).not.toContain('>Start free<')
    expect(host.innerHTML).not.toContain('>Sign in<')
    expect(host.innerHTML).toContain('data-docs-nav="signed-in"')
    expect(host.innerHTML).toContain('@keyframes docs-nav-auth-in{from{opacity:0}to{opacity:1}}')
  })

  it('stays signed out when the stored session is expired or empty', () => {
    for (const raw of [
      liveSession({ accessToken: '' }),
      liveSession({ expiresAt: Math.floor(Date.now() / 1000) - 60 }),
      liveSession({ expiresAt: Math.floor(Date.now() / 1000) + 3 }),
    ]) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(raw))
      render()
      expect(host.innerHTML).toContain('>Start free<')
      expect(host.innerHTML).not.toContain('>Console<')
      sessionStorage.clear()
    }
  })

  it('drops the pre-paint hide on sign-out so Start free is visible', () => {
    const style = document.createElement('style')
    style.id = SHELL_STYLE_ID
    style.textContent = '[data-docs-nav="signed-out"]{visibility:hidden}'
    document.head.appendChild(style)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(liveSession()))
    render()
    const button = host.querySelector('button')
    expect(button?.textContent).toBe('Sign out')
    act(() => {
      button!.click()
    })
    expect(document.getElementById(SHELL_STYLE_ID)).toBeNull()
    const startFree = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Start free')
    expect(startFree?.getAttribute('href')).toBe(`${ADMIN}/signup?src=docs-nav`)
    expect(getComputedStyle(startFree!).visibility).toBe('visible')
    expect(host.innerHTML).not.toContain('>Console<')
  })
})
