// SPDX-License-Identifier: MIT
/**
 * Runs only with MUSHI_UX_BROWSER_TESTS=1 (launches Chromium).
 * Proves the probes skip what is not the app's UI: ignored selectors (axe and
 * tap targets), sr-only skip links, and elements that ignore the pointer.
 * On glot.it an attempt was "kept" for fixing a dev build stamp and an sr-only
 * skip link (2026-10-06); these are the regression tests for that.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { ignoreList, ignoreStyle } from './ignore.js'
import { waitForContent } from './capture.js'
import { runProbes } from './probes.js'

const enabled = process.env.MUSHI_UX_BROWSER_TESTS === '1'

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Probe fixture</title>
<style>
  body { font-family: sans-serif; margin: 24px }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap }
  .tiny { display: inline-block; width: 10px; height: 10px; font-size: 6px }
  .stamp { color: #bbb; background: #fff; font-size: 10px }
</style></head>
<body>
  <a class="sr-only" href="#main">Skip to content</a>
  <main id="main"><h1>Fixture</h1><button style="width:48px;height:48px">OK</button></main>
  <div data-qa-build-stamp class="stamp">build abc123 <button class="tiny">x</button></div>
  <div class="dev-only"><button class="tiny">y</button></div>
  <button class="tiny" style="pointer-events:none" tabindex="-1" aria-hidden="true">z</button>
</body></html>`

describe.skipIf(!enabled)('probes ignore what is not the app', () => {
  let browser: Browser
  beforeAll(async () => {
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser?.close()
  })

  const probe = async (ignore: readonly string[]) => {
    const page = await (await browser.newContext()).newPage()
    try {
      await page.setContent(HTML)
      return await runProbes(page, [], ignore)
    } finally {
      await page.context().close()
    }
  }

  it('counts the stamp and the extra element when nothing is ignored', async () => {
    const p = await probe([])
    // stamp button + .dev-only button; the sr-only link and pointer-events:none button never count.
    expect(p.smallTargets).toBe(2)
    expect(p.axe.some((v) => v.id === 'color-contrast')).toBe(true)
  })

  it('skips default and user selectors in axe and tap targets', async () => {
    const p = await probe(ignoreList(['.dev-only']))
    expect(p.smallTargets).toBe(0)
    expect(p.axe.some((v) => v.id === 'color-contrast')).toBe(false)
  })

  it('drops a selector the browser cannot parse instead of failing', async () => {
    const p = await probe(['[unclosed', '.dev-only'])
    expect(p.smallTargets).toBe(1)
  })

  it('waits for skeleton placeholders marked only by their animation (glot.it /words)', async () => {
    const page = await (await browser.newContext()).newPage()
    try {
      await page.setContent(`<!doctype html><html lang="en"><head><style>@keyframes skeleton-wave { from { opacity: .4 } to { opacity: 1 } }</style></head>
<body><nav>Home · Study · Words · Chat · Account · Search the whole app here</nav>
<main id="m"><div style="height:40px;width:300px;background:#eee;animation:skeleton-wave 1.8s ease-in-out infinite"></div></main>
<script>setTimeout(() => { document.getElementById('m').innerHTML = '<h1>Your word bank</h1>' }, 1200)</script></body></html>`)
      await waitForContent(page, 10_000)
      expect(await page.locator('h1').innerText()).toBe('Your word bank')
    } finally {
      await page.context().close()
    }
  })

  it('hides ignored elements in screenshots without moving the layout', async () => {
    const page = await (await browser.newContext()).newPage()
    try {
      await page.setContent(HTML)
      const before = await page.locator('main').boundingBox()
      await page.screenshot({ style: ignoreStyle(ignoreList()) })
      await page.addStyleTag({ content: ignoreStyle(ignoreList()) })
      expect(await page.locator('[data-qa-build-stamp]').isVisible()).toBe(false)
      expect(await page.locator('main').boundingBox()).toEqual(before)
    } finally {
      await page.context().close()
    }
  })
})
