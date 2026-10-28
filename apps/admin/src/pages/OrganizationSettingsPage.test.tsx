/**
 * FILE: apps/admin/src/pages/OrganizationSettingsPage.test.tsx
 * PURPOSE: The team roster keeps Member, Role, Active, and Remove inside a
 *          390px page (report ab58a9ea). Active is not display:none below sm,
 *          and a long email wraps instead of pushing the trash button off
 *          the card.
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const LONG_EMAIL = 'very.long.email.address+tag@example.com'

vi.mock('../lib/realtime', () => ({
  useRealtimeReload: () => ({ channelState: 'idle' }),
}))

vi.mock('../lib/track', () => ({
  trackSelf: () => {},
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const idle = {
      loading: false,
      error: null,
      errorCode: null,
      errorMessage: null,
      requestId: null,
      errorEndpoint: null,
      isValidating: false,
      lastFetchedAt: '2026-10-28T00:00:00Z',
      reload: () => {},
    }
    if (!path) return { ...idle, data: null }
    if (path.includes('/entitlements')) {
      return {
        ...idle,
        data: {
          planId: 'pro',
          planName: 'Pro',
          featureFlags: { teams: true },
          gatedRoutes: [],
          isSuperAdmin: false,
          hasProject: true,
          projectRole: 'owner',
        },
      }
    }
    if (path.includes('/members/stats')) {
      return {
        ...idle,
        data: {
          memberCount: 2,
          pendingInvites: 0,
          seatLimit: 5,
          seatsUsed: 2,
          seatsRemaining: 3,
          inactiveCount: 0,
          activeLast7d: 1,
          expiringSoonInvites: 0,
          atSeatCap: false,
          planId: 'pro',
          planDisplayName: 'Pro',
          currentUserRole: 'owner',
          canManage: true,
          organizationName: 'Acme',
        },
      }
    }
    if (path.includes('/members')) {
      return {
        ...idle,
        data: {
          organization: { id: 'org-1', slug: 'acme', name: 'Acme', plan_id: 'pro' },
          currentUserRole: 'owner',
          invitations: [],
          members: [
            {
              user_id: 'user-long',
              email: LONG_EMAIL,
              role: 'member',
              invited_by: null,
              created_at: '2026-01-01T00:00:00Z',
              last_active_at: '2025-11-28T00:00:00Z',
              joined_via: 'invitation',
            },
            {
              user_id: 'user-owner',
              email: 'owner@example.com',
              role: 'owner',
              invited_by: null,
              created_at: '2025-01-01T00:00:00Z',
              last_active_at: null,
              joined_via: 'founding_owner',
            },
          ],
        },
      }
    }
    return { ...idle, data: null }
  },
}))

import { OrganizationSettingsPage } from './OrganizationSettingsPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render() {
  act(() => {
    root.render(createElement(
      MemoryRouter,
      { initialEntries: ['/organization/members?org=org-1'] },
      createElement(OrganizationSettingsPage),
    ))
  })
}

function classTokens(className: string | null | undefined): string[] {
  return (className ?? '').split(/\s+/).filter(Boolean)
}

function rosterTable(): HTMLTableElement | undefined {
  return Array.from(host.querySelectorAll('table')).find((table) => {
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent?.trim())
    return headers.includes('Member') && headers.includes('Active') && headers.includes('Actions')
  })
}

describe('roster table at phone width', () => {
  it('keeps Active and Actions in the table and wraps a long email', () => {
    render()
    const table = rosterTable()
    expect(table?.className).toContain('table-fixed')

    const headers = Array.from(table?.querySelectorAll('th') ?? []).map((th) => th.textContent?.trim())
    expect(headers).toEqual(['Member', 'Role', 'Active', 'Actions'])
    for (const th of table?.querySelectorAll('th') ?? []) {
      expect(classTokens(th.className)).not.toContain('hidden')
    }

    const email = Array.from(host.querySelectorAll('span')).find((el) => el.textContent === LONG_EMAIL)
    expect(email).toBeTruthy()
    expect(classTokens(email?.className)).toContain('wrap-break-word')

    const remove = host.querySelector(`button[aria-label="Remove ${LONG_EMAIL}"]`)
    expect(remove).toBeTruthy()
    expect(classTokens(remove?.className)).toContain('shrink-0')

    expect(host.textContent).toContain('Never seen')
  })

  const chromiumBin = (() => {
    try {
      const { chromium } = createRequire(import.meta.url)('playwright') as {
        chromium: { executablePath: () => string }
      }
      const bin = chromium.executablePath()
      return existsSync(bin) ? bin : null
    } catch {
      return null
    }
  })()

  it.skipIf(!chromiumBin)('shows Active, Actions, and Remove inside a 390px page', async () => {
    render()
    const table = rosterTable()
    expect(table).toBeTruthy()
    let card: HTMLElement | null = table!.parentElement
    while (card && !classTokens(card.getAttribute('class') ?? '').includes('overflow-hidden')) {
      card = card.parentElement
    }
    expect(card).toBeTruthy()

    const classNames = new Set<string>(['px-4', 'w-full'])
    for (const el of [card!, ...Array.from(card!.querySelectorAll('*'))]) {
      for (const token of classTokens(el.getAttribute('class') ?? '')) classNames.add(token)
    }
    const require = createRequire(import.meta.url)
    const fromVite = createRequire(require.resolve('@tailwindcss/vite'))
    const { compile } = await import(fromVite.resolve('@tailwindcss/node')) as {
      compile: (css: string, options: { base: string, onDependency: () => void }) => Promise<{ build: (candidates: string[]) => string }>
    }
    const compiler = await compile('@import "tailwindcss";\n', {
      base: join(__dirname, '../..'),
      onDependency() {},
    })
    const utilityCss = compiler.build([...classNames])

    const { chromium } = require('playwright') as {
      chromium: { launch: () => Promise<{ newPage: (opts: { viewport: { width: number, height: number } }) => Promise<PwPage>, close: () => Promise<void> }> }
    }
    const browser = await chromium.launch()
    try {
      for (const width of [390, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 844 } })
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style></head><body style="margin:0"><div id="viewport" style="width:${width}px;overflow:hidden"><div class="w-full px-4">${card!.outerHTML}</div></div></body></html>`,
          { waitUntil: 'load' },
        )
        const box = await page.evaluate((email: string) => {
          const viewport = document.getElementById('viewport')!
          const cardEl = viewport.querySelector('.overflow-hidden')!
          const inside = (outer: DOMRect, inner: DOMRect) =>
            inner.width > 0 && inner.height > 0
            && inner.left >= outer.left - 0.5
            && inner.right <= outer.right + 0.5
            && inner.top >= outer.top - 0.5
            && inner.bottom <= outer.bottom + 0.5
          const textBox = (el: Element) => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return range.getBoundingClientRect()
          }
          const vr = viewport.getBoundingClientRect()
          const headers = [...document.querySelectorAll('th')].map((th) => ({
            label: th.textContent?.trim() ?? '',
            inside: inside(vr, textBox(th)),
          }))
          const remove = document.querySelector(`button[aria-label="Remove ${email}"]`)!
          const never = [...document.querySelectorAll('td')].find((td) => td.textContent?.includes('Never seen'))!
          return {
            headers,
            removeInside: inside(vr, remove.getBoundingClientRect()),
            neverInside: inside(vr, textBox(never)),
            scrollOverflow: cardEl.scrollWidth - cardEl.clientWidth,
          }
        }, LONG_EMAIL)
        const detail = JSON.stringify({ width, ...box })
        expect(box.headers.map((h) => h.label), detail).toEqual(['Member', 'Role', 'Active', 'Actions'])
        for (const header of box.headers) expect(header.inside, detail).toBe(true)
        expect(box.removeInside, detail).toBe(true)
        expect(box.neverInside, detail).toBe(true)
        expect(box.scrollOverflow, detail).toBeLessThanOrEqual(1)
        await page.close()
      }
    } finally {
      await browser.close()
    }
  })
})

interface PwPage {
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T, A>(fn: (arg: A) => T, arg: A) => Promise<T>
  close: () => Promise<void>
}
