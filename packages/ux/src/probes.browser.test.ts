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

  it('measures overlapping boxes and controls that outgrow their container, not deliberate layers', async () => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
    try {
      await page.setContent(`<!doctype html><html lang="en"><head><style>
  body { font: 16px/20px sans-serif; margin: 16px }
  .row { display: flex; width: 200px; overflow: hidden }
  .row button { flex: none; width: 260px }
  .cards { height: 60px }
  .card { height: 100px; border: 1px solid }
  .narrow { width: 90px; font-size: 16px; line-height: 20px; padding: 4px }
  .stack img { width: 32px; height: 32px; display: inline-block }
  .stack > div { display: inline-block; width: 32px; height: 32px; margin-left: -12px; background: #ccc }
  .badge-host { position: relative; width: 100px; height: 40px }
  .badge { position: absolute; top: 0; right: 0; width: 20px; height: 20px }
  .scroller { display: flex; width: 120px; overflow-x: auto }
  .scroller button { flex: none; width: 200px }
</style></head><body>
  <div class="row"><button>Open in console</button></div>
  <div class="cards" style="display:flex;flex-direction:column;height:60px"><div class="card" style="flex:none">A</div><div class="card" style="flex:none;margin-top:-80px;">B</div></div>
  <div class="cards2"><div class="card" style="height:60px">C</div><div class="card" style="height:60px;position:relative">D</div></div>
  <button class="narrow">Connect your GitHub repository now</button>
  <div class="stack"><div></div><div></div><div></div></div>
  <div class="badge-host"><div style="height:40px">E</div><span class="badge">3</span></div>
  <div class="scroller"><button>Scrolls inside</button></div>
</body></html>`)
      const p = await runProbes(page, [])
      const issues = p.layout ?? []
      const outgrows = issues.filter((i) => i.kind === 'outgrows').map((i) => i.selector)
      expect(outgrows).toContain('button "Open in console"')
      expect(outgrows).toContain('button.narrow "Connect your GitHub repository now"')
      expect(outgrows).not.toContain('button "Scrolls inside"')
      // Negative margins (card B, the avatar stack) and the absolute badge are deliberate.
      expect(issues.filter((i) => i.kind === 'overlap')).toEqual([])
    } finally {
      await page.context().close()
    }
  })

  it('flags in-flow siblings drawn over each other', async () => {
    const page = await (await browser.newContext()).newPage()
    try {
      await page.setContent(`<!doctype html><html lang="en"><body style="margin:16px">
  <div style="display:grid;grid-template-columns:200px 200px;gap:0">
    <div class="tile" style="width:300px;height:80px;background:#eee">glot.it</div>
    <div class="tile" style="height:80px;background:#ddd">yen-yen</div>
  </div>
</body></html>`)
      const p = await runProbes(page, [])
      const overlap = (p.layout ?? []).filter((i) => i.kind === 'overlap')
      expect(overlap).toHaveLength(1)
      expect(overlap[0].selector).toBe('div.tile "yen-yen"')
      expect(overlap[0].detail).toMatch(/^overlaps div\.tile "glot\.it" by 100×80px$/)
    } finally {
      await page.context().close()
    }
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
