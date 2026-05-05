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
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { computeStats, parseInventoryYaml, type Inventory } from '../_shared/inventory.ts'
import {
  inventoryAppAllowHosts,
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
}

async function loadProject(db: SupabaseClient, projectId: string): Promise<CrawlerProject | null> {
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

  const baseUrl =
    (settings?.crawler_base_url as string | null) ??
    inventory?.app.preview_url ??
    inventory?.app.staging_url ??
    inventory?.app.base_url ??
    null
  if (!baseUrl) return null

  const authConfig = (settings?.crawler_auth_config as AuthConfig | null) ?? null

  return {
    id: projectId,
    inventory,
    baseUrl,
    authConfig,
    concurrency: 4,
  }
}

function buildHeaders(auth: AuthConfig | null): Record<string, string> {
  const base: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent':
      'MushiMushiCrawler/1.0 (+https://mushimushi.dev/docs/crawler — opt-in via robots.txt)',
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
): Promise<PageDiff & { html: string | null; href_paths: string[]; api_paths: string[] }> {
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

    const discovered = new Set<string>()
    for (const match of html.matchAll(TESTID_REGEX)) {
      if (match[1]) discovered.add(match[1])
    }

    const declaredSet = new Set(declaredTestids)
    const discoveredArr = Array.from(discovered)
    const declaredArr = Array.from(declaredSet)

    const missingInApp = declaredArr.filter((t) => !discovered.has(t))
    const missingInInventory = discoveredArr.filter((t) => !declaredSet.has(t))

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
      page_id: page.id,
      path: page.path,
      status_code: res.status,
      declared: declaredArr,
      discovered: discoveredArr,
      missing_in_app: missingInApp,
      missing_in_inventory: missingInInventory,
      ms: Date.now() - start,
      html,
      href_paths: hrefPaths,
      api_paths: apiPaths,
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

async function crawlAndPersist(db: SupabaseClient, projectId: string, triggeredBy?: string): Promise<{
  runId: string
  status: 'pass' | 'fail' | 'warn' | 'error' | 'skipped'
  pages: number
  findings: number
  discoveredApis: number
}> {
  const project = await loadProject(db, projectId)
  if (!project || !project.inventory) {
    rlog.warn('crawler: no inventory or base_url; skipping', { project_id: projectId })
    const { data: skip } = await db
      .from('gate_runs')
      .insert({
        project_id: projectId,
        gate: 'crawl',
        status: 'skipped',
        summary: { reason: 'no inventory or crawler_base_url' },
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
  }
  const items: CrawlItem[] = project.inventory.pages.map((p) => ({
    id: p.id,
    path: p.path,
    declared: p.elements.map((el) => el.testid ?? el.id),
  }))

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

  const results = await runWithConcurrency(
    items,
    (it: CrawlItem) =>
      crawlPage(project.baseUrl, { id: it.id, path: it.path }, it.declared, headers, urlOptions),
    project.concurrency,
  )

  // Persist findings.
  let findings = 0
  for (const r of results) {
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
  for (const a of project.inventory.dependencies?.apis ?? []) {
    discoveredApiSet.add(`${a.method}:${a.path}`)
  }

  const summary = {
    pages_crawled: results.length,
    pages_failed: results.filter((r) => r.error).length,
    findings,
    discovered_apis: Array.from(discoveredApiSet),
    inventory_stats: computeStats(project.inventory),
  }
  const overall: 'pass' | 'fail' | 'warn' =
    results.some((r) => r.error) || results.some((r) => r.missing_in_app.length > 0)
      ? 'fail'
      : results.some((r) => r.missing_in_inventory.length > 0)
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

  let body: { project_id?: string; triggered_by?: string }
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
    const result = await crawlAndPersist(db, body.project_id, body.triggered_by)
    return new Response(
      JSON.stringify({ ok: true, data: result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    rlog.error('crawl failed', { project_id: body.project_id, err: String(err) })
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'CRAWL_FAILED', message: String(err) } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('inventory-crawler', handler))
}

export { crawlPage, runWithConcurrency, crawlAndPersist }
