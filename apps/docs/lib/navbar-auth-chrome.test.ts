/**
 * @vitest-environment jsdom
 *
 * The docs navbar is a static export. Its first HTML is what a signed-out
 * visitor can click before JS runs. That shell used to be "Console" linking
 * at the admin root, which the console redirects to /login.
 *
 * A stored session hides that same shell before first paint (the links keep
 * their box) and the signed-in chrome fades in after hydration.
 */
import { runInThisContext } from 'node:vm'
import { act, createElement } from 'react'

// react-dom logs this until the test runner sets the flag. Vitest's jsdom
// environment does not set it for this package.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { NavbarAuthChrome } from '../components/NavbarAuthChrome'
import { ADMIN_CONSOLE_URL } from './migrationProgress'

const ADMIN = ADMIN_CONSOLE_URL
const SESSION_KEY = 'mushi:docs:auth'
const SHELL_STYLE_ID = 'mushi-docs-auth-shell'

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

function probeSource(html: string): string {
  return html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
}

function runProbe(html: string): void {
  const script = probeSource(html)
  expect(script).not.toBe('')
  runInThisContext(script)
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

describe('NavbarAuthChrome pre-paint session shell', () => {
  afterEach(() => {
    document.getElementById(SHELL_STYLE_ID)?.remove()
    sessionStorage.clear()
    document.body.replaceChildren()
  })

  it('hides the signed-out links before paint when a session is stored, keeping their box', () => {
    const html = staticHtml()
    expect(html.indexOf('<script>')).toBeGreaterThan(-1)
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('>Start free<'))
    expect(html).toContain('data-docs-nav="signed-out"')
    expect(html).toContain('[data-docs-nav="signed-out"]{visibility:hidden}')
    expect(html).not.toContain('display:none')
    expect(html).toContain('@keyframes docs-nav-auth-in{from{opacity:0}to{opacity:1}}')
    expect(html).toContain('@media (prefers-reduced-motion:reduce){[data-docs-nav="signed-in"]{animation:none}}')

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(liveSession()))
    document.body.innerHTML = html
    runProbe(html)

    const shell = document.getElementById(SHELL_STYLE_ID)
    expect(shell?.textContent).toBe('[data-docs-nav="signed-out"]{visibility:hidden}')
    const startFree = [...document.body.querySelectorAll('a')].find((a) => a.textContent === 'Start free')
    expect(startFree?.getAttribute('href')).toBe(`${ADMIN}/signup?src=docs-nav`)
    expect(getComputedStyle(startFree!).visibility).toBe('hidden')
    expect(document.documentElement.innerHTML).not.toContain('secret-token')
  })

  it('leaves the sign-up links visible when nothing usable is stored', () => {
    const html = staticHtml()
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
      expect(() => runProbe(html)).not.toThrow()
      expect(document.getElementById(SHELL_STYLE_ID)).toBeNull()
    }
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
