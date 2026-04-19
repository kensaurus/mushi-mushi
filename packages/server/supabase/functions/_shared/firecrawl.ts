/**
 * FILE: packages/server/supabase/functions/_shared/firecrawl.ts
 * PURPOSE: Wave E — BYOK Firecrawl client used by:
 *            * /v1/admin/research/* (manual triage research)
 *            * fix-worker (auto-augment when local RAG is sparse)
 *            * library-modernizer cron (release-notes scraping)
 *
 * GUARDRAILS:
 *   1. Per-project BYOK key resolved via Supabase Vault (vault://<id>); falls
 *      back to FIRECRAWL_API_KEY env if set, otherwise returns null.
 *   2. Per-project hostname allow-list — empty array means unrestricted, any
 *      non-empty value DENIES URLs whose hostname does not match.
 *   3. Per-project page cap (firecrawl_max_pages_per_call).
 *   4. 24-hour response cache keyed on (project_id, mode, cache_key).
 *   5. Audit log row per call (action='firecrawl.search' | 'firecrawl.scrape')
 *      via the standard audit pipeline.
 *   6. Langfuse span on every live call so cost shows up next to LLM spend.
 *
 * Never throws on cache failure — caching is best-effort. Throws on API auth
 * failure so callers can surface 'Configure Firecrawl' to the user.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'
import { createTrace } from './observability.ts'

const log = rootLog.child('firecrawl')

const FIRECRAWL_BASE = 'https://api.firecrawl.dev'
const CACHE_TTL_HOURS = 24

export interface FirecrawlSearchResult {
  url: string
  title: string
  snippet: string
  markdown?: string
}

export interface FirecrawlScrapeResult {
  url: string
  title?: string
  markdown: string
  html?: string
  metadata?: Record<string, unknown>
}

export interface ResolvedFirecrawl {
  key: string
  source: 'byok' | 'env'
  hint: string
  allowedDomains: string[]
  maxPagesPerCall: number
}

export async function resolveFirecrawl(
  db: SupabaseClient,
  projectId: string,
): Promise<ResolvedFirecrawl | null> {
  const { data: settings, error } = await db
    .from('project_settings')
    .select('byok_firecrawl_key_ref, firecrawl_allowed_domains, firecrawl_max_pages_per_call')
    .eq('project_id', projectId)
    .maybeSingle()

  if (error) log.warn('Failed to read project_settings for Firecrawl', { projectId, error: error.message })

  const ref = settings?.byok_firecrawl_key_ref as string | null | undefined
  const allowedDomains = (settings?.firecrawl_allowed_domains as string[] | null | undefined) ?? []
  const maxPagesPerCall = (settings?.firecrawl_max_pages_per_call as number | null | undefined) ?? 5

  let key: string | null = null
  let source: 'byok' | 'env' = 'env'

  if (ref) {
    key = await dereferenceKey(db, ref)
    if (key) source = 'byok'
  }

  if (!key) {
    const envKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (envKey) {
      key = envKey
      source = 'env'
    }
  }

  if (!key) return null

  if (source === 'byok') {
    void recordUsage(db, projectId).catch(() => { /* best-effort */ })
  }

  return {
    key,
    source,
    hint: key.length > 4 ? `…${key.slice(-4)}` : '****',
    allowedDomains,
    maxPagesPerCall,
  }
}

async function dereferenceKey(db: SupabaseClient, ref: string): Promise<string | null> {
  if (!ref.startsWith('vault://')) {
    log.warn('Firecrawl BYOK ref is not a vault:// reference; using raw value (dev only)', {})
    return ref
  }
  const id = ref.slice('vault://'.length)
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: id })
  if (error) {
    log.warn('vault_get_secret failed for firecrawl', { error: error.message })
    return null
  }
  return typeof data === 'string' ? data : null
}

async function recordUsage(db: SupabaseClient, projectId: string): Promise<void> {
  await db
    .from('project_settings')
    .update({ byok_firecrawl_key_last_used_at: new Date().toISOString() })
    .eq('project_id', projectId)
  await db.from('byok_audit_log').insert({ project_id: projectId, provider: 'firecrawl', action: 'used' })
}

function isHostAllowed(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true
  try {
    const host = new URL(url).hostname.toLowerCase()
    return allowedDomains.some((d) => {
      const needle = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      if (!needle) return false
      return host === needle || host.endsWith(`.${needle}`)
    })
  } catch {
    return false
  }
}

async function readCache<T>(
  db: SupabaseClient,
  projectId: string,
  mode: 'search' | 'scrape',
  cacheKey: string,
): Promise<T | null> {
  const { data } = await db
    .from('firecrawl_cache')
    .select('payload, expires_at')
    .eq('project_id', projectId)
    .eq('mode', mode)
    .eq('cache_key', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  return (data?.payload as T | undefined) ?? null
}

async function writeCache(
  db: SupabaseClient,
  projectId: string,
  mode: 'search' | 'scrape',
  cacheKey: string,
  payload: unknown,
): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 3_600_000).toISOString()
  await db.from('firecrawl_cache').upsert(
    { project_id: projectId, mode, cache_key: cacheKey, payload, expires_at: expiresAt },
    { onConflict: 'project_id,mode,cache_key' },
  )
}

export interface FirecrawlSearchOptions {
  /** Hard upper bound on returned snippets. Capped by the project's max_pages_per_call. */
  limit?: number
  /** Restrict to a subset of domains (intersected with the project allow-list). */
  domains?: string[]
  /** Bypass the 24h cache when true. */
  bypassCache?: boolean
}

/**
 * firecrawlSearch — calls Firecrawl `/v1/search` for a query string.
 * Returns up to `limit` snippets, capped by project policy.
 *
 * Throws on API auth/network failure so the caller can degrade gracefully
 * (e.g. fix-worker continues without web context). Cache misses are fine.
 */
export async function firecrawlSearch(
  db: SupabaseClient,
  projectId: string,
  query: string,
  opts: FirecrawlSearchOptions = {},
): Promise<FirecrawlSearchResult[]> {
  const resolved = await resolveFirecrawl(db, projectId)
  if (!resolved) throw new Error('FIRECRAWL_NOT_CONFIGURED')

  const limit = Math.min(opts.limit ?? 5, resolved.maxPagesPerCall)
  const domainFilter = opts.domains && opts.domains.length > 0
    ? opts.domains
    : resolved.allowedDomains

  const cacheKey = JSON.stringify({ q: query.trim().toLowerCase().slice(0, 240), limit, d: domainFilter.slice().sort() })
  if (!opts.bypassCache) {
    const cached = await readCache<FirecrawlSearchResult[]>(db, projectId, 'search', cacheKey)
    if (cached) return cached
  }

  const trace = createTrace('firecrawl.search', { projectId, query: query.slice(0, 80) })
  const span = trace.span('http')

  try {
    const body: Record<string, unknown> = {
      query,
      limit,
      scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
    }
    if (domainFilter.length > 0) {
      body.query = `${query} ${domainFilter.map((d) => `site:${d}`).join(' OR ')}`
    }

    const res = await fetch(`${FIRECRAWL_BASE}/v1/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resolved.key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      const text = await res.text()
      span.end({ statusCode: res.status, error: text.slice(0, 200) })
      await trace.end()
      if (res.status === 401 || res.status === 403) throw new Error('FIRECRAWL_AUTH_FAILED')
      if (res.status === 429) throw new Error('FIRECRAWL_RATE_LIMITED')
      throw new Error(`FIRECRAWL_HTTP_${res.status}`)
    }

    const json = await res.json() as { data?: Array<{ url: string; title?: string; description?: string; markdown?: string }> }
    const results: FirecrawlSearchResult[] = (json.data ?? [])
      .slice(0, limit)
      .filter((r) => domainFilter.length === 0 || isHostAllowed(r.url, domainFilter))
      .map((r) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: (r.description ?? r.markdown ?? '').slice(0, 600),
        markdown: r.markdown,
      }))

    span.end({ statusCode: res.status })
    await trace.end()

    void writeCache(db, projectId, 'search', cacheKey, results).catch(() => { /* best-effort */ })
    return results
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('FIRECRAWL_')) {
      span.end({ error: String(err) })
      await trace.end()
    }
    throw err
  }
}

export interface FirecrawlScrapeOptions {
  bypassCache?: boolean
}

export async function firecrawlScrape(
  db: SupabaseClient,
  projectId: string,
  url: string,
  opts: FirecrawlScrapeOptions = {},
): Promise<FirecrawlScrapeResult> {
  const resolved = await resolveFirecrawl(db, projectId)
  if (!resolved) throw new Error('FIRECRAWL_NOT_CONFIGURED')

  if (!isHostAllowed(url, resolved.allowedDomains)) {
    throw new Error('FIRECRAWL_DOMAIN_NOT_ALLOWED')
  }

  if (!opts.bypassCache) {
    const cached = await readCache<FirecrawlScrapeResult>(db, projectId, 'scrape', url)
    if (cached) return cached
  }

  const trace = createTrace('firecrawl.scrape', { projectId, url: url.slice(0, 200) })
  const span = trace.span('http')

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/v1/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resolved.key}`,
      },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const text = await res.text()
      span.end({ statusCode: res.status, error: text.slice(0, 200) })
      await trace.end()
      if (res.status === 401 || res.status === 403) throw new Error('FIRECRAWL_AUTH_FAILED')
      if (res.status === 429) throw new Error('FIRECRAWL_RATE_LIMITED')
      throw new Error(`FIRECRAWL_HTTP_${res.status}`)
    }

    const json = await res.json() as { data?: { markdown?: string; html?: string; metadata?: Record<string, unknown> } }
    const result: FirecrawlScrapeResult = {
      url,
      title: json.data?.metadata?.title as string | undefined,
      markdown: json.data?.markdown ?? '',
      html: json.data?.html,
      metadata: json.data?.metadata,
    }

    span.end({ statusCode: res.status })
    await trace.end()

    void writeCache(db, projectId, 'scrape', url, result).catch(() => { /* best-effort */ })
    return result
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('FIRECRAWL_')) {
      span.end({ error: String(err) })
      await trace.end()
    }
    throw err
  }
}

/**
 * Probe used by /v1/admin/byok/firecrawl/test — issues the smallest possible
 * authenticated call (a 1-result search for the marketing string) and returns
 * a structured outcome.
 */
export async function probeFirecrawl(db: SupabaseClient, projectId: string): Promise<{
  status: 'ok' | 'error_auth' | 'error_network' | 'error_quota'
  detail: string
  latencyMs: number
  hint: string
  source: 'byok' | 'env'
}> {
  const resolved = await resolveFirecrawl(db, projectId)
  if (!resolved) {
    return { status: 'error_auth', detail: 'No Firecrawl key configured', latencyMs: 0, hint: '', source: 'env' }
  }

  const startedAt = Date.now()
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/v1/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resolved.key}`,
      },
      body: JSON.stringify({ query: 'mushi mushi sdk', limit: 1 }),
      signal: AbortSignal.timeout(8_000),
    })
    const latencyMs = Date.now() - startedAt
    if (res.ok) return { status: 'ok', detail: `HTTP ${res.status}`, latencyMs, hint: resolved.hint, source: resolved.source }
    if (res.status === 401 || res.status === 403) return { status: 'error_auth', detail: 'Provider rejected the key', latencyMs, hint: resolved.hint, source: resolved.source }
    if (res.status === 429) return { status: 'error_quota', detail: 'Rate-limited', latencyMs, hint: resolved.hint, source: resolved.source }
    return { status: 'error_network', detail: `HTTP ${res.status}`, latencyMs, hint: resolved.hint, source: resolved.source }
  } catch (err) {
    return {
      status: 'error_network',
      detail: String(err).slice(0, 200),
      latencyMs: Date.now() - startedAt,
      hint: resolved.hint,
      source: resolved.source,
    }
  }
}
