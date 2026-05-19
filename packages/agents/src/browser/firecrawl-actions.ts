/**
 * FILE: packages/agents/src/browser/firecrawl-actions.ts
 * PURPOSE: Firecrawl Actions browser provider — uses the Firecrawl MCP's
 *          `firecrawl_scrape` with `actions` (click/type/wait/screenshot)
 *          for stories that are primarily content-verification tasks.
 *
 * OVERVIEW:
 * - Sends the story's `prompt` or a parsed `script` as Firecrawl `actions`
 *   (click, type, wait, screenshot) via the Firecrawl API.
 * - Best suited for "does the pricing page show all 4 tiers and a CTA?"
 *   or "is the nav link to /blog visible after login?" assertions.
 * - Returns screenshots from each action step as evidence artefacts.
 * - NOT suitable for complex multi-step flows with file uploads or
 *   nested iframes — use LocalPlaywrightProvider for those.
 *
 * DEPENDENCIES:
 * - @mendable/firecrawl-js (peer dep)
 * - ctx.apiKey = Firecrawl API key (from BYOK firecrawl_actions provider)
 *
 * NOTES:
 * - Firecrawl Actions are a cloud service — no local browser needed.
 * - Script format for this provider is a JSON array of action objects:
 *   [{"type":"click","selector":"#login"},{"type":"screenshot"}]
 * - If `script` is null, the prompt is treated as a natural-language
 *   description and the provider returns a scrape + DOM screenshot.
 */

import type { BrowserProvider, BrowserRunResult, QaStory, BrowserRunContext, EvidenceArtefact } from './types'

interface FirecrawlAction {
  type: 'click' | 'type' | 'wait' | 'screenshot' | 'scroll' | 'navigate'
  selector?: string
  text?: string
  milliseconds?: number
  url?: string
}

export const FirecrawlActionsProvider: BrowserProvider = {
  name: 'firecrawl_actions',

  async run(story: QaStory, ctx: BrowserRunContext): Promise<BrowserRunResult> {
    const startedAt = Date.now()
    const evidence: EvidenceArtefact[] = []

    if (!ctx.apiKey) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        evidence: [],
        assertionFailures: [],
        errorMessage: 'Firecrawl BYOK API key not set. Configure it in Settings → BYOK.',
        summary: 'Firecrawl API key missing.',
      }
    }

    try {
      const { default: FirecrawlApp } = await import('@mendable/firecrawl-js').catch(() => {
        throw new Error('@mendable/firecrawl-js is required. Run: npm install @mendable/firecrawl-js')
      })

      // Never log ctx.apiKey
      const app = new FirecrawlApp({ apiKey: ctx.apiKey })
      const targetUrl = ctx.baseUrl ?? '/'

      // Parse the script as JSON actions if present; otherwise scrape only.
      let actions: FirecrawlAction[] = [{ type: 'screenshot' }]
      if (story.script) {
        try {
          const parsed = JSON.parse(story.script) as FirecrawlAction[]
          if (Array.isArray(parsed)) actions = parsed
        } catch {
          // Script is not JSON — treat as URL + scrape description
          actions = [{ type: 'navigate', url: targetUrl }, { type: 'screenshot' }]
        }
      }

      // Cast to the SDK's ActionOption type — our FirecrawlAction union is
      // a subset and compatible at runtime; the SDK's discriminated union is
      // stricter about 'navigate' which Firecrawl supports as a documented beta.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (app.scrape as (url: string, opts: Record<string, unknown>) => ReturnType<typeof app.scrape>)(targetUrl, {
        formats: ['markdown', 'screenshot'],
        actions,
      })

      let passed = true
      const assertionFailures: BrowserRunResult['assertionFailures'] = []

      // Check for assertion keywords in the prompt
      if (story.prompt && result.markdown) {
        const keywords = story.prompt
          .match(/(?:should|must|expect|verify|check|contains?)\s+["']?([^"'\n]+)["']?/gi) ?? []
        for (const kw of keywords.slice(0, 5)) {
          const term = kw.replace(/^(should|must|expect|verify|check|contains?)\s+/i, '').replace(/["']/g, '').trim()
          if (term && !result.markdown.toLowerCase().includes(term.toLowerCase())) {
            passed = false
            assertionFailures.push({ step: 'content-assertion', expected: term, actual: '(not found in page)' })
          }
        }
      }

      // Collect screenshot from result
      if (result.screenshot) {
        const base64 = result.screenshot.replace(/^data:image\/\w+;base64,/, '')
        evidence.push({
          kind: 'screenshot',
          data: Buffer.from(base64, 'base64'),
          mime: 'image/png',
          stepLabel: 'firecrawl-capture',
        })
      }

      // DOM/markdown as text evidence
      if (result.markdown) {
        evidence.push({
          kind: 'dom',
          data: Buffer.from(result.markdown),
          mime: 'text/markdown',
          stepLabel: 'page-content',
        })
      }

      return {
        status: passed ? 'passed' : 'failed',
        latencyMs: Date.now() - startedAt,
        evidence,
        assertionFailures,
        summary: passed
          ? `"${story.name}" passed via Firecrawl Actions.`
          : `"${story.name}" failed: ${assertionFailures.map((f) => `"${f.expected}" not found`).join(', ')}`,
      }
    } catch (err) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        evidence,
        assertionFailures: [],
        errorMessage: err instanceof Error ? err.message : String(err),
        summary: `Firecrawl error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
}
