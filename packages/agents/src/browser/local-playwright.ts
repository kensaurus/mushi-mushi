/**
 * FILE: packages/agents/src/browser/local-playwright.ts
 * PURPOSE: Local Playwright browser provider — runs the story script in a
 *          headless Chromium launched directly on the current machine.
 *
 * OVERVIEW:
 * - Launches a Chromium browser using `@playwright/test`'s chromium object.
 * - Evaluates the story's script string as an async function body that
 *   receives `{ page, context }` so scripts can be written as plain Playwright
 *   code without any boilerplate.
 * - Captures screenshots at each await point where `page.screenshot()` is
 *   called inside the script, plus a final screenshot on completion/failure.
 * - Returns console logs and a summary as evidence artefacts.
 * - Default provider for self-hosted Mushi instances where Browserbase is
 *   not configured.
 *
 * DEPENDENCIES:
 * - @playwright/test (peer dependency — must be installed in the host project)
 * - BrowserProvider interface from ./types
 *
 * NOTES:
 * - `@playwright/test` is a peer dep to avoid bundling Chromium in every
 *   cloud package. The runner checks availability at startup.
 * - The script is eval'd via `new AsyncFunction(...)` — never run untrusted
 *   scripts; the caller (qa-story-runner edge fn) must validate ownership.
 * - Does NOT work inside Supabase Edge Functions (Deno, no Playwright).
 *   Only used by the CLI / local dev server path.
 */

import type { BrowserProvider, BrowserRunResult, QaStory, BrowserRunContext, EvidenceArtefact } from './types'

export const LocalPlaywrightProvider: BrowserProvider = {
  name: 'local',

  async run(story: QaStory, ctx: BrowserRunContext): Promise<BrowserRunResult> {
    const startedAt = Date.now()
    const evidence: EvidenceArtefact[] = []
    const consoleLogs: string[] = []

    try {
      // Dynamic import so the host project can tree-shake this if Playwright
      // is not installed (only imported when `browserProvider === 'local'`).
      const { chromium } = await import('@playwright/test').catch(() => {
        throw new Error('@playwright/test is required for the local browser provider. Run: npm install -D @playwright/test')
      })

      const browser = await chromium.launch({ headless: true })
      const context = await browser.newContext({
        baseURL: ctx.baseUrl,
        extraHTTPHeaders: ctx.headers,
        ignoreHTTPSErrors: true,
      })
      const page = await context.newPage()

      // Capture console output as evidence
      page.on('console', (msg) => {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`)
      })

      let passed = true
      let errorMessage: string | undefined

      const timeoutMs = ctx.timeoutMs ?? 60_000
      const timeoutHandle = setTimeout(() => {
        passed = false
        errorMessage = `Story timed out after ${timeoutMs}ms`
      }, timeoutMs)

      try {
        if (story.script) {
          // Evaluate the Playwright script with access to page + context.
          // Scripts should be authored as async function bodies:
          //   await page.goto('/pricing')
          //   await expect(page.locator('h1')).toBeVisible()
          const scriptFn = new Function('page', 'context', `return (async () => { ${story.script} })()`);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          await scriptFn(page, context)
        } else {
          // Prompt-only story: navigate to the baseUrl and take a screenshot.
          await page.goto(ctx.baseUrl ?? '/')
        }

        // Final screenshot
        const screenshotBuf = await page.screenshot({ fullPage: true })
        evidence.push({
          kind: 'screenshot',
          data: screenshotBuf,
          mime: 'image/png',
          stepLabel: 'final',
        })
      } catch (err) {
        passed = false
        errorMessage = err instanceof Error ? err.message : String(err)
        // Capture failure screenshot
        try {
          const failBuf = await page.screenshot({ fullPage: true })
          evidence.push({ kind: 'screenshot', data: failBuf, mime: 'image/png', stepLabel: 'failure' })
        } catch {
          // ignore screenshot errors
        }
      } finally {
        clearTimeout(timeoutHandle)
      }

      // Console log evidence
      if (consoleLogs.length > 0) {
        const logText = Buffer.from(consoleLogs.join('\n'))
        evidence.push({ kind: 'console', data: logText, mime: 'text/plain' })
      }

      await browser.close()

      return {
        status: passed ? 'passed' : errorMessage?.includes('timed out') ? 'timeout' : 'failed',
        latencyMs: Date.now() - startedAt,
        evidence,
        assertionFailures: errorMessage ? [{ step: 'script', expected: null, actual: errorMessage }] : [],
        summary: passed ? `Story "${story.name}" passed in ${Date.now() - startedAt}ms.` : `Story "${story.name}" failed: ${errorMessage}`,
        errorMessage,
      }
    } catch (err) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        evidence,
        assertionFailures: [],
        errorMessage: err instanceof Error ? err.message : String(err),
        summary: `Provider error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
}
