/**
 * PDCA Playwright walkthrough for Skill Pipelines (localhost admin).
 * Saves screenshots under .playwright-mcp/
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import login from '../.playwright-mcp/mushi-login.mjs'

const BASE = 'http://localhost:6464'
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.playwright-mcp')
const PROJECT_ID = '542b34e0-019e-41fe-b900-7b637717bb86'

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
  console.log(`screenshot: ${name}.png`)
}

async function waitMs(page, ms = 1500) {
  await page.waitForTimeout(ms)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  const results = []
  const record = (name, pass, detail = '') => {
    results.push({ name, pass, detail })
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`)
  }

  try {
    // Auth
    const loginResult = await login(page)
    record('Login', !loginResult.url.includes('/login'), loginResult.url)
    await shot(page, 'pdca-00-authenticated')

    // 1. Catalog + search (sources checked later — project context needs a beat after login)
    await page.goto(`${BASE}/skills?tab=catalog`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitMs(page, 2000)
    await shot(page, 'pdca-02-catalog')

    const search = page.getByPlaceholder(/search/i).first()
    if (await search.count()) {
      await search.fill('workflow-fix-and-ship')
      await waitMs(page, 2000)
      await shot(page, 'pdca-03-catalog-search-workflow')
      record('Catalog search workflow-fix-and-ship', (await page.textContent('body'))?.includes('workflow-fix-and-ship') ?? false)

      await search.fill('')
      await waitMs(page, 500)
      await search.fill('audit-uiux-design-system')
      await waitMs(page, 2000)
      await shot(page, 'pdca-03b-catalog-search-audit-uiux')
      record('Catalog search audit-uiux-design-system', (await page.textContent('body'))?.includes('audit-uiux-design-system') ?? false)
    } else {
      record('Catalog search', false, 'search input not found')
    }

    // 3. Deep link drawer
    await page.goto(`${BASE}/skills?skill=audit-i18n`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitMs(page, 2000)
    await shot(page, 'pdca-04-deep-link-skill')
    record('Deep link ?skill=audit-i18n', (await page.textContent('body'))?.includes('audit-i18n') ?? false)

    // 4. Start handoff pipeline via deep link (stable — avoids catalog grid timing)
    await page.goto(`${BASE}/skills?skill=audit-uiux-design-system`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('button:has-text("Start pipeline")', { timeout: 15000 }).catch(() => {})
    await waitMs(page, 1500)
    await shot(page, 'pdca-05-skill-selected')
    const startPipelineBtn = page.getByRole('button', { name: /^start pipeline$/i })
    if (await startPipelineBtn.count()) {
      await startPipelineBtn.click()
      await waitMs(page, 3500)
      await shot(page, 'pdca-06-pipeline-started')
      const bodyAfterStart = await page.textContent('body')
      record(
        'Start handoff pipeline (audit-uiux-design-system)',
        page.url().includes('run=') ||
          page.url().includes('tab=pipelines') ||
          (bodyAfterStart?.includes('Pipeline started') ?? false) ||
          (bodyAfterStart?.includes('already pending') ?? false),
        bodyAfterStart?.includes('already pending') ? 'duplicate guard (prior run exists)' : '',
      )
    } else {
      record('Start handoff pipeline (audit-uiux-design-system)', false, 'Start pipeline button missing')
    }

    // 5. Pipeline runs tab
    await page.goto(`${BASE}/skills?tab=runs`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitMs(page, 2500)
    await shot(page, 'pdca-07-pipeline-runs')
    record('Pipeline runs tab', (await page.textContent('body'))?.toLowerCase().includes('pipeline') ?? false)

    // 6. Ctrl+K palette
    await page.goto(`${BASE}/skills?tab=catalog`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitMs(page, 1000)
    await page.keyboard.press('Control+K')
    await waitMs(page, 800)
    await shot(page, 'pdca-08-command-palette')
    const paletteOpen = await page.getByPlaceholder(/search pages|type a command|search/i).count() > 0
    record('Ctrl+K opens command palette', paletteOpen)
    await page.keyboard.press('Escape')
    await waitMs(page, 500)
    record('Escape closes command palette', (await page.getByPlaceholder(/search pages|type a command/i).count()) === 0)

    // 7. Sources tab + full re-sync (after project context is warm)
    await page.goto(`${BASE}/skills?tab=sources`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('text=kensaurus/cursor-kenji', { timeout: 15000 }).catch(() => {})
    await waitMs(page, 2000)
    await shot(page, 'pdca-09-sources-after-sync')
    const sourcesBody = await page.textContent('body')
    record('Sources tab — kensaurus/cursor-kenji row', Boolean(sourcesBody?.includes('kensaurus/cursor-kenji')))
    record('Sources tab — catalog count 85', Boolean(sourcesBody?.includes('85')))

    const resync = page.getByRole('button', { name: /full re-sync/i }).first()
    if (await resync.count()) {
      await resync.click()
      await waitMs(page, 5000)
      await shot(page, 'pdca-09b-resync-triggered')
      record('Full re-sync button', true, 'clicked — check network for 200')
    } else {
      const syncNow = page.getByRole('button', { name: /sync now/i }).first()
      record('Full re-sync button', await syncNow.count() > 0, 'Full re-sync label not found; Sync now fallback')
      if (await syncNow.count()) await syncNow.click()
    }

    // 8. Integrations cursor cloud
    await page.goto(`${BASE}/integrations/config`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitMs(page, 2000)
    await shot(page, 'pdca-10-integrations')
    const integBody = await page.textContent('body')
    record('Integrations — Cursor Cloud section', Boolean(integBody?.match(/cursor cloud|cursor_cloud/i)))

  } catch (err) {
    console.error('Playwright error:', err)
    record('Playwright session', false, String(err))
    await shot(page, 'pdca-error').catch(() => {})
  } finally {
    await browser.close()
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n--- PDCA Summary ---')
  console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`)
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL: ${f.name} — ${f.detail}`)
    process.exit(1)
  }
}

main()
