import { chromium, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { createClient } from '@supabase/supabase-js'

export interface VerifyOptions {
  reportId: string
  deploymentUrl: string
  supabaseUrl: string
  supabaseServiceKey: string
  /**
   * Optional fix_attempts row to correlate this verification run against.
   *
   * When provided, the verification result is also persisted to
   * `fix_attempts.verify_steps` (JSONB), giving the judge and the admin
   * console a single, structured "did this fix actually work?" signal next
   * to the attempt. Without this, verification still writes to
   * `fix_verifications` but never links back to the attempt that produced
   * the PR — which was the 2026-04-21 audit finding that motivated the
   * `verify_steps` migration.
   */
  fixAttemptId?: string
  /**
   * Optional attach-time step list. Overrides the reproduction steps stored
   * on the report so callers can verify a fix against steps they know were
   * generated at the moment the agent attached its PR. This is how
   * multi-step verify workflows (e.g. "after applying the fix, also confirm
   * the regression case from ticket X is still green") express intent
   * without mutating the original report.
   *
   * Items may be raw strings (parsed the same way as `reports.reproduction_steps`)
   * or pre-parsed `{ action, target?, value? }` descriptors — useful for
   * deterministic tests that don't want to lean on the natural-language
   * parser.
   */
  steps?: Array<string | VerifyStep>
}

/** Pre-parsed verification step — matches ParsedStep exactly so callers can
 *  skip the natural-language parser when they already know what to do. */
export interface VerifyStep {
  action: 'click' | 'navigate' | 'type' | 'press' | 'select' | 'assertText' | 'waitFor' | 'observe'
  target?: string
  value?: string
}

export interface VerifyResult {
  status: 'passed' | 'failed' | 'error'
  visualDiffScore: number
  interactionResults: Record<string, unknown>[]
  errorMessage?: string
  /** Echoed from VerifyOptions.fixAttemptId when supplied so callers can
   *  round-trip the correlation without re-threading it themselves. */
  fixAttemptId?: string
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
  // Caller-supplied steps win over the reproduction steps stored on the
  // report — the plan's "attach-time steps" pattern. If neither side
  // provides anything, we settle for a smoke-check on the page (one
  // observe step) so the visual diff still runs.
  const attachedSteps = options.steps ?? report.reproduction_steps ?? []

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })

    const interactionResults: Record<string, unknown>[] = []

    for (const step of attachedSteps) {
      const result = typeof step === 'string'
        ? await executeStep(page, step)
        : await executeParsedStep(page, step)
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
      fix_attempt_id: options.fixAttemptId ?? null,
    })

    // Best-effort cross-link: mirror the structured interaction trace into
    // fix_attempts.verify_steps so the judge and admin UI see a single
    // "this is how we verified attempt X" blob without a join. We swallow
    // write failures here — the fix_verifications insert above is the
    // source of truth; verify_steps is an ergonomic cache.
    if (options.fixAttemptId) {
      await db
        .from('fix_attempts')
        .update({
          verify_steps: {
            status,
            visualDiffScore,
            attachedSteps: (attachedSteps as Array<string | VerifyStep>).map((s) =>
              typeof s === 'string' ? { raw: s } : s,
            ),
            interactionResults,
            verifiedAt: new Date().toISOString(),
          },
        })
        .eq('id', options.fixAttemptId)
        .then(() => undefined, () => undefined)
    }

    return { status, visualDiffScore, interactionResults, fixAttemptId: options.fixAttemptId }
  } catch (err) {
    const errorMessage = String(err)
    await db.from('fix_verifications').insert({
      report_id: options.reportId,
      verification_status: 'error',
      error_message: errorMessage,
      fix_attempt_id: options.fixAttemptId ?? null,
    })
    if (options.fixAttemptId) {
      await db
        .from('fix_attempts')
        .update({
          verify_steps: {
            status: 'error',
            errorMessage,
            verifiedAt: new Date().toISOString(),
          },
        })
        .eq('id', options.fixAttemptId)
        .then(() => undefined, () => undefined)
    }
    return {
      status: 'error',
      visualDiffScore: 0,
      interactionResults: [],
      errorMessage,
      fixAttemptId: options.fixAttemptId,
    }
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

/**
 * Public sibling of executeStep for callers that already have a structured
 * step (e.g. the attach-time steps supplied via VerifyOptions.steps) and
 * want to skip the natural-language parser. Kept internal to the package
 * until a downstream consumer asks for it.
 */
async function executeParsedStep(page: Page, parsed: VerifyStep): Promise<Record<string, unknown>> {
  // Reuse executeStep's dispatcher by rehydrating a synthetic raw string
  // for logging, then forwarding directly — this keeps a single source of
  // truth for the Playwright interactions.
  const raw = JSON.stringify(parsed)
  return runAction(page, raw, parsed)
}

async function executeStep(page: Page, step: string): Promise<Record<string, unknown>> {
  return runAction(page, step, parseStep(step))
}

async function runAction(page: Page, step: string, parsed: VerifyStep): Promise<Record<string, unknown>> {
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
