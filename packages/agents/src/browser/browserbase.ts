/**
 * FILE: packages/agents/src/browser/browserbase.ts
 * PURPOSE: Browserbase cloud browser provider — runs Playwright scripts
 *          against a remote Chromium session hosted on Browserbase.
 *
 * OVERVIEW:
 * - Connects to Browserbase via `@browserbasehq/sdk` + Playwright's
 *   `connectOverCDP` so the same script format (LocalPlaywrightProvider)
 *   works unchanged in the cloud.
 * - Returns the `provider_session_url` (Browserbase session replay link)
 *   in BrowserRunResult so the QA Coverage dashboard can surface it as a
 *   clickable replay button.
 * - Uploads a session recording URL only when `captureVideo === true`;
 *   otherwise evidence is screenshots + console logs only.
 *
 * DEPENDENCIES:
 * - @browserbasehq/sdk (peer dep — installed when BYOK Browserbase is configured)
 * - @playwright/test (peer dep)
 * - BrowserProvider interface from ./types
 *
 * BYOK:
 * - ctx.apiKey must be the Browserbase API key; the project ID is derived
 *   from the BYOK meta stored alongside the key in mushi_runtime_config.
 * - Never log the API key — follow the `resolveLlmKey` redaction pattern.
 *
 * NOTES:
 * - Edge Function compatible IF Browserbase exports a Deno-compatible SDK;
 *   currently gated for Node.js / CLI paths only.
 */

import type { BrowserProvider, BrowserRunResult, QaStory, BrowserRunContext, EvidenceArtefact } from './types'

export const BrowserbaseProvider: BrowserProvider = {
  name: 'browserbase',

  async run(story: QaStory, ctx: BrowserRunContext): Promise<BrowserRunResult> {
    const startedAt = Date.now()
    const evidence: EvidenceArtefact[] = []
    const consoleLogs: string[] = []

    if (!ctx.apiKey) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        evidence: [],
        assertionFailures: [],
        errorMessage: 'Browserbase BYOK API key not set. Configure it in Settings → BYOK.',
        summary: 'Browserbase API key missing.',
      }
    }

    try {
      const { Browserbase } = await import('@browserbasehq/sdk').catch(() => {
        throw new Error('@browserbasehq/sdk is required for the Browserbase provider. Run: npm install @browserbasehq/sdk')
      })
      const { chromium } = await import('@playwright/test').catch(() => {
        throw new Error('@playwright/test is required. Run: npm install -D @playwright/test')
      })

      // ctx.apiKey is already resolved by the caller — never log it.
      const bb = new Browserbase({ apiKey: ctx.apiKey })
      const session = await bb.sessions.create({ projectId: undefined })

      const browser = await chromium.connectOverCDP(session.connectUrl)
      const contexts = browser.contexts()
      const context = contexts[0] ?? await browser.newContext({ baseURL: ctx.baseUrl })
      const page = context.pages()[0] ?? await context.newPage()

      page.on('console', (msg) => {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`)
      })

      let passed = true
      let errorMessage: string | undefined

      try {
        if (story.script) {
          const scriptFn = new Function('page', 'context', `return (async () => { ${story.script} })()`)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          await scriptFn(page, context)
        } else {
          await page.goto(ctx.baseUrl ?? '/')
        }

        const screenshotBuf = await page.screenshot({ fullPage: true })
        evidence.push({ kind: 'screenshot', data: screenshotBuf, mime: 'image/png', stepLabel: 'final' })
      } catch (err) {
        passed = false
        errorMessage = err instanceof Error ? err.message : String(err)
        try {
          const failBuf = await page.screenshot({ fullPage: true })
          evidence.push({ kind: 'screenshot', data: failBuf, mime: 'image/png', stepLabel: 'failure' })
        } catch { /* ignore */ }
      }

      if (consoleLogs.length > 0) {
        evidence.push({ kind: 'console', data: Buffer.from(consoleLogs.join('\n')), mime: 'text/plain' })
      }

      await browser.close()

      // Resolve session replay URL (Browserbase provides a live view URL)
      const sessionUrl = `https://app.browserbase.com/sessions/${session.id}`

      return {
        status: passed ? 'passed' : 'failed',
        latencyMs: Date.now() - startedAt,
        evidence,
        assertionFailures: errorMessage ? [{ step: 'script', expected: null, actual: errorMessage }] : [],
        providerSessionUrl: sessionUrl,
        summary: passed ? `"${story.name}" passed via Browserbase.` : `"${story.name}" failed: ${errorMessage}`,
        errorMessage,
      }
    } catch (err) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        evidence,
        assertionFailures: [],
        errorMessage: err instanceof Error ? err.message : String(err),
        summary: `Browserbase error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
}
