/**
 * FILE: apps/admin/src/lib/appPath.test.ts
 * PURPOSE: Raw links and hard navigations must stay under the SPA base path
 *          (`/mushi-mushi/admin/` in production). QA found six places where a
 *          bare `/billing`, `/dashboard` or `/reports/<id>` left the console
 *          for the domain root; the last test keeps new ones from landing.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appUrl, hardNavigate, routerBasename, withBasePath } from './appPath'

const BASE = '/mushi-mushi/admin/'

describe('routerBasename', () => {
  it('strips the trailing slash Vite adds so /mushi-mushi/admin matches the basename', () => {
    expect(routerBasename('/mushi-mushi/admin/')).toBe('/mushi-mushi/admin')
    expect(routerBasename('/admin/')).toBe('/admin')
  })

  it('keeps the dev root basename as /', () => {
    expect(routerBasename('/')).toBe('/')
    expect(routerBasename(undefined)).toBe('/')
  })

  it('leaves an already slashless basename alone', () => {
    expect(routerBasename('/mushi-mushi/admin')).toBe('/mushi-mushi/admin')
  })

  it('lets BrowserRouter render the slashless admin URL and the slash form', () => {
    expect(renderAt('/mushi-mushi/admin', routerBasename('/mushi-mushi/admin/')).textContent).toBe('console')
    expect(renderAt('/mushi-mushi/admin/', routerBasename('/mushi-mushi/admin/')).textContent).toBe('console')
    expect(renderAt('/mushi-mushi/admin/reports', routerBasename('/mushi-mushi/admin/')).textContent).toBe('reports')
  })

  it('raw Vite base renders nothing at /mushi-mushi/admin', () => {
    expect(renderAt('/mushi-mushi/admin', '/mushi-mushi/admin/').textContent).toBe('')
  })
})

let routeHost: HTMLDivElement | undefined
let routeRoot: Root | undefined

function renderAt(url: string, basename: string): HTMLDivElement {
  window.history.pushState({}, '', url)
  if (routeRoot) act(() => routeRoot!.unmount())
  routeHost?.remove()
  routeHost = document.createElement('div')
  document.body.appendChild(routeHost)
  routeRoot = createRoot(routeHost)
  act(() => {
    routeRoot!.render(
      createElement(
        BrowserRouter,
        { basename },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/', element: createElement('h1', null, 'console') }),
          createElement(Route, { path: '/reports', element: createElement('h1', null, 'reports') }),
        ),
      ),
    )
  })
  return routeHost
}

afterEach(() => {
  if (routeRoot) act(() => routeRoot!.unmount())
  routeRoot = undefined
  routeHost?.remove()
  routeHost = undefined
})

describe('withBasePath', () => {
  it('prefixes a root-relative in-app path', () => {
    expect(withBasePath('/dashboard', BASE)).toBe('/mushi-mushi/admin/dashboard')
    expect(withBasePath('/tester/settings#kyc', BASE)).toBe('/mushi-mushi/admin/tester/settings#kyc')
  })

  it('does not prefix twice', () => {
    expect(withBasePath('/mushi-mushi/admin/billing', BASE)).toBe('/mushi-mushi/admin/billing')
  })

  it('leaves absolute, protocol-relative, relative and anchor links alone', () => {
    expect(withBasePath('https://github.com/x', BASE)).toBe('https://github.com/x')
    expect(withBasePath('mailto:a@b.c', BASE)).toBe('mailto:a@b.c')
    expect(withBasePath('//cdn.example/x', BASE)).toBe('//cdn.example/x')
    expect(withBasePath('settings', BASE)).toBe('settings')
    expect(withBasePath('#top', BASE)).toBe('#top')
  })

  it('is a no-op when the app is served from the root', () => {
    expect(withBasePath('/dashboard', '/')).toBe('/dashboard')
  })
})

describe('appUrl', () => {
  it('builds an absolute URL inside the console', () => {
    expect(appUrl('/reports/r1', { origin: 'https://kensaur.us', basePath: BASE })).toBe(
      'https://kensaur.us/mushi-mushi/admin/reports/r1',
    )
  })
})

describe('hardNavigate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reloads into the console, not the domain root (account switch, QA #14)', () => {
    vi.stubEnv('BASE_URL', BASE)
    const assign = vi.fn()
    const replace = vi.fn()
    vi.stubGlobal('location', { assign, replace, origin: 'https://kensaur.us' })
    hardNavigate('/dashboard')
    expect(assign).toHaveBeenCalledWith('/mushi-mushi/admin/dashboard')
    hardNavigate('/dashboard', { replace: true })
    expect(replace).toHaveBeenCalledWith('/mushi-mushi/admin/dashboard')
  })
})

// ── Source guard ───────────────────────────────────────────────────────────

const SRC = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/** Root-relative targets that are NOT console routes: sibling apps on the
 *  same domain (public tester listings, docs). */
const OTHER_APP_PREFIX = /^\/mushi-mushi\/(?!admin\/)/

const RAW_NAVIGATION = /window\.location\.(?:assign|replace)\(\s*['"`](\/[^'"`]*)|window\.location\.href\s*=\s*['"`](\/[^'"`]*)/g
const RAW_ANCHOR = /<a\b[^>]*?\shref=(?:"(\/[^"]*)"|\{\s*[`'"](\/[^`'"]*))/g

describe('no raw root links (router basename)', () => {
  it('uses <Link>, navigate() or lib/appPath for every in-app destination', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const re of [RAW_NAVIGATION, RAW_ANCHOR]) {
        for (const m of text.matchAll(re)) {
          const target = m[1] ?? m[2] ?? ''
          if (target.startsWith('//') || OTHER_APP_PREFIX.test(target)) continue
          offenders.push(`${relative(SRC, file)}: ${m[0].slice(0, 80)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
