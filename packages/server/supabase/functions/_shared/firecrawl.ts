/**
 * FILE: packages/server/supabase/functions/_shared/firecrawl.ts
 * PURPOSE: BYOK Firecrawl client (API v2) used by:
 *            * /v1/admin/research/* (manual triage research)
 *            * known-issues ("Others who hit this" on error reports)
 *            * fix-worker (auto-augment when local RAG is sparse)
 *            * library-modernizer cron (release-notes scraping)
 *            * story-mapper (map + scrape of the app's live site)
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

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log as rootLog } from './logger.ts';
import { createTrace } from './observability.ts';
import { markKeyUsed, resolveLlmKey } from './byok.ts';

const log = rootLog.child('firecrawl');

const FIRECRAWL_BASE = 'https://api.firecrawl.dev';
const CACHE_TTL_HOURS = 24;

export interface FirecrawlSearchResult {
  url: string;
  title: string;
  snippet: string;
  markdown?: string;
}

export interface FirecrawlScrapeResult {
  url: string;
  title?: string;
  markdown: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

export interface ResolvedFirecrawl {
  keyId?: string;
  key: string;
  source: 'byok' | 'env';
  hint: string;
  allowedDomains: string[];
  maxPagesPerCall: number;
}

export async function resolveFirecrawl(
  db: SupabaseClient,
  projectId: string,
): Promise<ResolvedFirecrawl | null> {
  const { data: settings, error } = await db
    .from('project_settings')
    .select('byok_firecrawl_key_ref, firecrawl_allowed_domains, firecrawl_max_pages_per_call')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error)
    log.warn('Failed to read project_settings for Firecrawl', { projectId, error: error.message });

  const allowedDomains = (settings?.firecrawl_allowed_domains as string[] | null | undefined) ?? [];
  const maxPagesPerCall =
    (settings?.firecrawl_max_pages_per_call as number | null | undefined) ?? 5;
  const resolved = await resolveLlmKey(db, projectId, 'firecrawl');
  if (!resolved) return null;

  return {
    keyId: resolved.keyId,
    key: resolved.key,
    source: resolved.source,
    hint: resolved.hint,
    allowedDomains,
    maxPagesPerCall,
  };
}

function isHostAllowed(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) {
    // Fail-closed in production: require explicit allowlist before crawling.
    const env = Deno.env.get('SUPABASE_ENV') ?? Deno.env.get('DENO_ENV') ?? 'production';
    if (env === 'production') return false;
    return true;
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowedDomains.some((d) => {
      const needle = d
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');
      if (!needle) return false;
      return host === needle || host.endsWith(`.${needle}`);
    });
  } catch {
    return false;
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
    .maybeSingle();
  return (data?.payload as T | undefined) ?? null;
}

async function writeCache(
  db: SupabaseClient,
  projectId: string,
  mode: 'search' | 'scrape',
  cacheKey: string,
  payload: unknown,
): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 3_600_000).toISOString();
  await db
    .from('firecrawl_cache')
    .upsert(
      { project_id: projectId, mode, cache_key: cacheKey, payload, expires_at: expiresAt },
      { onConflict: 'project_id,mode,cache_key' },
    );
}

export interface FirecrawlSearchOptions {
  /** Hard upper bound on returned snippets. Capped by the project's max_pages_per_call. */
  limit?: number;
  /** Restrict to a subset of domains (intersected with the project allow-list). */
  domains?: string[];
  /** Bypass the 24h cache when true. */
  bypassCache?: boolean;
  /**
   * `developer`: Firecrawl's index of GitHub issues, merged pull requests,
   * READMEs and docs. For an error message it finds the PR that fixed it,
   * where a web search finds generic how-to pages. It cannot be combined
   * with `domains` (v2 rule), so results are not domain-filtered.
   */
  category?: 'developer';
  /** Also fetch each result page as markdown: 1 more credit per result. Default true. */
  scrape?: boolean;
}

/** The host part of an allow-list entry ("https://github.com/x" → "github.com"). */
function bareHost(entry: string): string {
  return entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/**
 * firecrawlSearch — calls Firecrawl `/v2/search` for a query string.
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
  const resolved = await resolveFirecrawl(db, projectId);
  if (!resolved) throw new Error('FIRECRAWL_NOT_CONFIGURED');

  const limit = Math.min(opts.limit ?? 5, resolved.maxPagesPerCall);
  const domainFilter =
    opts.domains && opts.domains.length > 0 ? opts.domains : resolved.allowedDomains;

  const category = opts.category;
  const scrape = opts.scrape !== false;
  const cacheKey = JSON.stringify({
    q: query.trim().toLowerCase().slice(0, 240),
    limit,
    d: category ? [] : domainFilter.slice().sort(),
    c: category ?? null,
    s: scrape,
  });
  if (!opts.bypassCache) {
    const cached = await readCache<FirecrawlSearchResult[]>(db, projectId, 'search', cacheKey);
    if (cached) return cached;
  }

  const trace = createTrace('firecrawl.search', { projectId, query: query.slice(0, 80) });
  const span = trace.span('http');

  try {
    const body: Record<string, unknown> = { query, limit, sources: ['web'] };
    if (scrape) body.scrapeOptions = { formats: ['markdown'], onlyMainContent: true };
    if (category) body.categories = [category];
    else if (domainFilter.length > 0) body.includeDomains = [...new Set(domainFilter.map(bareHost).filter(Boolean))];

    const res = await fetch(`${FIRECRAWL_BASE}/v2/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const text = await res.text();
      span.end({ statusCode: res.status, error: text.slice(0, 200) });
      await trace.end();
      if (res.status === 401 || res.status === 403) throw new Error('FIRECRAWL_AUTH_FAILED');
      if (res.status === 429) throw new Error('FIRECRAWL_RATE_LIMITED');
      throw new Error(`FIRECRAWL_HTTP_${res.status}`);
    }

    type SearchRow = { url: string; title?: string; description?: string; markdown?: string };
    const json = (await res.json()) as { data?: SearchRow[] | { web?: SearchRow[] } };
    // v2 groups results by source (`data.web`); v1 returned a flat array.
    const rows = Array.isArray(json.data) ? json.data : (json.data?.web ?? []);
    const results: FirecrawlSearchResult[] = rows
      .filter((r) => typeof r?.url === 'string')
      .filter((r) => category || domainFilter.length === 0 || isHostAllowed(r.url, domainFilter))
      .slice(0, limit)
      .map((r) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: (r.description ?? r.markdown ?? '').slice(0, 600),
        markdown: r.markdown,
      }));

    span.end({ statusCode: res.status });
    await trace.end();
    if (resolved.source === 'byok') {
      await markKeyUsed(db, projectId, 'firecrawl', resolved.keyId).catch((error) => {
        log.warn('Firecrawl usage bookkeeping failed (non-fatal)', {
          projectId,
          error: String(error),
        });
      });
    }

    void writeCache(db, projectId, 'search', cacheKey, results).catch(() => {
      /* best-effort */
    });
    return results;
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('FIRECRAWL_')) {
      span.end({ error: String(err) });
      await trace.end();
    }
    throw err;
  }
}

export interface FirecrawlScrapeOptions {
  bypassCache?: boolean;
  /**
   * Hosts the caller itself built this URL on (a package registry for a
   * changelog). The project allow-list limits URLs a person or a model
   * chose; with an empty list production refuses every URL, which silently
   * stopped the library modernizer from reading any changelog.
   */
  trustedHosts?: readonly string[];
}

export async function firecrawlScrape(
  db: SupabaseClient,
  projectId: string,
  url: string,
  opts: FirecrawlScrapeOptions = {},
): Promise<FirecrawlScrapeResult> {
  const resolved = await resolveFirecrawl(db, projectId);
  if (!resolved) throw new Error('FIRECRAWL_NOT_CONFIGURED');

  const trusted = (opts.trustedHosts?.length ?? 0) > 0 && isHostAllowed(url, [...opts.trustedHosts!]);
  if (!trusted && !isHostAllowed(url, resolved.allowedDomains)) {
    throw new Error('FIRECRAWL_DOMAIN_NOT_ALLOWED');
  }

  if (!opts.bypassCache) {
    const cached = await readCache<FirecrawlScrapeResult>(db, projectId, 'scrape', url);
    if (cached) return cached;
  }

  const trace = createTrace('firecrawl.scrape', { projectId, url: url.slice(0, 200) });
  const span = trace.span('http');

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/v2/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.key}`,
      },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text();
      span.end({ statusCode: res.status, error: text.slice(0, 200) });
      await trace.end();
      if (res.status === 401 || res.status === 403) throw new Error('FIRECRAWL_AUTH_FAILED');
      if (res.status === 429) throw new Error('FIRECRAWL_RATE_LIMITED');
      throw new Error(`FIRECRAWL_HTTP_${res.status}`);
    }

    const json = (await res.json()) as {
      data?: { markdown?: string; html?: string; metadata?: Record<string, unknown> };
    };
    const result: FirecrawlScrapeResult = {
      url,
      title: json.data?.metadata?.title as string | undefined,
      markdown: json.data?.markdown ?? '',
      html: json.data?.html,
      metadata: json.data?.metadata,
    };

    span.end({ statusCode: res.status });
    await trace.end();
    if (resolved.source === 'byok') {
      await markKeyUsed(db, projectId, 'firecrawl', resolved.keyId).catch((error) => {
        log.warn('Firecrawl usage bookkeeping failed (non-fatal)', {
          projectId,
          error: String(error),
        });
      });
    }

    void writeCache(db, projectId, 'scrape', url, result).catch(() => {
      /* best-effort */
    });
    return result;
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('FIRECRAWL_')) {
      span.end({ error: String(err) });
      await trace.end();
    }
    throw err;
  }
}

export interface FirecrawlMapOptions {
  /** Most links to return. Default 50, at most 500. */
  limit?: number;
  /** As for firecrawlScrape: hosts the caller chose, outside the allow-list. */
  trustedHosts?: readonly string[];
}

/**
 * The URLs Firecrawl knows under `url` (1 credit per call), without their
 * content. Same key, allow-list and usage bookkeeping as search and scrape.
 */
export async function firecrawlMap(
  db: SupabaseClient,
  projectId: string,
  url: string,
  opts: FirecrawlMapOptions = {},
): Promise<string[]> {
  const resolved = await resolveFirecrawl(db, projectId);
  if (!resolved) throw new Error('FIRECRAWL_NOT_CONFIGURED');

  const trusted = (opts.trustedHosts?.length ?? 0) > 0 && isHostAllowed(url, [...opts.trustedHosts!]);
  if (!trusted && !isHostAllowed(url, resolved.allowedDomains)) {
    throw new Error('FIRECRAWL_DOMAIN_NOT_ALLOWED');
  }

  const trace = createTrace('firecrawl.map', { projectId, url: url.slice(0, 200) });
  const span = trace.span('http');
  const res = await fetch(`${FIRECRAWL_BASE}/v2/map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resolved.key}` },
    body: JSON.stringify({ url, limit: Math.min(Math.max(opts.limit ?? 50, 1), 500) }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    span.end({ error: String(err) });
    throw err;
  });
  if (!res.ok) {
    const text = await res.text();
    span.end({ statusCode: res.status, error: text.slice(0, 200) });
    await trace.end();
    if (res.status === 401 || res.status === 403) throw new Error('FIRECRAWL_AUTH_FAILED');
    if (res.status === 429) throw new Error('FIRECRAWL_RATE_LIMITED');
    throw new Error(`FIRECRAWL_HTTP_${res.status}`);
  }
  // v2 returns link objects ({ url, title, description }); v1 returned strings.
  const json = (await res.json()) as { links?: Array<string | { url?: string }> };
  const links = (json.links ?? [])
    .map((l) => (typeof l === 'string' ? l : l?.url))
    .filter((l): l is string => typeof l === 'string');
  span.end({ statusCode: res.status });
  await trace.end();
  if (resolved.source === 'byok') {
    await markKeyUsed(db, projectId, 'firecrawl', resolved.keyId).catch((error) => {
      log.warn('Firecrawl usage bookkeeping failed (non-fatal)', { projectId, error: String(error) });
    });
  }
  return links;
}

/**
 * Probe used by /v1/admin/byok/firecrawl/test — issues the smallest possible
 * authenticated call (a 1-result search for the marketing string) and returns
 * a structured outcome.
 */
export async function probeFirecrawl(
  db: SupabaseClient,
  projectId: string,
): Promise<{
  status: 'ok' | 'error_auth' | 'error_network' | 'error_quota';
  detail: string;
  latencyMs: number;
  hint: string;
  source: 'byok' | 'env';
}> {
  const resolved = await resolveFirecrawl(db, projectId);
  if (!resolved) {
    return {
      status: 'error_auth',
      detail: 'No Firecrawl key configured',
      latencyMs: 0,
      hint: '',
      source: 'env',
    };
  }

  const startedAt = Date.now();
  try {
    // Free check: reads the team's remaining credits instead of running a
    // search, which cost a credit on every test.
    const res = await fetch(`${FIRECRAWL_BASE}/v2/team/credit-usage`, {
      headers: { Authorization: `Bearer ${resolved.key}` },
      signal: AbortSignal.timeout(8_000),
    });
    const latencyMs = Date.now() - startedAt;
    if (res.ok) {
      if (resolved.source === 'byok') {
        await markKeyUsed(db, projectId, 'firecrawl', resolved.keyId).catch((error) => {
          log.warn('Firecrawl usage bookkeeping failed (non-fatal)', {
            projectId,
            error: String(error),
          });
        });
      }
      return {
        status: 'ok',
        detail: `HTTP ${res.status}`,
        latencyMs,
        hint: resolved.hint,
        source: resolved.source,
      };
    }
    if (res.status === 401 || res.status === 403)
      return {
        status: 'error_auth',
        detail: 'Provider rejected the key',
        latencyMs,
        hint: resolved.hint,
        source: resolved.source,
      };
    if (res.status === 429)
      return {
        status: 'error_quota',
        detail: 'Rate-limited',
        latencyMs,
        hint: resolved.hint,
        source: resolved.source,
      };
    return {
      status: 'error_network',
      detail: `HTTP ${res.status}`,
      latencyMs,
      hint: resolved.hint,
      source: resolved.source,
    };
  } catch (err) {
    return {
      status: 'error_network',
      detail: String(err).slice(0, 200),
      latencyMs: Date.now() - startedAt,
      hint: resolved.hint,
      source: resolved.source,
    };
  }
}
