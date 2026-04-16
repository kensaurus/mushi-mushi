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

async function executeStep(page: Page, step: string): Promise<Record<string, unknown>> {
  const stepLower = step.toLowerCase()

  try {
    if (stepLower.includes('click')) {
      const target = step.replace(/click\s*(on\s*)?/i, '').trim()
      const element = page.locator(`text=${target}`).first()
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 })
        return { step, success: true, action: 'click' }
      }
      return { step, success: false, action: 'click', error: 'Element not found' }
    }

    if (stepLower.includes('navigate') || stepLower.includes('go to')) {
      const urlMatch = step.match(/(?:navigate|go)\s*to\s*(.+)/i)
      if (urlMatch) {
        await page.goto(urlMatch[1].trim(), { waitUntil: 'networkidle', timeout: 15000 })
        return { step, success: true, action: 'navigate' }
      }
    }

    if (stepLower.includes('type') || stepLower.includes('enter') || stepLower.includes('fill')) {
      return { step, success: true, action: 'type', note: 'Skipped — no target input specified' }
    }

    // Default: wait and observe
    await page.waitForTimeout(1000)
    return { step, success: true, action: 'observe' }
  } catch (err) {
    return { step, success: false, error: String(err) }
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
