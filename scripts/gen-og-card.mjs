#!/usr/bin/env node
/**
 * gen-og-card.mjs
 *
 * Renders the social preview card (GitHub social preview, og:image for the
 * docs and landing, dev.to cover) from the brand SSOT, so a tagline or license
 * change reaches the image the same way it reaches READMEs and npm:
 *
 *   hero     MUSHI_TAGLINE_V2.hero      "Your AI built it. Mushi Mushi makes it better."
 *   eyebrow  MUSHI_TAGLINE_V2.category
 *   lead     MUSHI_TAGLINE_V2.promise
 *   footer   MUSHI_CANONICAL_URLS.repo · MUSHI_OSS.license
 *   colours  editorialTokens (paper, ink, vermillion), the landing page's palette
 *   art      Field Kenji: his icon (docs/mascot/field-kenji-icon.png) as the
 *            brand stamp, and his wave pose (apps/docs/assets/mascot) beside
 *            the headline (docs/mascot/README.md, "Icon")
 *
 * Output: docs/social-preview/og-card.png at 1200×630 (the size Open Graph,
 * X and LinkedIn crop to), copied to apps/docs/public/social-preview/ where the
 * docs site serves it (scripts/sync-docs-og-card.mjs makes the same copy in the
 * docs prebuild, so a build never ships a stale card; keep both). The file
 * apps/docs/lib/structured-data.ts declares the same size
 * and docs-meta.test.ts reads the PNG header, so change all three together.
 *
 * Text is rendered with the host's fonts (editorialTokens.fontDisplay /
 * fontMono), so re-render on a machine that
 * has Palatino Linotype or Iowan Old Style and look at the result before
 * committing it. GitHub's social preview is uploaded by hand: Settings → Social
 * preview → docs/social-preview/og-card.png.
 *
 * Usage: node scripts/gen-og-card.mjs
 *        node scripts/gen-og-card.mjs --html <file>   write the card's HTML only,
 *          to render with a stored-profile playwright-cli session (the
 *          browser rule forbids a throwaway chromium.launch()), then
 *          `node scripts/gen-og-card.mjs --copy <png>` to install the render.
 */

import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUSHI_CANONICAL_URLS, MUSHI_OSS, MUSHI_TAGLINE_V2, editorialTokens } from '../packages/brand/src/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs/social-preview/og-card.png')
const DOCS_COPY = join(ROOT, 'apps/docs/public/social-preview/og-card.png')
const WIDTH = 1200
const HEIGHT = 630
const STAMP_ART = join(ROOT, 'docs/mascot/field-kenji-icon.png')
const POSE_ART = join(ROOT, 'apps/docs/assets/mascot/mascot-wave.webp')

const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`

const escapeHtml = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** "Your AI built it. Mushi Mushi makes it better." → ["Your AI built it.", "Mushi Mushi makes it better."] */
function splitHero(hero) {
  const cut = hero.indexOf('. ')
  if (cut < 0) return [hero, '']
  return [hero.slice(0, cut + 1), hero.slice(cut + 2)]
}

function html() {
  const { paper, ink, vermillion, fontDisplay, fontMono } = editorialTokens
  const [heroLead, heroPunch] = splitHero(MUSHI_TAGLINE_V2.hero)
  const repo = MUSHI_CANONICAL_URLS.repo.replace(/^https?:\/\//, '')
  const stamp = dataUri(STAMP_ART, 'image/png')
  const pose = dataUri(POSE_ART, 'image/webp')
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    background: ${paper};
    color: ${ink};
    font-family: ${fontDisplay};
    position: relative;
    overflow: hidden;
  }
  .wash {
    position: absolute; inset: 0;
    background:
      radial-gradient(circle at 12% 10%, rgba(224, 60, 44, 0.10), transparent 38%),
      radial-gradient(circle at 92% 20%, rgba(14, 13, 11, 0.05), transparent 40%);
  }
  .frame {
    position: absolute; inset: 64px 80px 56px 80px;
    display: flex; flex-direction: column;
  }
  .brand { display: flex; align-items: center; gap: 22px; }
  .stamp {
    width: 76px; height: 76px; border-radius: 16px; display: block;
    transform: rotate(-3deg);
    box-shadow: 0 3px 10px rgba(139, 26, 14, 0.22);
  }
  .kenji {
    position: absolute; right: 40px; bottom: 104px;
    width: 290px; height: 290px;
  }
  .wordmark { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; }
  .eyebrow {
    margin-top: 6px;
    font-family: ${fontMono}; font-size: 15px; letter-spacing: 0.24em; text-transform: uppercase;
    color: rgba(14, 13, 11, 0.62);
  }
  h1 {
    margin-top: 54px; max-width: 860px;
    font-size: 66px; line-height: 1.04; font-weight: 700; letter-spacing: -0.035em;
  }
  h1 .punch { display: block; color: ${vermillion}; }
  .lead { margin-top: 26px; max-width: 720px; font-size: 30px; line-height: 1.3; color: rgba(14, 13, 11, 0.72); }
  .footer {
    margin-top: auto;
    padding-top: 22px; border-top: 1px solid rgba(14, 13, 11, 0.14);
    font-family: ${fontMono}; font-size: 18px; letter-spacing: 0.02em;
    color: rgba(14, 13, 11, 0.62);
    display: flex; justify-content: space-between;
  }
  .footer strong { color: ${ink}; font-weight: 600; }
</style></head>
<body>
  <div class="wash"></div>
  <img class="kenji" src="${pose}" alt="">
  <div class="frame">
    <div class="brand">
      <img class="stamp" src="${stamp}" alt="">
      <div>
        <div class="wordmark">Mushi Mushi</div>
        <div class="eyebrow">${escapeHtml(MUSHI_TAGLINE_V2.category)}</div>
      </div>
    </div>
    <h1>${escapeHtml(heroLead)}<span class="punch">${escapeHtml(heroPunch)}</span></h1>
    <p class="lead">${escapeHtml(MUSHI_TAGLINE_V2.promise)}.</p>
    <div class="footer"><strong>${escapeHtml(repo)}</strong><span>${escapeHtml(MUSHI_OSS.license)}</span></div>
  </div>
</body></html>`
}

async function main() {
  const htmlAt = process.argv.indexOf('--html')
  if (htmlAt > 0) {
    const file = resolve(process.argv[htmlAt + 1] ?? 'og-card.html')
    writeFileSync(file, html())
    console.log(`[gen-og-card] wrote ${file} (render it at ${WIDTH}×${HEIGHT})`)
    return
  }
  const copyAt = process.argv.indexOf('--copy')
  if (copyAt > 0) {
    const png = resolve(process.argv[copyAt + 1] ?? '')
    mkdirSync(dirname(OUT), { recursive: true })
    copyFileSync(png, OUT)
    mkdirSync(dirname(DOCS_COPY), { recursive: true })
    copyFileSync(OUT, DOCS_COPY)
    console.log(`[gen-og-card] installed ${png} as docs/social-preview/og-card.png and the apps/docs/public copy`)
    return
  }
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
    await page.setContent(html(), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    mkdirSync(dirname(OUT), { recursive: true })
    await page.screenshot({ path: OUT, type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
  } finally {
    await browser.close()
  }
  mkdirSync(dirname(DOCS_COPY), { recursive: true })
  copyFileSync(OUT, DOCS_COPY)
  const kb = (statSync(OUT).size / 1024).toFixed(0)
  console.log(`[gen-og-card] wrote docs/social-preview/og-card.png (${WIDTH}×${HEIGHT}, ${kb} KB) and the apps/docs/public copy`)
}

main().catch((err) => {
  console.error('[gen-og-card] failed:', err)
  process.exit(1)
})
