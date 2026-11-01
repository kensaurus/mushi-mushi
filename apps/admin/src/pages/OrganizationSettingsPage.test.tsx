/**
 * FILE: apps/admin/src/pages/OrganizationSettingsPage.test.tsx
 * PURPOSE: Roster columns at phone width (report ab58a9ea).
 *          Active stays in the table below sm, a long email wraps in Member,
 *          and Remove / Leave stay inside the card at 390px.
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/track', () => ({
  trackSelf: () => {},
}))

vi.mock('../lib/realtime', () => ({
  useRealtimeReload: () => ({ channelState: 'idle' }),
}))

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'user-self' } }),
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
      lastFetchedAt: '2026-10-31T00:00:00Z',
      reload: () => {},
    }
    if (!path) return { ...idle, data: null }
    if (path.includes('/members/stats')) {
      return {
        ...idle,
        data: {
          memberCount: 2,
          pendingInvites: 0,
          seatLimit: 5,
          seatsUsed: 2,
          seatsRemaining: 3,
          inactiveCount: 1,
          activeLast7d: 1,
          expiringSoonInvites: 0,
          atSeatCap: false,
          planId: 'pro',
          planDisplayName: 'Studio',
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
          organization: {
            id: '11111111-1111-4111-8111-111111111111',
            slug: 'acme',
            name: 'Acme',
            plan_id: 'pro',
          },
          currentUserRole: 'owner',
          invitations: [],
          members: [
            {
              user_id: 'user-self',
              email: 'ada@example.com',
              role: 'owner',
              invited_by: null,
              created_at: '2026-01-01T00:00:00Z',
              last_active_at: '2026-10-30T00:00:00Z',
              joined_via: 'founding_owner',
            },
            {
              user_id: 'user-owner-2',
              email: 'bob@example.com',
              role: 'owner',
              invited_by: null,
              created_at: '2026-01-02T00:00:00Z',
              last_active_at: '2026-10-29T00:00:00Z',
              joined_via: 'direct_admin',
            },
            {
              user_id: 'user-other',
              email: 'very.long.teammate.address@example.com',
              role: 'member',
              invited_by: 'user-self',
              created_at: '2026-02-01T00:00:00Z',
              last_active_at: null,
              joined_via: 'invitation',
            },
          ],
        },
      }
    }
    if (path.includes('/entitlements')) {
      return {
        ...idle,
        data: {
          planId: 'pro',
          planName: 'Studio',
          featureFlags: { teams: true },
          gatedRoutes: [],
          isSuperAdmin: false,
          hasProject: true,
        },
      }
    }
    return { ...idle, data: null }
  },
}))

import { OrganizationSettingsPage } from './OrganizationSettingsPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ORG = '11111111-1111-4111-8111-111111111111'
const LONG_EMAIL = 'very.long.teammate.address@example.com'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false },
  }))
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
      { initialEntries: [`/organization/members?org=${ORG}`] },
      createElement(OrganizationSettingsPage),
    ))
  })
}

function classTokens(className: string | null | undefined): string[] {
  return (className ?? '').split(/\s+/).filter(Boolean)
}

function rosterTable(): HTMLTableElement {
  const table = Array.from(host.querySelectorAll('table')).find((candidate) => {
    const headers = Array.from(candidate.querySelectorAll('th')).map((th) => th.textContent?.trim())
    return headers.includes('Member') && headers.includes('Active')
  })
  if (!table) throw new Error('roster table not rendered')
  return table
}

describe('team roster at phone width', () => {
  it('keeps Active in the table and wraps a long email in Member', () => {
    render()
    const table = rosterTable()
    expect(classTokens(table.className)).toContain('table-fixed')

    const headers = Array.from(table.querySelectorAll('th'))
    expect(headers.map((th) => th.textContent?.trim())).toEqual(['Member', 'Role', 'Active', 'Actions'])
    for (const th of headers) {
      expect(classTokens(th.className)).not.toContain('hidden')
    }

    const neverSeen = Array.from(table.querySelectorAll('td')).find((td) => td.textContent?.includes('Never seen'))
    expect(neverSeen).toBeTruthy()
    expect(classTokens(neverSeen?.className)).not.toContain('hidden')

    const email = Array.from(table.querySelectorAll('td span')).find((el) => el.textContent === LONG_EMAIL)
    expect(email).toBeTruthy()
    expect(classTokens(email?.className)).toContain('wrap-break-word')
    expect(classTokens(email?.className)).toContain('min-w-0')

    const actions = headers[3]
    expect(classTokens(actions?.className)).toContain('w-14')
    expect(classTokens(actions?.className)).not.toContain('w-24')
    // w-24 is the sm width, present as a variant, not the phone width.
    expect(actions?.className).toContain('sm:w-24')
    // "Actions" is wider than this column. It stays available to assistive
    // tech and is shown from sm, where the column is wide enough.
    const actionsLabel = actions?.querySelector('span')
    expect(classTokens(actionsLabel?.className)).toContain('sr-only')
    expect(actionsLabel?.className).toContain('sm:not-sr-only')

    expect(table.querySelector('button[aria-label="Leave this team"]')).toBeTruthy()
    expect(table.querySelector(`button[aria-label="Remove ${LONG_EMAIL}"]`)).toBeTruthy()
  })

  // The unit job does not install a browser. Skip there; run wherever Chromium is present.
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

  it.skipIf(!chromiumBin)('shows Active and Remove inside the card at a 390px viewport', async () => {
    render()
    const table = rosterTable()
    let card: HTMLElement | null = table.parentElement
    while (card && !classTokens(card.getAttribute('class')).includes('overflow-hidden')) {
      card = card.parentElement
    }
    expect(card).toBeTruthy()

    const classNames = new Set<string>(['px-4', 'w-full'])
    for (const el of [card!, ...Array.from(card!.querySelectorAll('*'))]) {
      for (const token of classTokens(el.getAttribute('class'))) classNames.add(token)
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
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style></head><body style="margin:0"><div id="viewport" style="width:390px;overflow:hidden"><div class="w-full px-4">${card!.outerHTML}</div></div></body></html>`,
        { waitUntil: 'load' },
      )
      const box = await page.evaluate(() => {
        const viewport = document.getElementById('viewport')!
        const cardEl = viewport.querySelector('.overflow-hidden')!
        const roster = [...cardEl.querySelectorAll('table')].find((candidate) =>
          [...candidate.querySelectorAll('th')].some((th) => th.textContent?.trim() === 'Member'),
        )!
        const headers = [...roster.querySelectorAll('th')]
        const member = headers[0]!
        const active = headers.find((th) => th.textContent?.trim() === 'Active')!
        const actions = headers.find((th) => th.textContent?.trim() === 'Actions')!
        const neverCell = [...roster.querySelectorAll('td')].find((td) => td.textContent?.includes('Never seen'))!
        const never = [...neverCell.querySelectorAll('span')].find((el) => el.textContent?.trim() === 'Never seen')!
        const email = [...roster.querySelectorAll('span')].find((el) => el.textContent === 'very.long.teammate.address@example.com')!
        const remove = roster.querySelector('button[aria-label^="Remove "]')!
        const leave = roster.querySelector('button[aria-label="Leave this team"]')!
        const selects = [...roster.querySelectorAll('select')]
        const cr = cardEl.getBoundingClientRect()
        const vr = viewport.getBoundingClientRect()
        const rect = (el: Element) => el.getBoundingClientRect()
        const inside = (outer: DOMRect, inner: DOMRect) =>
          inner.width > 0 && inner.height > 0
          && inner.left >= outer.left - 0.5
          && inner.right <= outer.right + 0.5
          && inner.top >= outer.top - 0.5
          && inner.bottom <= outer.bottom + 0.5
        const overlaps = (a: DOMRect, b: DOMRect) =>
          a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
        const memberBox = rect(member)
        const activeBox = rect(active)
        const actionsBox = rect(actions)
        const neverBox = rect(never)
        const emailBox = rect(email)
        const removeBox = rect(remove)
        const leaveBox = rect(leave)
        const memberCell = email.closest('td')!.getBoundingClientRect()
        const activeCell = neverCell.getBoundingClientRect()
        return {
          memberWidth: memberBox.width,
          actionsWidth: actionsBox.width,
          activeWidth: activeBox.width,
          emailInsideCell: inside(memberCell, emailBox),
          neverInsideCell: inside(activeCell, neverBox),
          neverInsideCard: inside(cr, neverBox),
          activeInsideCard: inside(cr, activeBox),
          actionsInsideCard: inside(cr, actionsBox),
          removeInsideCard: inside(cr, removeBox),
          leaveInsideCard: inside(cr, leaveBox),
          removeWidth: removeBox.width,
          leaveWidth: leaveBox.width,
          selectFits: selects.every((el) => el.scrollWidth <= el.clientWidth + 1),
          selectInsideCard: selects.every((el) => inside(cr, rect(el))),
          headersOverlap: overlaps(activeBox, actionsBox) || overlaps(memberBox, activeBox),
          cardInsideViewport: inside(vr, cr),
          scrollOverflow: cardEl.scrollWidth - cardEl.clientWidth,
        }
      })
      const detail = JSON.stringify(box)
      expect(box.memberWidth, detail).toBeGreaterThan(96)
      expect(box.memberWidth, detail).toBeGreaterThan(box.actionsWidth)
      expect(box.activeWidth, detail).toBeGreaterThan(40)
      expect(box.emailInsideCell, detail).toBe(true)
      expect(box.neverInsideCell, detail).toBe(true)
      expect(box.neverInsideCard, detail).toBe(true)
      expect(box.activeInsideCard, detail).toBe(true)
      expect(box.actionsInsideCard, detail).toBe(true)
      expect(box.removeInsideCard, detail).toBe(true)
      expect(box.leaveInsideCard, detail).toBe(true)
      expect(box.removeWidth, detail).toBeGreaterThan(16)
      expect(box.leaveWidth, detail).toBeGreaterThan(24)
      expect(box.selectFits, detail).toBe(true)
      expect(box.selectInsideCard, detail).toBe(true)
      expect(box.headersOverlap, detail).toBe(false)
      expect(box.cardInsideViewport, detail).toBe(true)
      expect(box.scrollOverflow, detail).toBeLessThanOrEqual(1)

      const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await desktop.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${utilityCss}</style></head><body style="margin:0"><div id="viewport" style="width:1440px;overflow:hidden"><div class="w-full px-4">${card!.outerHTML}</div></div></body></html>`,
        { waitUntil: 'load' },
      )
      const wide = await desktop.evaluate(() => {
        const cardEl = document.querySelector('.overflow-hidden')!
        const roster = [...cardEl.querySelectorAll('table')].find((candidate) =>
          [...candidate.querySelectorAll('th')].some((th) => th.textContent?.trim() === 'Member'),
        )!
        const headers = [...roster.querySelectorAll('th')]
        const actions = headers.find((th) => th.textContent?.trim() === 'Actions')!
        const label = [...actions.querySelectorAll('span')].find((el) => el.textContent?.trim() === 'Actions')!
        const active = [...roster.querySelectorAll('td')].find((td) => td.textContent?.includes('Never seen'))!
        const remove = roster.querySelector('button[aria-label^="Remove "]')!
        const cr = cardEl.getBoundingClientRect()
        const labelBox = label.getBoundingClientRect()
        const actionsBox = actions.getBoundingClientRect()
        const inside = (outer: DOMRect, inner: DOMRect) =>
          inner.width > 8 && inner.height > 0
          && inner.left >= outer.left - 0.5
          && inner.right <= outer.right + 0.5
          && inner.top >= outer.top - 0.5
          && inner.bottom <= outer.bottom + 0.5
        return {
          headers: headers.map((th) => th.textContent?.trim()),
          labelInsideHeader: inside(actionsBox, labelBox),
          labelInsideCard: inside(cr, labelBox),
          activeInsideCard: inside(cr, active.getBoundingClientRect()),
          removeInsideCard: inside(cr, remove.getBoundingClientRect()),
          scrollOverflow: cardEl.scrollWidth - cardEl.clientWidth,
        }
      })
      const wideDetail = JSON.stringify(wide)
      expect(wide.headers, wideDetail).toEqual(['Member', 'Role', 'Active', 'Actions'])
      expect(wide.labelInsideHeader, wideDetail).toBe(true)
      expect(wide.labelInsideCard, wideDetail).toBe(true)
      expect(wide.activeInsideCard, wideDetail).toBe(true)
      expect(wide.removeInsideCard, wideDetail).toBe(true)
      expect(wide.scrollOverflow, wideDetail).toBeLessThanOrEqual(1)
    } finally {
      await browser.close()
    }
  })
})

interface PwPage {
  setContent: (html: string, opts: { waitUntil: 'load' }) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
}
