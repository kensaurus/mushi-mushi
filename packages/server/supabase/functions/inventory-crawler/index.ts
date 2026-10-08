// ============================================================
// inventory-crawler — Gate 4 (whitepaper §5)
//
// What it does
// ────────────
// For every page declared in the project's current inventory snapshot:
//   - HTTP-GETs the rendered URL (preview / staging / production —
//     configured per-project on `project_settings.crawler_base_url`).
//   - Parses the response and enumerates every `data-testid` it sees.
//   - Diffs the discovered set against the inventory's declared elements.
//   - Writes a `gate_runs (gate='crawl')` row + one `gate_findings`
//     row per drift entry (missing-in-app / missing-in-inventory /
//     attribute-mismatch).
//
// Coverage caveats
// ────────────────
// The Deno edge runtime can't load Playwright (native deps). For pages
// that REQUIRE a JS render to expose their testids, we recommend
// running the Node-side CLI runner — `mushi-mushi-cli inventory crawl
// --playwright` — which reuses `packages/verify` directly. The edge
// function detects when a page is JS-only (no testids match the
// inventory and the response is small) and writes a `warn`-severity
// finding asking the operator to run the deeper crawl.
//
// When the project has its own Firecrawl key (BYOK), up to 20 such pages
// are first re-checked from a Firecrawl browser render (never signed in);
// `gate_runs.summary.pages_rendered` counts them.
//
// API discovery
// ─────────────
// The same crawl pass also harvests every fetch-able URL the page
// references (script tags, link tags, anchor href) — we keep only the
// ones whose path matches the project's API origin and write them into
// `gate_runs.summary.discovered_apis`. Gate 3 (api_contract) reads
// that blob to decide whether the inventory's ApiDeps still match.
//
// Concurrency
// ───────────
// Bound at 4 in-flight requests — overrides via
// `project_settings.crawler_concurrency` once we ship that column.
// Cooperative yield via Promise.all; no work-stealing because edge
// runtimes already cap CPU per request.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { safeErrorResponse } from '../_shared/safe-error.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { computeStats, parseInventoryYaml, type Inventory } from '../_shared/inventory.ts'
import { resolveStoryExternalId } from '../_shared/inventory-story-scope.ts'
import { markKeyUsed, resolveLlmKey, type ResolvedKey } from '../_shared/byok.ts'
import {
  assertSafeOutboundUrl,
  inventoryAppAllowHosts,
  pickCrawlBaseUrl,
  safeFetch,
  type SafeUrlOptions,
} from '../_shared/inventory-guards.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('inventory-crawler')

const TESTID_REGEX = /data-testid=["']([^"']+)["']/g
const HREF_REGEX = /href=["']([^"']+)["']/g
const SCRIPT_REGEX = /src=["']([^"']+)["']/g
const FETCH_API_REGEX = /["'](\/(?:api|v\d+|graphql)\/[a-z0-9_\-/]+)["']/gi

interface CrawlerProject {
  id: string
  inventory: Inventory | null
  baseUrl: string
  authConfig: AuthConfig | null
  concurrency: number
}

type AuthConfig =
  | { type: 'cookie'; config: { name: string; value: string; domain?: string } }
  | { type: 'bearer'; config: { token: string } }
  | { type: 'oauth'; config: { token: string } }
  | { type: 'scripted'; config: { login_path: string; script: string } }

interface PageDiff {
  page_id: string
  path: string
  status_code: number | null
  declared: string[]
  discovered: string[]
  missing_in_app: string[]
  missing_in_inventory: string[]
  ms: number
  error?: string
  /** Set when the page was re-checked from a Firecrawl browser render. */
  rendered?: boolean
  /** The path Firecrawl ended on when the render redirected away from `path`. */
  rendered_to?: string
}

type CrawlResult = PageDiff & { html: string | null; href_paths: string[]; api_paths: string[] }

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'
const MAX_FIRECRAWL_RENDERS = 20
const FIRECRAWL_WAIT_MS = 2_500
const FIRECRAWL_TIMEOUT_MS = 20_000
const RENDER_PHASE_BUDGET_MS = 75_000

/** A path with a route parameter (`/lessons/[lessonId]`, `/users/:id`) names no single page to fetch. */
function isDynamicPath(path: string): boolean {
  return /\[[^\]]+\]|\/:[A-Za-z_]/.test(path)
}

/**
 * Whether the edge crawl could check a page at all. It reads the server's
 * HTML without running scripts or signing in, so a page that came back with
 * none of its declared testids was most likely rendered client-side or
 * behind sign-in: one "unverified" warning, not one error per testid. When
 * some declared testids did render, the missing ones are real misses.
 */
function crawlVerdict(
  r: Pick<PageDiff, 'declared' | 'discovered' | 'error'>,
  page: { authRequired: boolean; hasAuth: boolean },
): 'checked' | 'unverified-auth' | 'unverified-client' {
  if (!noTestidsSeen(r)) return 'checked'
  return page.authRequired && !page.hasAuth ? 'unverified-auth' : 'unverified-client'
}

/** The page was fetched but showed none of its declared testids. */
function noTestidsSeen(r: Pick<PageDiff, 'declared' | 'discovered' | 'error'>): boolean {
  return !r.error && r.declared.length > 0 && r.discovered.length === 0
}

function diffHtml(html: string, declaredTestids: string[]) {
  const discovered = new Set<string>()
  for (const match of html.matchAll(TESTID_REGEX)) {
    if (match[1]) discovered.add(match[1])
  }

  const declaredSet = new Set(declaredTestids)
  const discoveredArr = Array.from(discovered)
  const declaredArr = Array.from(declaredSet)

  const hrefPaths: string[] = []
  for (const m of html.matchAll(HREF_REGEX)) {
    const v = m[1]
    if (!v) continue
    if (v.startsWith('/')) hrefPaths.push(v)
  }
  for (const m of html.matchAll(SCRIPT_REGEX)) {
    const v = m[1]
    if (!v) continue
    if (v.startsWith('/')) hrefPaths.push(v)
  }
  const apiPaths: string[] = []
  for (const m of html.matchAll(FETCH_API_REGEX)) {
    if (m[1]) apiPaths.push(m[1])
  }

  return {
    declared: declaredArr,
    discovered: discoveredArr,
    missing_in_app: declaredArr.filter((t) => !discovered.has(t)),
    missing_in_inventory: discoveredArr.filter((t) => !declaredSet.has(t)),
    href_paths: hrefPaths,
    api_paths: apiPaths,
  }
}

async function loadProject(
  db: SupabaseClient,
  projectId: string,
): Promise<{ ok: true; project: CrawlerProject & { inventory: Inventory } } | { ok: false; reason: string }> {
  const { data: settings } = await db
    .from('project_settings')
    .select('crawler_base_url, crawler_auth_config')
    .eq('project_id', projectId)
    .maybeSingle()

  const { data: snapshot } = await db
    .from('inventories')
    .select('parsed, raw_yaml')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle()

  let inventory: Inventory | null = null
  if (snapshot?.parsed) {
    inventory = snapshot.parsed as Inventory
  } else if (snapshot?.raw_yaml) {
    const parsed = parseInventoryYaml(snapshot.raw_yaml as string)
    inventory = parsed.inventory ?? null
  }

  if (!inventory) {
    return { ok: false, reason: 'no current inventory; ingest inventory.yaml first' }
  }

  // A localhost / private preview_url is skipped for the production URL: a
  // cloud crawler cannot reach the developer's machine (glot.it's inventory
  // pointed every crawl at http://localhost:3000).
  const choice = pickCrawlBaseUrl(settings?.crawler_base_url as string | null, inventory.app)
  if (!choice.url) {
    const why = choice.skipped.length ? `: ${choice.skipped.join('; ')}` : ''
    return {
      ok: false,
      reason: `no crawlable URL; set crawler_base_url in project settings${why}`,
    }
  }
  if (choice.skipped.length) {
    rlog.info('crawler: passed over unreachable inventory URLs', {
      project_id: projectId,
      using: choice.source,
      skipped: choice.skipped,
    })
  }

  const authConfig = (settings?.crawler_auth_config as AuthConfig | null) ?? null

  return {
    ok: true,
    project: {
      id: projectId,
      inventory,
      baseUrl: choice.url,
      authConfig,
      concurrency: 4,
    },
  }
}

function buildHeaders(auth: AuthConfig | null): Record<string, string> {
  // HTTP header values are ByteString-only (RFC 7230 §3.2.4 — visible-ASCII
  // + HTAB + SP). Em-dash (U+2014) and other Unicode punctuation throws
  // `TypeError: 'headers' of 'RequestInit' (Argument 2) is not a valid
  // ByteString` at fetch() time, breaking the entire crawl. Use the ASCII
  // double-hyphen instead.
  const base: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent':
      'MushiMushiCrawler/1.0 (+https://kensaur.us/mushi-mushi/docs/crawler -- opt-in via robots.txt)',
  }
  if (!auth) return base
  if (auth.type === 'cookie') {
    base['Cookie'] = `${auth.config.name}=${auth.config.value}`
  } else if (auth.type === 'bearer' || auth.type === 'oauth') {
    base['Authorization'] = `Bearer ${auth.config.token}`
  }
  return base
}

async function crawlPage(
  baseUrl: string,
  page: { id: string; path: string },
  declaredTestids: string[],
  authHeaders: Record<string, string>,
  urlOptions: SafeUrlOptions = {},
): Promise<CrawlResult> {
  const url = new URL(page.path, baseUrl).toString()
  const start = Date.now()
  try {
    // safeFetch enforces the SSRF allowlist on the initial URL AND every
    // redirect hop, plus strips Authorization on cross-host hops. The
    // crawler used to call fetch() directly with `redirect: 'follow'`,
    // which on Deno < 2.1.2 would leak Bearer tokens to any host the
    // customer's app happened to redirect to (CVE-2025-21620). Defence
    // in depth: we also do this on >= 2.1.2 because the host allowlist
    // is the real security boundary, not the runtime version.
    const res = await safeFetch(
      url,
      { headers: authHeaders, method: 'GET' },
      { url: urlOptions, timeoutMs: 15_000, maxRedirects: 3 },
    )
    const html = await res.text()

    return {
      page_id: page.id,
      path: page.path,
      status_code: res.status,
      ...diffHtml(html, declaredTestids),
      ms: Date.now() - start,
      html,
    }
  } catch (err) {
    return {
      page_id: page.id,
      path: page.path,
      status_code: null,
      declared: declaredTestids,
      discovered: [],
      missing_in_app: declaredTestids,
      missing_in_inventory: [],
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      html: null,
      href_paths: [],
      api_paths: [],
    }
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = []
  let i = 0
  const runners: Promise<void>[] = []
  for (let r = 0; r < concurrency; r++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = i++
          if (idx >= items.length) return
          out[idx] = await worker(items[idx]!)
        }
      })(),
    )
  }
  await Promise.all(runners)
  return out
}

/** Only the project's own stored key renders its pages; the platform env key never does. */
function projectFirecrawlKey(resolved: ResolvedKey | null): { key: string; keyId?: string } | null {
  if (!resolved || resolved.source !== 'byok' || !resolved.key) return null
  return { key: resolved.key, keyId: resolved.keyId }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  return norm(a) === norm(b)
}

/**
 * Render one page in Firecrawl's browser and return its HTML. The URL must
 * pass the crawl's SSRF allowlist, and so must the URL Firecrawl ended on.
 * Only the URL is sent: no crawler sign-in headers or cookies.
 */
async function renderWithFirecrawl(
  url: string,
  apiKey: string,
  urlOptions: SafeUrlOptions,
): Promise<{ html: string; finalUrl: URL | null }> {
  const check = assertSafeOutboundUrl(url, urlOptions)
  if (!check.ok) throw new Error(`outbound-blocked: ${check.reason}`)

  const res = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      url: check.url.toString(),
      formats: ['rawHtml'],
      onlyMainContent: false,
      waitFor: FIRECRAWL_WAIT_MS,
      timeout: FIRECRAWL_TIMEOUT_MS,
      maxAge: 0,
    }),
    signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS + 5_000),
  })
  if (!res.ok) throw new Error(`firecrawl HTTP ${res.status}`)
  const json = (await res.json()) as {
    success?: boolean
    data?: { rawHtml?: unknown; metadata?: { url?: unknown; sourceURL?: unknown } }
  }
  const html = json.data?.rawHtml
  if (json.success !== true || typeof html !== 'string' || html.length === 0) {
    throw new Error('firecrawl returned no HTML')
  }

  const landed = json.data?.metadata?.url ?? json.data?.metadata?.sourceURL
  if (typeof landed !== 'string') return { html, finalUrl: null }
  const landedCheck = assertSafeOutboundUrl(landed, urlOptions)
  if (!landedCheck.ok) throw new Error(`firecrawl landed off the allowlist: ${landedCheck.reason}`)
  return { html, finalUrl: landedCheck.url }
}

/**
 * Re-check pages whose server HTML showed none of their testids against a
 * Firecrawl browser render. A render that found testids replaces the page's
 * diff; a render that redirected elsewhere or still found none keeps the page
 * unverified with `rendered` set. Firecrawl failures leave the page unchanged.
 */
async function renderUnverifiedPages(
  results: CrawlResult[],
  opts: {
    baseUrl: string
    urlOptions: SafeUrlOptions
    concurrency: number
    getKey: () => Promise<{ key: string; keyId?: string } | null>
    maxRenders?: number
    budgetMs?: number
  },
): Promise<{ results: CrawlResult[]; rendered: number; keyId?: string }> {
  const candidates = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => noTestidsSeen(r))
    .slice(0, opts.maxRenders ?? MAX_FIRECRAWL_RENDERS)
  if (candidates.length === 0) return { results, rendered: 0 }

  let key: { key: string; keyId?: string } | null = null
  try {
    key = await opts.getKey()
  } catch (err) {
    rlog.warn('crawler: Firecrawl key lookup failed; pages stay unverified', { err: String(err) })
  }
  if (!key) return { results, rendered: 0 }
  const apiKey = key.key

  const out = results.slice()
  const deadline = Date.now() + (opts.budgetMs ?? RENDER_PHASE_BUDGET_MS)
  let rendered = 0
  await runWithConcurrency(
    candidates,
    async ({ r, i }) => {
      if (Date.now() > deadline) return
      const url = new URL(r.path, opts.baseUrl)
      try {
        const { html, finalUrl } = await renderWithFirecrawl(url.toString(), apiKey, opts.urlOptions)
        rendered += 1
        if (finalUrl && !samePath(finalUrl.pathname, url.pathname)) {
          out[i] = { ...r, rendered: true, rendered_to: finalUrl.pathname }
          return
        }
        const diff = diffHtml(html, r.declared)
        out[i] = {
          ...r,
          ...diff,
          api_paths: Array.from(new Set([...r.api_paths, ...diff.api_paths])),
          rendered: true,
        }
      } catch (err) {
        rlog.warn('crawler: Firecrawl render failed; page stays unverified', {
          path: r.path,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    },
    opts.concurrency,
  )
  return { results: out, rendered, keyId: key.keyId }
}

async function crawlAndPersist(
  db: SupabaseClient,
  projectId: string,
  triggeredBy?: string,
  storyNodeId?: string | null,
): Promise<{
  runId: string
  status: 'pass' | 'fail' | 'warn' | 'error' | 'skipped'
  pages: number
  findings: number
  discoveredApis: number
}> {
  const loaded = await loadProject(db, projectId)
  if (!loaded.ok) {
    rlog.warn('crawler: skipping', { project_id: projectId, reason: loaded.reason })
    const { data: skip } = await db
      .from('gate_runs')
      .insert({
        project_id: projectId,
        gate: 'crawl',
        status: 'skipped',
        summary: { reason: loaded.reason },
        triggered_by: triggeredBy ?? 'crawler',
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    return {
      runId: (skip?.id as string) ?? '',
      status: 'skipped',
      pages: 0,
      findings: 0,
      discoveredApis: 0,
    }
  }
  const project = loaded.project

  const { data: run, error: runErr } = await db
    .from('gate_runs')
    .insert({
      project_id: projectId,
      gate: 'crawl',
      status: 'running',
      triggered_by: triggeredBy ?? 'crawler',
    })
    .select('id')
    .single()
  if (runErr || !run) throw new Error(`gate_runs insert failed: ${runErr?.message}`)
  const runId = run.id as string

  const headers = buildHeaders(project.authConfig)

  interface CrawlItem {
    id: string
    path: string
    declared: string[]
    authRequired: boolean
  }

  let pages = project.inventory.pages
  if (storyNodeId) {
    const storyExternalId = await resolveStoryExternalId(db, projectId, storyNodeId)
    if (storyExternalId) {
      pages = pages.filter((p) => p.user_story === storyExternalId)
    }
  }

  const skippedDynamic = pages.filter((p) => isDynamicPath(p.path)).map((p) => p.path)
  const items: CrawlItem[] = pages
    .filter((p) => !isDynamicPath(p.path))
    .map((p) => ({
      id: p.id,
      path: p.path,
      declared: p.elements.map((el) => el.testid ?? el.id),
      authRequired: p.auth_required !== false,
    }))
  const hasAuth = Boolean(project.authConfig)

  if (items.length === 0) {
    const { data: skip } = await db
      .from('gate_runs')
      .insert({
        project_id: projectId,
        gate: 'crawl',
        status: 'skipped',
        summary: {
          reason: storyNodeId ? 'no pages linked to this user story' : 'no pages in inventory',
          ...(storyNodeId ? { story_node_id: storyNodeId } : {}),
        },
        triggered_by: triggeredBy ?? 'crawler',
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    return {
      runId: (skip?.id as string) ?? '',
      status: 'skipped',
      pages: 0,
      findings: 0,
      discoveredApis: 0,
    }
  }

  // Build the SSRF allowlist from the inventory app shape. The crawler is
  // only ever supposed to talk to the customer's own app, so the safe
  // hosts are exactly {base_url, preview_url, staging_url} plus whatever
  // crawler_base_url's host is (operator-supplied; we already SSRF-checked
  // it at PATCH /settings time, but include it in the allowlist so a
  // staging-only inventory doesn't reject a preview crawl).
  const allowHosts = inventoryAppAllowHosts(project.inventory.app)
  try {
    allowHosts.push(new URL(project.baseUrl).hostname.toLowerCase())
  } catch {
    /* baseUrl already vetted in loadProject */
  }
  const urlOptions: SafeUrlOptions = { allowHosts: Array.from(new Set(allowHosts)) }

  const fetched = await runWithConcurrency(
    items,
    (it: CrawlItem) =>
      crawlPage(project.baseUrl, { id: it.id, path: it.path }, it.declared, headers, urlOptions),
    project.concurrency,
  )

  const { results, rendered, keyId } = await renderUnverifiedPages(fetched, {
    baseUrl: project.baseUrl,
    urlOptions,
    concurrency: project.concurrency,
    getKey: async () =>
      projectFirecrawlKey(await resolveLlmKey(db, projectId, 'firecrawl', { purpose: 'probe' })),
  })
  if (rendered > 0 && keyId) {
    await markKeyUsed(db, projectId, 'firecrawl', keyId).catch((err) => {
      rlog.warn('crawler: Firecrawl usage bookkeeping failed (non-fatal)', { err: String(err) })
    })
  }

  // Persist findings.
  let findings = 0
  let unverified = 0
  for (const [i, r] of results.entries()) {
    const verdict = crawlVerdict(r, { authRequired: items[i]?.authRequired ?? true, hasAuth })
    if (verdict !== 'checked') {
      unverified += 1
      const why = r.rendered_to
        ? `rendered with Firecrawl, it redirected to ${r.rendered_to}, so it likely needs sign-in`
        : r.rendered
          ? 'rendered with Firecrawl, it still showed none of its testids, so it likely needs sign-in'
          : verdict === 'unverified-auth'
            ? 'it needs sign-in and no crawler sign-in is set'
            : 'none of its testids are in the server HTML, so it renders in the browser'
      const { error } = await db.from('gate_findings').insert({
        gate_run_id: runId,
        project_id: projectId,
        severity: 'warn',
        rule_id: 'crawl-unverified',
        message: `Page ${r.path} could not be checked: ${why}. Its ${r.declared.length} declared testid(s) are unverified, not missing.`,
        file_path: r.path,
        suggested_fix: {
          explanation: r.rendered
            ? 'The Firecrawl render is never signed in. Run `mushi-mushi-cli inventory crawl --playwright` signed in.'
            : verdict === 'unverified-auth'
              ? 'Set a crawler sign-in (Inventory → Settings → crawler auth), or run `mushi-mushi-cli inventory crawl --playwright` signed in.'
              : 'Run `mushi-mushi-cli inventory crawl --playwright`, which renders the page in a browser.',
        },
      })
      if (!error) findings += 1
      continue
    }
    for (const tid of r.missing_in_app) {
      const { error } = await db.from('gate_findings').insert({
        gate_run_id: runId,
        project_id: projectId,
        severity: 'error',
        rule_id: 'crawl-missing-in-app',
        message: `Page ${r.path} declares element with data-testid="${tid}" but the rendered page does not expose it.`,
        file_path: r.path,
        suggested_fix: {
          explanation:
            'Either the element does not render on the inventoried route, the testid was renamed, or the rendered page is JS-only and the edge crawler did not see it. Run the Node-side `mushi-mushi-cli inventory crawl --playwright` for a full render.',
        },
      })
      if (!error) findings += 1
    }
    for (const tid of r.missing_in_inventory) {
      const { error } = await db.from('gate_findings').insert({
        gate_run_id: runId,
        project_id: projectId,
        severity: 'warn',
        rule_id: 'crawl-missing-in-inventory',
        message: `Page ${r.path} renders an element with data-testid="${tid}" not declared in inventory.yaml.`,
        file_path: r.path,
        suggested_fix: { add_to_inventory: { page_id: r.page_id, testid: tid } },
      })
      if (!error) findings += 1
    }
    if (r.error) {
      const { error } = await db.from('gate_findings').insert({
        gate_run_id: runId,
        project_id: projectId,
        severity: 'error',
        rule_id: 'crawl-fetch-failed',
        message: `Failed to fetch ${r.path}: ${r.error}`,
        file_path: r.path,
      })
      if (!error) findings += 1
    }
  }

  // Aggregate discovered APIs across pages.
  const discoveredApiSet = new Set<string>()
  for (const r of results) {
    for (const ap of r.api_paths) discoveredApiSet.add(`GET:${ap}`)
  }
  // Also fold in declared apis from the inventory itself (so a page that
  // never references the API directly — e.g. a server component — still
  // counts the route as "present" if any other page does). This is the
  // safe default; the Gate-3 diff that overrides with a stricter "must
  // be observed at runtime" comparison is opt-in via the
  // `crawler_strict_api_contract` flag we'll ship later.
  for (const a of (project.inventory.dependencies?.apis ?? []) as Array<{ method: string; path: string }>) {
    discoveredApiSet.add(`${a.method}:${a.path}`)
  }

  const summary = {
    pages_crawled: results.length,
    pages_failed: results.filter((r) => r.error).length,
    pages_unverified: unverified,
    pages_rendered: rendered,
    ...(skippedDynamic.length ? { skipped_dynamic_paths: skippedDynamic } : {}),
    findings,
    discovered_apis: Array.from(discoveredApiSet),
    inventory_stats: computeStats(project.inventory),
    ...(storyNodeId ? { story_node_id: storyNodeId } : {}),
  }
  const checked = results.filter((r, i) => crawlVerdict(r, { authRequired: items[i]?.authRequired ?? true, hasAuth }) === 'checked')
  const overall: 'pass' | 'fail' | 'warn' =
    results.some((r) => r.error) || checked.some((r) => r.missing_in_app.length > 0)
      ? 'fail'
      : unverified > 0 || checked.some((r) => r.missing_in_inventory.length > 0)
        ? 'warn'
        : 'pass'

  await db
    .from('gate_runs')
    .update({
      status: overall,
      summary,
      findings_count: findings,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)

  return {
    runId,
    status: overall,
    pages: results.length,
    findings,
    discoveredApis: discoveredApiSet.size,
  }
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp

  let body: { project_id?: string; triggered_by?: string; story_node_id?: string | null }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, error: { code: 'INVALID_JSON' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!body.project_id) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'MISSING_PROJECT' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const db = getServiceClient()
  try {
    const result = await crawlAndPersist(db, body.project_id, body.triggered_by, body.story_node_id ?? null)
    return new Response(
      JSON.stringify({ ok: true, data: result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    rlog.error('crawl failed', { project_id: body.project_id, err: String(err) })
    return safeErrorResponse({ code: 'CRAWL_FAILED', status: 500 })
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('inventory-crawler', handler))
}

export {
  crawlPage,
  runWithConcurrency,
  crawlAndPersist,
  crawlVerdict,
  isDynamicPath,
  projectFirecrawlKey,
  renderUnverifiedPages,
}
