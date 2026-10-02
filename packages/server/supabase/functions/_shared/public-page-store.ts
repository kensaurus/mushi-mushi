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
 */

import { sigV4 } from './storage.ts'
import type { PublicDiagramPayload } from './repo-diagram.ts'
import { publicPageKeys, renderPublicDiagramHtml, renderPublicDiagramMarkdown } from './public-diagram-page.ts'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Edge cache lifetime: an unpublished page is gone from every edge within this. */
export const PAGE_MAX_AGE_SECONDS = 300

export interface PublicPageStoreConfig {
  bucket: string
  region: string
  accessKey: string
  secretKey: string
}

export type StaticPageStatus = 'written' | 'deleted' | 'not_configured' | 'failed'

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
