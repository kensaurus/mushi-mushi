/**
 * FILE: packages/server/supabase/functions/_shared/public-page-store.ts
 * PURPOSE: Write and delete the static public diagram page (HTML + `.md`)
 *          in the kensaur.us S3 bucket, so publish and unpublish take effect
 *          at once (cached at most PAGE_MAX_AGE_SECONDS at the edge).
 *
 * Off until an operator sets the four MUSHI_PUBLIC_PAGES_* secrets (an IAM
 * user limited to s3:PutObject / s3:DeleteObject on `mushi-mushi/r/*`; see
 * docs/operators/public-diagram-pages.md). While off, publishing still works:
 * the CloudFront rewrite finds no object, the docs 404 page renders the
 * diagram client-side with status 404, and nothing is indexed.
 *
 * Signing reuses storage.ts's inline SigV4 (no AWS SDK on the edge runtime).
 * Path-style URLs, because the bucket name contains dots.
 *
 * It also keeps `mushi-mushi/r/sitemap.xml` (every page whose static file
 * exists) in step: publish, unpublish and project delete regenerate it from
 * `public_repo_diagrams`. The docs sitemap is built at docs deploy time and
 * cannot know pages published after it.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sigV4 } from './storage.ts'
import type { PublicDiagramPayload } from './repo-diagram.ts'
import {
  escapeHtml,
  publicPageKeys,
  publicPageUrls,
  renderPublicDiagramHtml,
  renderPublicDiagramMarkdown,
} from './public-diagram-page.ts'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * `Cache-Control: max-age` on the objects. Whether CloudFront honors it is
 * the `/mushi-mushi/*` behavior's cache policy (its min/max TTL); with the
 * default policy an unpublished page leaves the edge when this expires.
 */
export const PAGE_MAX_AGE_SECONDS = 300

export interface PublicPageStoreConfig {
  bucket: string
  region: string
  accessKey: string
  secretKey: string
}

export type StaticPageStatus = 'written' | 'deleted' | 'not_configured' | 'failed'

/** S3 key of the `/r/` sitemap. Inside the IAM user's `mushi-mushi/r/*` grant. */
export const SITEMAP_KEY = 'mushi-mushi/r/sitemap.xml'
/** The sitemaps.org protocol allows 50,000 URLs per file. */
const SITEMAP_MAX_URLS = 50_000
/** PostgREST returns at most 1000 rows per request. */
const SITEMAP_PAGE_ROWS = 1000

/** Read the store config at call time (never at module load: Deno CI runs tests with no env permission). */
export function readPublicPageStoreConfig(get: (name: string) => string | undefined): PublicPageStoreConfig | null {
  const bucket = get('MUSHI_PUBLIC_PAGES_BUCKET')?.trim()
  const region = get('MUSHI_PUBLIC_PAGES_REGION')?.trim()
  const accessKey = get('MUSHI_PUBLIC_PAGES_ACCESS_KEY_ID')?.trim()
  const secretKey = get('MUSHI_PUBLIC_PAGES_SECRET_ACCESS_KEY')?.trim()
  if (!bucket || !region || !accessKey || !secretKey) return null
  return { bucket, region, accessKey, secretKey }
}

function objectUrl(cfg: PublicPageStoreConfig, key: string): string {
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  return `https://s3.${cfg.region}.amazonaws.com/${cfg.bucket}/${encoded}`
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function putObject(cfg: PublicPageStoreConfig, key: string, body: string, contentType: string, fetchImpl: FetchLike): Promise<void> {
  const bytes = new TextEncoder().encode(body)
  const url = objectUrl(cfg, key)
  const headers = await sigV4(
    cfg,
    'PUT',
    url,
    {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${PAGE_MAX_AGE_SECONDS}`,
      'x-amz-content-sha256': await sha256Hex(bytes),
    },
    bytes,
  )
  const res = await fetchImpl(url, { method: 'PUT', headers, body: bytes, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`S3 PUT ${key} → ${res.status}`)
}

async function deleteObject(cfg: PublicPageStoreConfig, key: string, fetchImpl: FetchLike): Promise<void> {
  const url = objectUrl(cfg, key)
  const headers = await sigV4(cfg, 'DELETE', url, { 'x-amz-content-sha256': await sha256Hex(new Uint8Array()) })
  const res = await fetchImpl(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(15_000) })
  // S3 answers 204 for a delete, also when the key never existed.
  if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${key} → ${res.status}`)
}

export async function writePublicPage(
  cfg: PublicPageStoreConfig | null,
  payload: PublicDiagramPayload,
  fetchImpl: FetchLike = fetch,
): Promise<StaticPageStatus> {
  if (!cfg) return 'not_configured'
  const keys = publicPageKeys(payload.owner, payload.repo)
  // Markdown first: the HTML links to it.
  await putObject(cfg, keys.markdown, renderPublicDiagramMarkdown(payload), 'text/markdown; charset=utf-8', fetchImpl)
  await putObject(cfg, keys.html, renderPublicDiagramHtml(payload), 'text/html; charset=utf-8', fetchImpl)
  return 'written'
}

/**
 * The page a republish would orphan: the project's current publication names
 * a different repo (the project switched repos, or the repo was renamed on
 * GitHub). Its files must go before the row is overwritten, because nothing
 * else will ever name those keys again. Case-insensitive, like the keys.
 */
export function staleStaticPage(
  prior: { owner: string; repo: string } | null,
  next: { owner: string; repo: string },
): { owner: string; repo: string } | null {
  if (!prior) return null
  const same =
    prior.owner.toLowerCase() === next.owner.toLowerCase() && prior.repo.toLowerCase() === next.repo.toLowerCase()
  return same ? null : prior
}

/**
 * Removal of a project's static page before the project (and,
 * by cascade, its publication row) is deleted. Without this the files would
 * outlive the only record that names them, so a 'failed' result must stop
 * the delete. Never throws.
 */
export async function removeProjectPublicPage(
  db: { from: (t: string) => any },
  projectId: string,
  cfg: PublicPageStoreConfig | null,
  onError: (err: unknown) => void,
  fetchImpl: FetchLike = fetch,
): Promise<StaticPageStatus | 'none'> {
  try {
    const { data, error } = await db
      .from('public_repo_diagrams')
      .select('payload, static_page_at')
      .eq('project_id', projectId)
      .maybeSingle()
    // Not knowing whether a page exists is not "no page": stop the delete.
    if (error) {
      onError(error)
      return 'failed'
    }
    const row = data as { payload?: { owner?: string; repo?: string }; static_page_at?: string | null } | null
    if (!row?.payload?.owner || !row.payload.repo) return 'none'
    return await deletePublicPage(cfg, row.payload.owner, row.payload.repo, fetchImpl)
  } catch (err) {
    onError(err)
    return 'failed'
  }
}

export async function deletePublicPage(
  cfg: PublicPageStoreConfig | null,
  owner: string,
  repo: string,
  fetchImpl: FetchLike = fetch,
): Promise<StaticPageStatus> {
  if (!cfg) return 'not_configured'
  const keys = publicPageKeys(owner, repo)
  // HTML first: the page stops being served before its twin goes.
  await deleteObject(cfg, keys.html, fetchImpl)
  await deleteObject(cfg, keys.markdown, fetchImpl)
  return 'deleted'
}

// ── /r/ sitemap ──────────────────────────────────────────────────────────

export interface SitemapEntry {
  owner: string
  repo: string
  /** When the static file was last written (ISO). */
  lastmod: string | null
}

/**
 * sitemaps.org XML for the published pages. `<loc>` is the page's canonical
 * URL (GitHub's spelling, as in the page's own `<link rel="canonical">`).
 * Sorted, so an unchanged set renders byte-identical. An empty set is still
 * a valid file: after the last unpublish the sitemap lists nothing.
 */
export function renderPublicSitemap(entries: ReadonlyArray<SitemapEntry>): string {
  const rows = [...entries]
    .sort((a, b) => `${a.owner}/${a.repo}`.toLowerCase().localeCompare(`${b.owner}/${b.repo}`.toLowerCase()))
    .slice(0, SITEMAP_MAX_URLS)
    .map((e) => {
      const loc = `    <loc>${escapeHtml(publicPageUrls(e.owner, e.repo, '').page)}</loc>`
      const ms = e.lastmod ? Date.parse(e.lastmod) : NaN
      const lastmod = Number.isFinite(ms) ? `\n    <lastmod>${new Date(ms).toISOString()}</lastmod>` : ''
      return `  <url>\n${loc}${lastmod}\n  </url>`
    })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    '</urlset>',
    '',
  ].join('\n')
}

/**
 * Every publication whose static file exists (`static_page_at` set). Rows
 * without it point at the unindexed interactive view, so they stay out.
 * Throws on a read error: a sitemap built from a partial read would drop
 * live pages.
 */
export async function loadSitemapEntries(db: SupabaseClient): Promise<SitemapEntry[]> {
  const out: SitemapEntry[] = []
  for (let from = 0; from < SITEMAP_MAX_URLS; from += SITEMAP_PAGE_ROWS) {
    const { data, error } = await db
      .from('public_repo_diagrams')
      .select('project_id, payload, static_page_at')
      .not('static_page_at', 'is', null)
      .order('project_id', { ascending: true })
      .range(from, from + SITEMAP_PAGE_ROWS - 1)
    if (error) throw new Error(`public_repo_diagrams read failed: ${error.message}`)
    const rows = (data ?? []) as Array<{ payload?: { owner?: unknown; repo?: unknown } | null; static_page_at?: string | null }>
    for (const r of rows) {
      const owner = r.payload?.owner
      const repo = r.payload?.repo
      if (typeof owner !== 'string' || typeof repo !== 'string' || !owner || !repo) continue
      out.push({ owner, repo, lastmod: r.static_page_at ?? null })
    }
    if (rows.length < SITEMAP_PAGE_ROWS) break
  }
  return out
}

export async function writePublicSitemap(
  cfg: PublicPageStoreConfig | null,
  entries: ReadonlyArray<SitemapEntry>,
  fetchImpl: FetchLike = fetch,
): Promise<StaticPageStatus> {
  if (!cfg) return 'not_configured'
  await putObject(cfg, SITEMAP_KEY, renderPublicSitemap(entries), 'application/xml; charset=utf-8', fetchImpl)
  return 'written'
}

/**
 * Rewrite the sitemap from the current publications. Called after publish
 * (once `static_page_at` is set), after unpublish (once the row is gone) and
 * after project delete. Never throws: a stale sitemap only delays indexing,
 * so it must not fail the publish, and the next publish or unpublish
 * rewrites it in full.
 */
export async function regeneratePublicSitemap(
  db: SupabaseClient,
  cfg: PublicPageStoreConfig | null,
  onError: (err: unknown) => void,
  fetchImpl: FetchLike = fetch,
): Promise<StaticPageStatus> {
  if (!cfg) return 'not_configured'
  try {
    return await writePublicSitemap(cfg, await loadSitemapEntries(db), fetchImpl)
  } catch (err) {
    onError(err)
    return 'failed'
  }
}
