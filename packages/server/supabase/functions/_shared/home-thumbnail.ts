/**
 * FILE: packages/server/supabase/functions/_shared/home-thumbnail.ts
 * PURPOSE: A screenshot of an app's live site for its Home card.
 *
 *          Firecrawl `/v2/scrape` with the `screenshot` format, on the
 *          project's OWN Firecrawl key (own, shared or universal; never the
 *          platform env key, ADR 0024). Firecrawl answers with a short-lived
 *          hosted URL; the bytes are downloaded at once (timeout, size cap,
 *          png / jpeg / webp only) and kept in the private `app-thumbnails`
 *          bucket at one fixed object per app, so nothing piles up. The
 *          console reads it through a signed URL. Firecrawl's URL is never
 *          stored.
 *
 *          One capture per app at a time: `claimCapture` is a conditional
 *          update on `last_attempt_at`, so two tabs (or a Refresh and a view)
 *          cannot both bill the key.
 *
 * No Deno globals; `fetchImpl` is injectable for tests.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const THUMBNAIL_BUCKET = 'app-thumbnails'
export const THUMBNAIL_TABLE = 'project_home_thumbnails'
export const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024
export const THUMBNAIL_URL_TTL_SEC = 3600
const FIRECRAWL_SCRAPE = 'https://api.firecrawl.dev/v2/scrape'
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export interface ThumbnailRow {
  project_id: string
  storage_path: string | null
  page_url: string | null
  captured_at: string | null
  last_attempt_at: string | null
  last_error: string | null
}

/**
 * Take the capture slot for `projectId` when the last attempt is older than
 * `minGapMs`. True when this caller won it.
 */
export async function claimCapture(db: SupabaseClient, projectId: string, now: Date, minGapMs: number): Promise<boolean> {
  const ins = await db.from(THUMBNAIL_TABLE).upsert({ project_id: projectId }, { onConflict: 'project_id', ignoreDuplicates: true })
  if (ins.error) throw new Error(ins.error.message)
  const cutoff = new Date(now.getTime() - minGapMs).toISOString()
  const { data, error } = await db
    .from(THUMBNAIL_TABLE)
    .update({ last_attempt_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('project_id', projectId)
    .or(`last_attempt_at.is.null,last_attempt_at.lt.${cutoff}`)
    .select('project_id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

export class ThumbnailError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') ?? '0')
  if (len > max) throw new ThumbnailError('TOO_LARGE', 'The screenshot is over 5 MB.')
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw new ThumbnailError('TOO_LARGE', 'The screenshot is over 5 MB.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

export interface CaptureDeps {
  fetchImpl?: typeof fetch
  now?: () => Date
}

/**
 * Screenshot `pageUrl` with `key` and store it. Records the outcome on the
 * thumbnail row (path and time, or the error) and returns the stored path.
 */
export async function captureThumbnail(
  db: SupabaseClient,
  projectId: string,
  pageUrl: string,
  key: string,
  deps: CaptureDeps = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => new Date())
  try {
    const res = await fetchImpl(FIRECRAWL_SCRAPE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        url: pageUrl,
        formats: [{ type: 'screenshot', fullPage: false, quality: 70, viewport: { width: 1280, height: 800 } }],
        onlyMainContent: false,
        timeout: 30_000,
      }),
      signal: AbortSignal.timeout(40_000),
    })
    if (res.status === 401 || res.status === 403) throw new ThumbnailError('FIRECRAWL_AUTH_FAILED', 'Firecrawl refused the key.')
    if (res.status === 402) throw new ThumbnailError('FIRECRAWL_NO_CREDITS', 'The Firecrawl account is out of credits.')
    if (!res.ok) throw new ThumbnailError(`FIRECRAWL_HTTP_${res.status}`, `Firecrawl answered ${res.status}.`)
    const json = (await res.json()) as { data?: { screenshot?: unknown } }
    const shot = json.data?.screenshot
    if (typeof shot !== 'string' || !/^https:\/\//i.test(shot)) throw new ThumbnailError('NO_SCREENSHOT', 'Firecrawl returned no screenshot.')

    const img = await fetchImpl(shot, { signal: AbortSignal.timeout(15_000), redirect: 'follow' })
    if (!img.ok) throw new ThumbnailError('DOWNLOAD_FAILED', `The screenshot download answered ${img.status}.`)
    const type = (img.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const ext = IMAGE_TYPES[type]
    if (!ext) throw new ThumbnailError('NOT_AN_IMAGE', `The screenshot is ${type || 'of no type'}, not png, jpeg or webp.`)
    const bytes = await readCapped(img, THUMBNAIL_MAX_BYTES)

    // One object per app; a type change leaves the old one, so clear both names.
    const path = `${projectId}/home.${ext}`
    const up = await db.storage.from(THUMBNAIL_BUCKET).upload(path, bytes, { contentType: type, upsert: true })
    if (up.error) throw new ThumbnailError('UPLOAD_FAILED', up.error.message)
    const stale = Object.values(IMAGE_TYPES).filter((e) => e !== ext).map((e) => `${projectId}/home.${e}`)
    await db.storage.from(THUMBNAIL_BUCKET).remove(stale).catch(() => {})

    const at = now().toISOString()
    const { error } = await db
      .from(THUMBNAIL_TABLE)
      .update({ storage_path: path, page_url: pageUrl, captured_at: at, last_error: null, updated_at: at })
      .eq('project_id', projectId)
    if (error) throw new ThumbnailError('DB_ERROR', error.message)
    return path
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    await db
      .from(THUMBNAIL_TABLE)
      .update({ last_error: message, updated_at: now().toISOString() })
      .eq('project_id', projectId)
      .then(() => undefined, () => undefined)
    throw err
  }
}
