/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/CopyViewLinkButton.browser.test.tsx
 * PURPOSE: The copy-link button now carries a visible "Copy link" label
 *          (Mushi report 3d5c1f99), so it is wider than the old 28×28 icon.
 *          This proves, in a real browser, that a crowded page header still
 *          fits at narrow widths: the whole button and every neighbouring
 *          action stay inside the header, nothing overlaps, the label is not
 *          clipped and the button's own pixels receive the click.
 *
 * HOW: the real PageHeaderBar (help popover, copy link, three actions) is
 * rendered in jsdom, its markup is loaded into headless Chromium with the
 * admin's own compiled Tailwind CSS (src/index.css through @tailwindcss/vite),
 * and the boxes are measured at each width.
 *
 * Runs only with MUSHI_ADMIN_BROWSER_TESTS=1 (launches Chromium; same gate
 * pattern as packages/ux's *.browser.test.ts), so the default `pnpm test`
 * stays browser-free:
 *   MUSHI_ADMIN_BROWSER_TESTS=1 pnpm --filter @mushi-mushi/admin exec vitest run src/components/CopyViewLinkButton.browser.test.tsx
 * Set MUSHI_ADMIN_BROWSER_CHANNEL=chrome (or msedge) to use an installed
 * browser instead of Playwright's downloaded Chromium.
 */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Browser } from 'playwright'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PageHeaderBar } from './PageHeaderBar'

const enabled = process.env.MUSHI_ADMIN_BROWSER_TESTS === '1'

// The phone widths the header comments name (390px), the smallest common
// phone (320px), the `sm` breakpoint where the actions move onto the title
// row, and a tablet width.
const WIDTHS = [320, 360, 390, 640, 768, 1024]

interface Box {
  name: string
  left: number
  right: number
  top: number
  bottom: number
}

interface Measured {
  header: Box
  headerOverflowX: number
  copy: Box
  copyText: string
  copyLabel: Box
  copyClipped: boolean
  copyHitsSelf: boolean
  actions: Box[]
}

function renderHeaderMarkup(): string {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const action = (label: string) =>
    createElement(
      'button',
      {
        key: label,
        type: 'button',
        className:
          'inline-flex h-7 items-center rounded-md border border-edge-subtle px-2 text-xs whitespace-nowrap',
      },
      label,
    )
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/reports'] },
        createElement(
          PageHeaderBar,
          {
            title: 'Bugs',
            projectScope: 'A fairly long app name',
            helpTitle: 'About bugs',
            helpWhatIsIt: 'Every bug your end-users flagged.',
          },
          action('Updated 2 min ago'),
          action('Filters'),
          action('New report'),
        ),
      ),
    )
  })
  const html = container.innerHTML
  act(() => root.unmount())
  container.remove()
  return html
}

async function compileAdminCss(): Promise<string> {
  const { createServer } = await import('vite')
  const { default: tailwindcss } = await import('@tailwindcss/vite')
  const { resolve } = await import('node:path')
  const server = await createServer({
    configFile: false,
    root: resolve(__dirname, '../..'),
    plugins: [tailwindcss()],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    const mod = (await server.ssrLoadModule('/src/index.css?inline')) as { default: string }
    return mod.default
  } finally {
    await server.close()
  }
}

const overlaps = (a: Box, b: Box) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5

describe.skipIf(!enabled)('copy-link button in a crowded header (real browser)', () => {
  let browser: Browser
  let html = ''
  let css = ''

  beforeAll(async () => {
    html = renderHeaderMarkup()
    css = await compileAdminCss()
    const { chromium } = await import('playwright')
    const channel = process.env.MUSHI_ADMIN_BROWSER_CHANNEL
    browser = await chromium.launch(channel ? { channel } : {})
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  async function measure(width: number): Promise<Measured> {
    const page = await browser.newPage({ viewport: { width, height: 800 } })
    try {
      await page.setContent(
        `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><style>${css}</style></head>` +
          `<body style="margin:0"><main style="padding:0 12px">${html}</main></body></html>`,
      )
      return await page.evaluate(() => {
        const box = (el: Element, name: string) => {
          const r = el.getBoundingClientRect()
          return { name, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
        }
        const header = document.querySelector('[data-page-header]')!
        const copy = document.querySelector('button[aria-label="Copy link to this filtered view"]') as HTMLElement
        const label = copy.querySelector('span')!
        const r = copy.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        const actions = [...header.querySelectorAll('button, a')]
          .filter((el) => el !== copy)
          .map((el) => box(el, el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName))
        return {
          header: box(header, 'header'),
          headerOverflowX: header.scrollWidth - header.clientWidth,
          copy: box(copy, 'copy link'),
          copyText: copy.innerText.trim(),
          copyLabel: box(label, 'label'),
          copyClipped: copy.scrollWidth > copy.clientWidth || copy.scrollHeight > copy.clientHeight,
          copyHitsSelf: hit !== null && copy.contains(hit),
          actions,
        }
      })
    } finally {
      await page.close()
    }
  }

  it.each(WIDTHS)('at %ipx the whole header fits and every action stays usable', async (width) => {
    const m = await measure(width)

    expect(m.headerOverflowX, 'header scrolls sideways').toBeLessThanOrEqual(0)

    // The labelled button: visible, whole, one line, a full 28px target.
    expect(m.copyText).toBe('Copy link')
    expect(m.copyClipped, 'label clipped inside the button').toBe(false)
    expect(m.copy.bottom - m.copy.top).toBeGreaterThanOrEqual(28)
    expect(m.copy.right - m.copy.left).toBeGreaterThanOrEqual(m.copyLabel.right - m.copyLabel.left + 16)
    expect(m.copy.left).toBeGreaterThanOrEqual(m.header.left - 0.5)
    expect(m.copy.right).toBeLessThanOrEqual(m.header.right + 0.5)
    expect(m.copyHitsSelf, 'something covers the copy-link button').toBe(true)

    // Every neighbouring action (help, the three page actions) stays inside
    // the header and none of them overlaps another or the copy-link button.
    expect(m.actions.length).toBeGreaterThanOrEqual(4)
    const all = [m.copy, ...m.actions]
    for (const a of m.actions) {
      expect(a.left, `${a.name} left`).toBeGreaterThanOrEqual(m.header.left - 0.5)
      expect(a.right, `${a.name} right`).toBeLessThanOrEqual(m.header.right + 0.5)
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i], all[j]), `${all[i].name} overlaps ${all[j].name}`).toBe(false)
      }
    }
  })
})
