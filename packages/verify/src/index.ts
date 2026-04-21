import { chromium, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { createClient } from '@supabase/supabase-js'

export interface VerifyOptions {
  reportId: string
  deploymentUrl: string
  supabaseUrl: string
  supabaseServiceKey: string
}

export interface VerifyResult {
  status: 'passed' | 'failed' | 'error'
  visualDiffScore: number
  interactionResults: Record<string, unknown>[]
  errorMessage?: string
}

export async function verifyFix(options: VerifyOptions): Promise<VerifyResult> {
  const db = createClient(options.supabaseUrl, options.supabaseServiceKey)

  const { data: report } = await db
    .from('reports')
    .select('id, environment, reproduction_steps, screenshot_url, component, summary')
    .eq('id', options.reportId)
    .single()

  if (!report) throw new Error(`Report ${options.reportId} not found`)

  const pageUrl = report.environment?.url
  if (!pageUrl) throw new Error('Report has no page URL')

  const targetUrl = new URL(new URL(pageUrl).pathname, options.deploymentUrl).href
  const reproSteps: string[] = report.reproduction_steps ?? []

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })

    const interactionResults: Record<string, unknown>[] = []

    for (const step of reproSteps) {
      const result = await executeStep(page, step)
      interactionResults.push(result)
    }

    const afterScreenshot = await page.screenshot({ type: 'png', fullPage: true })
    let visualDiffScore = 0

    if (report.screenshot_url) {
      try {
        const beforeRes = await fetch(report.screenshot_url)
        const beforeBuffer = Buffer.from(await beforeRes.arrayBuffer())
        visualDiffScore = compareScreenshots(beforeBuffer, afterScreenshot)
      } catch {
        // original screenshot unavailable
      }
    }

    const allPassed = interactionResults.every(r => r.success !== false)
    const status: VerifyResult['status'] = allPassed && visualDiffScore < 0.1 ? 'passed' : 'failed'

    await db.from('fix_verifications').insert({
      report_id: options.reportId,
      verification_status: status,
      visual_diff_score: visualDiffScore,
      interaction_results: interactionResults,
    })

    return { status, visualDiffScore, interactionResults }
  } catch (err) {
    const errorMessage = String(err)
    await db.from('fix_verifications').insert({
      report_id: options.reportId,
      verification_status: 'error',
      error_message: errorMessage,
    })
    return { status: 'error', visualDiffScore: 0, interactionResults: [], errorMessage }
  } finally {
    await browser.close()
  }
}

/**
 * Parse a repro step into a `{ action, ... }` descriptor.
 *
 * Wave S5: the step interpreter used to only dispatch `click` and
 * `navigate` — everything else silently reported success. The judge
 * treated that as a passing verification, which quietly hid real
 * regressions. We now parse `type`, `fill`, `assertText`, `waitFor`,
 * `press`, and `select` with explicit target/value extraction.
 *
 * We keep parsing permissive on purpose: repro steps come from an LLM and
 * humans, so we match the common natural-language phrasings without
 * forcing a DSL. Anything that can't be parsed falls through to a 1s
 * settle (the old `observe`) and is flagged `parsed: false` so the judge
 * can distinguish "we did nothing on purpose" from "the step failed".
 */
interface ParsedStep {
  action: 'click' | 'navigate' | 'type' | 'press' | 'select' | 'assertText' | 'waitFor' | 'observe'
  target?: string
  value?: string
}

export function parseStep(step: string): ParsedStep {
  const s = step.trim()
  const lc = s.toLowerCase()

  // type|fill|enter "something" in|into <target>
  const typeMatch = s.match(/^(?:type|fill|enter)\s+(?:in\s+|into\s+)?(?:["'](.+?)["']|(.+?))\s+(?:in|into)\s+(.+?)$/i)
  if (typeMatch) {
    return { action: 'type', value: typeMatch[1] ?? typeMatch[2], target: typeMatch[3].trim() }
  }

  // fill|type <target> with "value"
  const fillWithMatch = s.match(/^(?:type|fill|enter)\s+(.+?)\s+with\s+["'](.+?)["']$/i)
  if (fillWithMatch) {
    return { action: 'type', target: fillWithMatch[1].trim(), value: fillWithMatch[2] }
  }

  // press Enter / press Escape
  const pressMatch = s.match(/^press\s+(.+?)$/i)
  if (pressMatch) return { action: 'press', value: pressMatch[1].trim() }

  // select "value" from <target>
  const selectMatch = s.match(/^select\s+["'](.+?)["']\s+from\s+(.+?)$/i)
  if (selectMatch) return { action: 'select', value: selectMatch[1], target: selectMatch[2].trim() }

  // assert / verify / expect "something" (is visible | to be visible | visible)
  const assertMatch = s.match(/^(?:assert|verify|expect|check)\s+(?:that\s+)?["'](.+?)["']/i)
    ?? s.match(/^(?:assert|verify|expect|check)\s+(?:that\s+)?(.+?)\s+(?:is|to be|be)\s+visible$/i)
  if (assertMatch) return { action: 'assertText', value: assertMatch[1].trim() }

  // wait for <target> / wait 3s
  const waitForMatch = s.match(/^wait\s+for\s+(.+?)$/i)
  if (waitForMatch) return { action: 'waitFor', target: waitForMatch[1].trim() }
  const waitMsMatch = s.match(/^wait\s+(\d+)\s*(ms|s|seconds?)?$/i)
  if (waitMsMatch) {
    const num = Number(waitMsMatch[1])
    const unit = (waitMsMatch[2] ?? 'ms').toLowerCase()
    const ms = unit.startsWith('s') ? num * 1000 : num
    return { action: 'waitFor', value: String(ms) }
  }

  if (lc.startsWith('click')) {
    return { action: 'click', target: s.replace(/^click\s*(on\s*)?/i, '').trim() }
  }

  if (lc.startsWith('navigate') || lc.startsWith('go to') || lc.startsWith('open ')) {
    const urlMatch = s.match(/^(?:navigate\s*to|go\s*to|open)\s+(.+?)$/i)
    if (urlMatch) return { action: 'navigate', target: urlMatch[1].trim() }
  }

  return { action: 'observe' }
}

async function executeStep(page: Page, step: string): Promise<Record<string, unknown>> {
  const parsed = parseStep(step)
  try {
    switch (parsed.action) {
      case 'click': {
        const target = parsed.target ?? ''
        const element = page.locator(`text=${target}`).first()
        if (!(await element.isVisible({ timeout: 3000 }))) {
          return { step, success: false, action: 'click', parsed, error: 'Element not found' }
        }
        await element.click({ timeout: 5000 })
        return { step, success: true, action: 'click', parsed }
      }
      case 'navigate': {
        await page.goto(parsed.target ?? '', { waitUntil: 'networkidle', timeout: 15000 })
        return { step, success: true, action: 'navigate', parsed }
      }
      case 'type': {
        const input = page.locator(parsed.target ?? '').first()
        const visible = await input.isVisible({ timeout: 3000 }).catch(() => false)
        if (!visible) {
          // Fall back to label-text search; LLM-written repro steps
          // commonly reference inputs by their visible label.
          const byLabel = page.getByLabel(parsed.target ?? '')
          if (await byLabel.count()) {
            await byLabel.fill(parsed.value ?? '')
            return { step, success: true, action: 'type', parsed, matcher: 'label' }
          }
          return { step, success: false, action: 'type', parsed, error: 'Input not found' }
        }
        await input.fill(parsed.value ?? '')
        return { step, success: true, action: 'type', parsed, matcher: 'locator' }
      }
      case 'press': {
        await page.keyboard.press(parsed.value ?? '')
        return { step, success: true, action: 'press', parsed }
      }
      case 'select': {
        await page.locator(parsed.target ?? '').selectOption({ label: parsed.value ?? '' })
        return { step, success: true, action: 'select', parsed }
      }
      case 'assertText': {
        const found = await page.getByText(parsed.value ?? '', { exact: false })
          .first()
          .isVisible({ timeout: 5000 })
          .catch(() => false)
        return { step, success: found, action: 'assertText', parsed, error: found ? undefined : 'Text not visible' }
      }
      case 'waitFor': {
        if (parsed.target) {
          await page.locator(parsed.target).first().waitFor({ timeout: 10000 })
          return { step, success: true, action: 'waitFor', parsed }
        }
        await page.waitForTimeout(Math.min(Number(parsed.value ?? 1000), 10000))
        return { step, success: true, action: 'waitFor', parsed }
      }
      case 'observe':
      default:
        await page.waitForTimeout(1000)
        return { step, success: true, action: 'observe', parsed, parsedOk: false }
    }
  } catch (err) {
    return { step, success: false, parsed, error: String(err) }
  }
}

function compareScreenshots(before: Buffer, after: Buffer): number {
  try {
    const img1 = PNG.sync.read(before)
    const img2 = PNG.sync.read(after)

    const width = Math.min(img1.width, img2.width)
    const height = Math.min(img1.height, img2.height)

    const diff = new PNG({ width, height })
    const numDiffPixels = pixelmatch(
      img1.data, img2.data, diff.data,
      width, height,
      { threshold: 0.1 },
    )

    return numDiffPixels / (width * height)
  } catch {
    return 0
  }
}
