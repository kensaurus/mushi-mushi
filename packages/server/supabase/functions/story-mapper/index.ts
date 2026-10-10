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

import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withLlmFailover, WalletDeniedError } from '../_shared/llm-failover.ts'
import { validateInventoryObject } from '../_shared/inventory.ts'
import { assertSafeOutboundUrl } from '../_shared/inventory-guards.ts'
import { pickCrawlUrls } from '../_shared/crawl-urls.ts'
import { firecrawlMap, firecrawlScrapeOwnSite } from '../_shared/firecrawl.ts'
import { STORY_MAP_EFFORT, STORY_MAP_MODEL, THINKING_HEADROOM_TOKENS } from '../_shared/models.ts'
import { claudeGenerateText } from '../_shared/claude-messages.ts'
import { withLlmUsage } from '../_shared/llm-usage.ts'
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

/**
 * Map the app, pick distinct pages, scrape each. Goes through the shared
 * Firecrawl client: the project's key (own or shared), usage bookkeeping,
 * the 24h cache and API v2. The app's own host is trusted: the user typed
 * this URL into the crawl form and assertSafeOutboundUrl already passed it.
 */
async function crawlWithFirecrawl(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  baseUrl: string,
  maxPages: number,
): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = []
  const trustedHosts = [new URL(baseUrl).hostname]

  // More links than pages: language copies and files are dropped below.
  const links = await firecrawlMap(db, projectId, baseUrl, { limit: Math.min(maxPages * 5, 200), trustedHosts })
  const urls = pickCrawlUrls(links, baseUrl, maxPages)

  for (const url of urls) {
    try {
      const page = await firecrawlScrapeOwnSite(db, projectId, url, baseUrl)
      const md = page.markdown ?? ''
      // data-testid attributes and API-looking paths in the page
      const testids = Array.from(md.matchAll(/data-testid="([^"]+)"/g)).map(m => m[1]!)
      const apis = Array.from(md.matchAll(/(?:\/api\/|\/v\d+\/)[a-zA-Z0-9/_:-]+/g)).map(m => m[0]!)
      pages.push({
        url,
        title: page.title ?? null,
        markdown: md.slice(0, 3000),
        testids: [...new Set(testids)].slice(0, 20),
        apis: [...new Set(apis)].slice(0, 15),
      })
    } catch (err) {
      // A missing key or a rejected key fails the whole run; one bad page does not.
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'FIRECRAWL_NOT_CONFIGURED' || msg === 'FIRECRAWL_AUTH_FAILED') throw err
      log.warn('Failed to scrape page', { url, error: msg.slice(0, 200) })
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
    if (authErr) return authErr

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

      if (provider !== 'firecrawl') {
        // Browserbase needs the CLI runner for a real session; the edge crawl
        // uses Firecrawl either way.
        log.warn('Browserbase provider: falling back to Firecrawl for edge crawl', { run_id })
      }
      try {
        pages = await crawlWithFirecrawl(db, project_id, base_url, max_pages)
      } catch (err) {
        if (err instanceof Error && err.message === 'FIRECRAWL_NOT_CONFIGURED') {
          throw new Error('No Firecrawl key. Add one in Settings → AI keys (it can be shared with all your apps).')
        }
        throw err
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
          const completion = await withLlmFailover(
            db,
            project_id,
            'anthropic',
            async (k) => {
              const { text, usage } = await withLlmUsage(
                db,
                {
                  functionName: 'story-mapper',
                  stage: 'map-inventory',
                  projectId: project_id,
                  model: STORY_MAP_MODEL,
                  keySource: k.source,
                  langfuseTraceId: trace.id,
                  // Billed before (withLlmFailover meter); keeps that debit.
                  billHosted: true,
                },
                () => claudeGenerateText({
                  apiKey: k.key,
                  model: STORY_MAP_MODEL,
                  effort: STORY_MAP_EFFORT,
                  system: STORY_MAPPER_SYSTEM,
                  prompt: promptWithRetry,
                  // 8k of inventory JSON plus room for adaptive thinking.
                  maxTokens: 8000 + THINKING_HEADROOM_TOKENS,
                }),
              )
              return { text, usage }
            },
            // No `meter`: withLlmUsage writes an llm_invocations row, and
            // logLlmInvocation takes the hosted-key debit. Passing both would
            // charge the call twice.
          )

          const parsed = extractFencedJson(completion.text) as ProposerOutput
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
          // A wallet refusal is not a retryable model failure — retrying only
          // hits the bridge again and would stringify away `reason` /
          // `balanceMicro`, which the caller needs to prompt a top-up.
          if (err instanceof WalletDeniedError) throw err
          log.warn('LLM call failed on story-mapper attempt', { run_id, attempt, error: String(err).slice(0, 200) })
          lastIssues = String(err).slice(0, 300)
        }
        attempt++
      }

      if (!proposerOutput) {
        llmSpan.end({ model: STORY_MAP_MODEL, error: lastIssues.slice(0, 500) })
        await trace.end()
        throw new Error(`Claude could not produce a valid inventory.yaml after ${attempt} attempts. Last issues: ${lastIssues}`)
      }

      llmSpan.end({ model: STORY_MAP_MODEL })
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
          llm_model: STORY_MAP_MODEL,
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
      // A wallet refusal is an account state, not a bug: keep it out of
      // Sentry's error stream.
      if (err instanceof WalletDeniedError) log.warn('Story mapper refused by the wallet', { run_id, reason: err.reason })
      else log.error('Story mapper failed', { run_id, error: message })

      // PostgREST builders are thenables without `.catch`; await and ignore
      // the resolved error rather than chaining `.catch` (which throws).
      const { error: failErr } = await db.from('story_map_runs').update({
        status: 'failed',
        error_message: message.slice(0, 1000),
        finished_at: new Date().toISOString(),
      }).eq('id', run_id)
      if (failErr) log.warn('failed to mark story_map_run failed', { run_id, error: failErr.message })

      // An empty hosted-LLM wallet is the caller's to fix (top up or add a
      // key), not a server failure: 402 with what the top-up prompt needs.
      if (err instanceof WalletDeniedError) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'WALLET_INSUFFICIENT',
              message: 'Not enough wallet balance for this AI call. Top up the wallet or add your own API key.',
              reason: err.reason,
              balanceMicro: err.balanceMicro,
            },
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        )
      }

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
