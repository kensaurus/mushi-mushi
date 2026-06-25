/**
 * story-mapper — Hybrid agent-driven user-story discovery
 *
 * Step A: Crawl the live app via Firecrawl (cloud, default) or Browserbase
 *         (JS-heavy/auth-gated), capturing routes, DOM summaries, testids,
 *         and screenshots.
 * Step B: Feed crawl results to Claude via withLlmFailover → draft
 *         inventory.yaml (pages[] + user_stories[]) validated against the
 *         inventory schema (up to 3 retries).
 * Step C: (opt-in) Dispatch a Cursor Cloud agent to refine the draft against
 *         repo code and open a PR.
 * Result: Write an inventory_proposals row (source='live_crawl') so the
 *         existing ProposalReviewModal flow handles review + accept.
 *
 * Triggered via POST /v1/admin/inventory/:pid/map-from-live
 */

import { generateText } from 'npm:ai@4'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withLlmFailover } from '../_shared/llm-failover.ts'
import { validateInventoryObject } from '../_shared/inventory.ts'
import { assertSafeOutboundUrl } from '../_shared/inventory-guards.ts'
import { ANTHROPIC_SONNET } from '../_shared/models.ts'
import { createTrace } from '../_shared/observability.ts'
import { tagLangfuseTrace } from '../_shared/sentry.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const log = rootLog.child('story-mapper')

interface MapRequest {
  run_id: string
  project_id: string
  base_url: string
  max_pages?: number
  provider?: 'firecrawl' | 'browserbase'
  cursor_cloud_refine?: boolean
  triggered_by?: string
}

interface CrawledPage {
  url: string
  title: string | null
  markdown: string
  testids: string[]
  apis: string[]
}

interface ProposerOutput {
  inventory: Record<string, unknown>
  rationale_by_story: Record<string, string>
}

function extractFencedJson(text: string): unknown {
  const fence = text.match(/```(?:json|yaml|JSON|YAML)?\s*([\s\S]*?)```/)
  const src = fence ? fence[1]!.trim() : text.trim()
  return JSON.parse(src)
}

async function crawlWithFirecrawl(
  apiKey: string,
  baseUrl: string,
  maxPages: number,
): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = []

  // Step 1: map routes
  const mapRes = await fetch('https://api.firecrawl.dev/v1/map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url: baseUrl, limit: maxPages }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!mapRes.ok) {
    const err = await mapRes.text().catch(() => 'unknown')
    throw new Error(`Firecrawl map failed: HTTP ${mapRes.status} — ${err.slice(0, 200)}`)
  }

  const mapData = await mapRes.json() as { links?: string[] }
  const urls = (mapData.links ?? [baseUrl]).slice(0, maxPages)

  // Step 2: scrape each route
  for (const url of urls) {
    try {
      const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          timeout: 10000,
        }),
        signal: AbortSignal.timeout(20_000),
      })

      if (!scrapeRes.ok) continue

      const scrapeData = await scrapeRes.json() as {
        data?: { markdown?: string; metadata?: { title?: string } }
      }

      const md = scrapeData.data?.markdown ?? ''
      // Extract data-testid attributes from markdown/HTML snippets
      const testids = Array.from(md.matchAll(/data-testid="([^"]+)"/g)).map(m => m[1]!)
      // Extract API-looking paths
      const apis = Array.from(md.matchAll(/(?:\/api\/|\/v\d+\/)[a-zA-Z0-9/_:-]+/g)).map(m => m[0]!)

      pages.push({
        url,
        title: scrapeData.data?.metadata?.title ?? null,
        markdown: md.slice(0, 3000),
        testids: [...new Set(testids)].slice(0, 20),
        apis: [...new Set(apis)].slice(0, 15),
      })
    } catch (err) {
      log.warn('Failed to scrape page', { url, error: String(err).slice(0, 200) })
    }
  }

  return pages
}

function buildProposerPrompt(pages: CrawledPage[], appName: string, baseUrl: string): string {
  const pageLines = pages.map(p => {
    const parts = [`route: ${new URL(p.url).pathname || '/'}`]
    if (p.title) parts.push(`  title: ${JSON.stringify(p.title)}`)
    if (p.testids.length) parts.push(`  testids: ${JSON.stringify(p.testids)}`)
    if (p.apis.length) parts.push(`  apis: ${JSON.stringify(p.apis)}`)
    parts.push(`  content_preview: ${JSON.stringify(p.markdown.slice(0, 500))}`)
    return parts.join('\n')
  })

  return `App: ${appName}
Base URL: ${baseUrl}

CRAWLED PAGES (${pages.length} pages discovered via live crawl):

${pageLines.join('\n\n')}

Produce a complete inventory.yaml as JSON. Requirements:
- schema_version: "2.0"
- app: { id (slug), name, base_url }
- pages: array of page objects, one per route (min 1)
- user_stories: array of user story objects with id (slug), title, goal, persona, pages[] (refs to page ids)
- dependencies: { external: [] }

Wrap output in JSON with keys "inventory" and "rationale_by_story" (story id → reasoning).
Return ONLY the JSON object, optionally fenced with \`\`\`json.`
}

const STORY_MAPPER_SYSTEM = `You are a senior product engineer mapping a live web application into a structured inventory.yaml.

You receive a list of crawled pages with titles, testids, and API endpoints.

From this, you infer:
1. What pages exist and what their purpose is
2. What user stories the app supports (group related pages into coherent flows)
3. What actions users can perform on each page

Rules:
- Use slug-style ids (lowercase, hyphens, no spaces)
- Be specific: "create-invoice" is better than "do-something"  
- Group related pages into one story (e.g. list + detail + create form = one CRUD story)
- Aim for 3-8 user stories from a typical app
- Never fabricate verified_by tests or backend paths not in the evidence`

Deno.serve(
  withSentry(async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-admin') !== '1') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({})) as Partial<MapRequest>

    const { run_id, project_id, base_url, max_pages = 20, provider = 'firecrawl', cursor_cloud_refine = false } = body

    if (!run_id || !project_id || !base_url) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'MISSING_PARAMS', message: 'run_id, project_id, and base_url are required' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const safeUrl = assertSafeOutboundUrl(base_url, {})
    if (!safeUrl.ok) {
      await db.from('story_map_runs').update({
        status: 'failed',
        error: safeUrl.reason ?? 'URL is not allowed for crawling',
        completed_at: new Date().toISOString(),
      }).eq('id', run_id)
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'UNSAFE_URL', message: safeUrl.reason ?? 'URL is not allowed for crawling' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Mark run as running
    await db.from('story_map_runs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', run_id)

    try {
      // === Step A: Crawl ===
      log.info('Starting live crawl', { run_id, base_url, provider, max_pages })

      let pages: CrawledPage[] = []
      const crawlStart = Date.now()

      if (provider === 'firecrawl') {
        const firecrawlKey = await (async () => {
          const { resolveLlmKey } = await import('../_shared/byok.ts')
          const r = await resolveLlmKey(db, project_id, 'firecrawl')
          return r?.key ?? Deno.env.get('FIRECRAWL_API_KEY') ?? ''
        })()

        if (!firecrawlKey) {
          throw new Error('No Firecrawl API key configured. Add one in Settings → API Key Pool.')
        }

        pages = await crawlWithFirecrawl(firecrawlKey, base_url, max_pages)
      } else {
        // Browserbase: create a session and note the replay URL; actual execution
        // needs the CLI runner. For now capture what we can via Firecrawl.
        log.warn('Browserbase provider: falling back to Firecrawl for edge crawl', { run_id })
        const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY') ?? ''
        if (firecrawlKey) {
          pages = await crawlWithFirecrawl(firecrawlKey, base_url, max_pages)
        }
      }

      await db.from('story_map_runs').update({
        pages_crawled: pages.length,
        pages_discovered: pages.length,
      }).eq('id', run_id)

      log.info('Crawl complete', { run_id, pages: pages.length, ms: Date.now() - crawlStart })

      // === Step B: Claude drafts inventory.yaml ===
      // Resolve project name for context
      const { data: project } = await db.from('projects').select('name, slug').eq('id', project_id).single()
      const appName = (project?.name as string | undefined) ?? 'App'
      const prompt = buildProposerPrompt(pages, appName, base_url)

      const trace = createTrace('story-mapper', { run_id, project_id, base_url })
      tagLangfuseTrace(trace.id)
      const llmSpan = trace.span('propose-inventory')

      let proposerOutput: ProposerOutput | null = null
      let lastIssues = ''
      let attempt = 0

      while (attempt < 3 && !proposerOutput) {
        const promptWithRetry = lastIssues
          ? `${prompt}\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${lastIssues}\n\nFix these issues in your response.`
          : prompt

        try {
          const rawText = await withLlmFailover(db, project_id, 'anthropic', async (k) => {
            const anthropic = createAnthropic({ apiKey: k.key })
            const { text } = await generateText({
              model: anthropic(ANTHROPIC_SONNET),
              system: STORY_MAPPER_SYSTEM,
              prompt: promptWithRetry,
              maxTokens: 8000,
            })
            return text
          })

          const parsed = extractFencedJson(rawText) as ProposerOutput
          const inventoryCandidate = parsed?.inventory ?? parsed
          const validated = validateInventoryObject(inventoryCandidate)

          if (validated.ok && validated.inventory) {
            proposerOutput = {
              inventory: inventoryCandidate as Record<string, unknown>,
              rationale_by_story: parsed?.rationale_by_story ?? {},
            }
          } else {
            lastIssues = validated.issues.slice(0, 20).map(i => `${i.path}: ${i.message}`).join('\n')
            log.warn('Inventory validation failed, retrying', { run_id, attempt, issues: lastIssues })
          }
        } catch (err) {
          log.warn('LLM call failed on story-mapper attempt', { run_id, attempt, error: String(err).slice(0, 200) })
          lastIssues = String(err).slice(0, 300)
        }
        attempt++
      }

      if (!proposerOutput) {
        llmSpan.end({ model: ANTHROPIC_SONNET, error: lastIssues.slice(0, 500) })
        await trace.end()
        throw new Error(`Claude could not produce a valid inventory.yaml after ${attempt} attempts. Last issues: ${lastIssues}`)
      }

      llmSpan.end({ model: ANTHROPIC_SONNET })
      await trace.end()

      // === Persist as inventory_proposals (source='live_crawl') ===
      // The inventory_proposals table requires proposed_yaml + proposed_parsed
      // (both NOT NULL); there is no `inventory_yaml` column. JSON is valid
      // YAML, so the accept flow's parseInventoryYaml(proposed_yaml) handles
      // this string. Mirror the shape inventory-propose writes.
      const proposedYaml = JSON.stringify(proposerOutput.inventory, null, 2)
      const { data: proposalRow, error: proposalErr } = await db
        .from('inventory_proposals')
        .insert({
          project_id,
          status: 'draft',
          source: 'live_crawl',
          proposed_yaml: proposedYaml,
          proposed_parsed: proposerOutput.inventory,
          rationale_by_story: proposerOutput.rationale_by_story,
          observation_count: pages.length,
          llm_model: ANTHROPIC_SONNET,
        })
        .select('id')
        .single()

      if (proposalErr) {
        throw new Error(`Failed to save inventory proposal: ${proposalErr.message}`)
      }

      const proposalId = proposalRow!.id

      // === Step C: Cursor Cloud agent (opt-in) ===
      let cursorPrUrl: string | null = null
      if (cursor_cloud_refine) {
        try {
          const { resolveLlmKey } = await import('../_shared/byok.ts')
          const cursorKey = await resolveLlmKey(db, project_id, 'cursor')

          if (cursorKey) {
            const { data: settings } = await db.from('project_settings').select('github_repo_url, cursor_default_model').eq('project_id', project_id).maybeSingle()
            const repoUrl = settings?.github_repo_url as string | undefined

            if (repoUrl) {
              const prompt = `Review the drafted inventory.yaml for this project and refine the user_stories based on the actual codebase. Open a draft PR with your suggested improvements.\n\nDraft inventory:\n${JSON.stringify(proposerOutput.inventory, null, 2).slice(0, 4000)}`

              const agentRes = await fetch('https://api.cursor.com/v0/agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cursorKey.key}` },
                body: JSON.stringify({
                  prompt: { text: prompt },
                  model: settings?.cursor_default_model ?? 'default',
                  source: { repository: repoUrl, ref: 'main' },
                  target: { autoCreatePr: true, branchName: `mushi/story-map-${Date.now()}`, skipReviewerRequest: true },
                }),
              })

              if (agentRes.ok) {
                const agentData = await agentRes.json() as { id?: string; pr?: { url?: string } }
                cursorPrUrl = agentData.pr?.url ?? null
                log.info('Cursor Cloud agent dispatched', { run_id, agentId: agentData.id })
              }
            }
          }
        } catch (err) {
          log.warn('Cursor Cloud refinement failed (non-fatal)', { run_id, error: String(err).slice(0, 200) })
        }
      }

      // Mark run as completed
      await db.from('story_map_runs').update({
        status: 'completed',
        proposal_id: proposalId,
        cursor_pr_url: cursorPrUrl,
        finished_at: new Date().toISOString(),
        crawl_summary: {
          pages_crawled: pages.length,
          stories_proposed: (proposerOutput.inventory as { user_stories?: unknown[] }).user_stories?.length ?? 0,
          pages_proposed: (proposerOutput.inventory as { pages?: unknown[] }).pages?.length ?? 0,
        },
      }).eq('id', run_id)

      log.info('Story mapper completed', { run_id, proposalId, cursorPrUrl })

      return new Response(
        JSON.stringify({ ok: true, data: { proposalId, cursorPrUrl, pagesCrawled: pages.length } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Story mapper failed', { run_id, error: message })

      // PostgREST builders are thenables without `.catch`; await and ignore
      // the resolved error rather than chaining `.catch` (which throws).
      const { error: failErr } = await db.from('story_map_runs').update({
        status: 'failed',
        error_message: message.slice(0, 1000),
        finished_at: new Date().toISOString(),
      }).eq('id', run_id)
      if (failErr) log.warn('failed to mark story_map_run failed', { run_id, error: failErr.message })

      // `message` is recorded server-side (log + story_map_runs.error_message)
      // above; return a generic message so we don't leak internals to the
      // client (CodeQL js/stack-trace-exposure).
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'MAPPER_FAILED', message: 'Story mapping failed. Check the run logs for details.' } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }),
)
