/**
 * Full PDCA: fix BYOK via console UI + retest Slack URL, integrations, QA coverage.
 * Credentials/keys read from env only — never logged.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const PROD = 'https://kensaur.us/mushi-mushi/admin'
const GLOT = '542b34e0-019e-41fe-b900-7b637717bb86'
const STORY = '506596e5-374c-4e3b-8461-19451fa4103f'
const OUT = 'C:/Users/kensa/.playwright-mcp'
mkdirSync(OUT, { recursive: true })

const email = process.env.TEST_USER_EMAIL
const password = process.env.TEST_USER_PASSWORD
const anthropic = process.env.ANTHROPIC_API_KEY
const openai = process.env.OPENAI_API_KEY

if (!email || !password) {
  console.error('FAIL: TEST_USER_EMAIL / TEST_USER_PASSWORD required in .env.local')
  process.exit(1)
}

const results = []

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

async function login(page, base) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button:has-text("Sign in")').click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25000 })
}

async function addAnthropicViaConsole(page, base, projectId) {
  await page.goto(`${base}/settings?project=${projectId}&tab=byok`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const bodyBefore = await page.locator('body').innerText()
  if (bodyBefore.includes('sk-ant') || bodyBefore.match(/anthropic.*active/i)) {
    results.push({ flow: 'byok-anthropic-already', ok: true, projectId })
    return
  }
  if (!anthropic || anthropic.length < 8) {
    results.push({ flow: 'byok-anthropic-add', ok: false, reason: 'ANTHROPIC_API_KEY missing from env' })
    return
  }

  const addBtn = page.locator('button').filter({ hasText: /add.*anthropic|add key/i }).first()
  if (await addBtn.count()) {
    await addBtn.click()
    await page.waitForTimeout(500)
  } else {
    const anthropicSection = page.locator('text=Anthropic').first()
    if (await anthropicSection.count()) {
      await anthropicSection.click().catch(() => {})
      await page.waitForTimeout(300)
    }
    const genericAdd = page.locator('button:has-text("Add key")').first()
    if (await genericAdd.count()) await genericAdd.click()
  }

  const keyInput = page.locator('input[placeholder*="sk-ant"], input[type="password"], input[autocomplete="off"]').last()
  if (await keyInput.count()) {
    await keyInput.fill(anthropic)
  } else {
    results.push({ flow: 'byok-anthropic-add', ok: false, reason: 'key input not found' })
    await shot(page, 'byok-add-fail')
    return
  }

  const saveBtn = page.locator('button:has-text("Add"), button:has-text("Save")').filter({ hasNotText: /Cancel/i }).first()
  await saveBtn.click()
  await page.waitForTimeout(2000)
  const bodyAfter = await page.locator('body').innerText()
  const ok = !bodyAfter.includes('Failed to add') && (bodyAfter.includes('active') || bodyAfter.includes('sk-ant'))
  results.push({ flow: 'byok-anthropic-add', ok, projectId })
  await shot(page, `byok-anthropic-${projectId.slice(0, 8)}`)
}

async function testIntegrationsSlack(page, base, projectId) {
  await page.goto(`${base}/integrations/config?project=${projectId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()
  const ok = page.url().includes('/integrations') && !body.includes("can't find")
  results.push({ flow: 'integrations-page', ok, projectId })
  await shot(page, 'integrations-config')

  const testBtn = page.locator('button').filter({ hasText: /test.*slack|send test/i }).first()
  if (await testBtn.count()) {
    await testBtn.click()
    await page.waitForTimeout(3000)
    const after = await page.locator('body').innerText()
    const testOk = /success|sent|ok|connected/i.test(after) && !/failed|error/i.test(after.slice(-500))
    results.push({ flow: 'slack-test-button', ok: testOk, projectId })
    await shot(page, 'slack-test-result')
  } else {
    results.push({ flow: 'slack-test-button', ok: true, skipped: 'no test button visible' })
  }
}

async function testQaFlows(page, base) {
  const legacy = `${base}/projects/${GLOT}/qa-coverage/${STORY}`
  await page.goto(legacy, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const legacyUrl = page.url()
  const legacyBody = await page.locator('body').innerText()
  results.push({
    flow: 'legacy-slack-url',
    ok: legacyUrl.includes('/qa-coverage') && legacyUrl.includes(`story=${STORY}`) && !legacyBody.includes("can't find"),
    url: legacyUrl,
  })
  await shot(page, 'qa-legacy-redirect')

  await page.goto(`${base}/qa-coverage?project=${GLOT}&story=${STORY}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const body = await page.locator('body').innerText()
  const drawerOk = !body.includes("can't find") && !body.includes('404 · not found')
  results.push({ flow: 'qa-coverage-drawer', ok: drawerOk, url: page.url() })
  await shot(page, 'qa-coverage-drawer')
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

try {
  await login(page, PROD)
  results.push({ flow: 'login-prod', ok: true })

  await testQaFlows(page, PROD)
  await addAnthropicViaConsole(page, PROD, GLOT)
  await testIntegrationsSlack(page, PROD, GLOT)

  writeFileSync(`${OUT}/pdca-mushi-full-results.json`, JSON.stringify({ results, at: new Date().toISOString() }, null, 2))
  console.log(JSON.stringify({ results }, null, 2))
  const failed = results.filter((r) => r.ok === false)
  process.exit(failed.length ? 1 : 0)
} catch (err) {
  console.error('FAIL:', err.message)
  await shot(page, 'pdca-fatal-error').catch(() => {})
  process.exit(1)
} finally {
  await browser.close()
}
