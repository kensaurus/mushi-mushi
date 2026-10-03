/**
 * FILE: packages/server/supabase/functions/_shared/store-review-intake.ts
 * PURPOSE: Store reviews become Mushi reports (gap #23, Plan 020 §5). Per
 *          project opt-in (project_settings.store_review_intake_enabled, off
 *          by default). Reads App Store and Google Play reviews through the
 *          project's existing store connectors (the same Vault-held keys the
 *          recipe snapshot uses, read-only), remembers every review it has
 *          seen in store_review_items, and files a report (source
 *          'store_review') for each new review at or under the project's star
 *          threshold (default 2, so only 1 and 2 star reviews).
 *
 *   App Store:   GET /v1/apps/{id}/customerReviews?sort=-createdDate
 *                (rating, title, body, territory, createdDate).
 *   Google Play: GET applications/{package}/reviews (Play returns reviews
 *                added or edited in the last week; starRating, text,
 *                appVersionName, device, reviewerLanguage).
 *
 * Bounds: a review older than 30 days is recorded as seen, never filed, so
 * switching the intake on does not file a backlog. At most 25 reports per
 * store per run; the rest wait for the next run. The reviewer's name is
 * never stored. Review text is untrusted and goes through the same
 * classification path as widget text.
 */

import type { getServiceClient } from './db.ts'
import { resolveCredential } from './connectors/credentials.ts'
import { appStoreConnectGet } from './connectors/app-store-connect.ts'
import { isPlayPackage, playConsoleGet } from './connectors/play-console.ts'
import { statusReason } from './connectors/http-util.ts'
import { ConnectorError, type ConnectorContext } from './connectors/types.ts'

type Db = ReturnType<typeof getServiceClient>

export type ReviewStore = 'app_store' | 'play'

export interface StoreReview {
  store: ReviewStore
  reviewId: string
  rating: number | null
  title: string
  body: string
  territory: string | null
  language: string | null
  appVersion: string | null
  device: string | null
  createdAt: string | null
}

export const DEFAULT_MAX_RATING = 2
export const MAX_FILED_PER_STORE_RUN = 25
export const FILE_WINDOW_DAYS = 30
const MAX_SOURCES = 4
const APPLE_ID = /^\d{6,12}$/

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function rating(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

/** App Store Connect customerReviews → reviews. Rows without an id are dropped. */
export function parseAppStoreReviews(body: unknown): StoreReview[] {
  const data = (body as { data?: Array<{ id?: unknown; attributes?: Record<string, unknown> }> } | null)?.data ?? []
  return data.flatMap((r) => {
    const id = str(r.id)
    if (!id) return []
    const a = r.attributes ?? {}
    return [{
      store: 'app_store' as const,
      reviewId: id.slice(0, 200),
      rating: rating(a.rating),
      title: (str(a.title) ?? '').slice(0, 300),
      body: (str(a.body) ?? '').slice(0, 6000),
      territory: str(a.territory),
      language: null,
      appVersion: null,
      device: null,
      createdAt: str(a.createdDate),
    }]
  })
}

/** Google Play reviews.list → reviews (the user's own comment only, never a developer reply). */
export function parsePlayReviews(body: unknown): StoreReview[] {
  const list = (body as { reviews?: Array<{ reviewId?: unknown; comments?: Array<{ userComment?: Record<string, unknown> }> }> } | null)?.reviews ?? []
  return list.flatMap((r) => {
    const id = str(r.reviewId)
    const c = (r.comments ?? []).find((x) => x.userComment)?.userComment
    if (!id || !c) return []
    const seconds = Number((c.lastModified as { seconds?: unknown } | undefined)?.seconds)
    return [{
      store: 'play' as const,
      reviewId: id.slice(0, 200),
      rating: rating(c.starRating),
      title: '',
      body: (str(c.text) ?? '').slice(0, 6000),
      territory: null,
      language: str(c.reviewerLanguage),
      appVersion: str(c.appVersionName),
      device: str(c.device),
      createdAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null,
    }]
  })
}

const STORE_LABEL: Record<ReviewStore, string> = { app_store: 'App Store', play: 'Google Play' }

export function reviewSeverity(stars: number | null): 'high' | 'medium' | 'low' {
  if (stars === 1) return 'high'
  if (stars === 2) return 'medium'
  return 'low'
}

/** Whether a review should become a report: rated, at or under the threshold, and recent enough. */
export function shouldFile(review: StoreReview, maxRating: number, now: Date): boolean {
  if (review.rating === null || review.rating > maxRating) return false
  if (!review.body && !review.title) return false
  if (review.createdAt) {
    const t = Date.parse(review.createdAt)
    if (Number.isFinite(t) && now.getTime() - t > FILE_WINDOW_DAYS * 86400_000) return false
  }
  return true
}

/** The reports row for one review. The reviewer's name is never included. */
export function buildStoreReviewReport(projectId: string, review: StoreReview, now: Date): Record<string, unknown> {
  const store = STORE_LABEL[review.store]
  const stars = review.rating === null ? 'unrated' : `${review.rating}-star`
  const facts = [review.territory, review.appVersion ? `version ${review.appVersion}` : null, review.device, review.createdAt?.slice(0, 10)].filter(Boolean).join(', ')
  const text = review.title && review.body ? `${review.title}\n\n${review.body}` : review.title || review.body
  const headline = (review.title || review.body).replace(/\s+/g, ' ').trim().slice(0, 100)
  const nowIso = now.toISOString()
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    description: `${text}\n\n(${stars} ${store} review${facts ? `, ${facts}` : ''})`,
    title: `${stars} ${store} review: ${headline}`.slice(0, 200),
    category: 'other',
    user_category: 'store_review',
    severity: reviewSeverity(review.rating),
    status: 'new',
    source: 'store_review',
    reporter_token_hash: 'store-review',
    environment: {
      userAgent: 'store-review',
      platform: review.store === 'app_store' ? 'ios' : 'android',
      language: review.language ?? '',
      viewport: { width: 0, height: 0 },
      url: '',
      referrer: '',
      timestamp: review.createdAt ?? nowIso,
      timezone: 'UTC',
    },
    custom_metadata: {
      source: 'store_review',
      store: review.store,
      reviewId: review.reviewId,
      rating: review.rating,
      territory: review.territory,
      appVersion: review.appVersion,
      device: review.device,
      reviewCreatedAt: review.createdAt,
    },
    synced_at: nowIso,
    created_at: nowIso,
  }
}

interface StoreSource {
  store: ReviewStore
  appId: string
  ctx: ConnectorContext
}

export interface StoreRunLine {
  store: ReviewStore
  appId: string
  status: 'ok' | 'error' | 'not_connected'
  fetched: number
  newReviews: number
  filed: number
  detail: string | null
}

export interface StoreIntakeResult {
  status: 'ok' | 'partial' | 'failed' | 'not_connected' | 'disabled'
  filed: number
  stores: StoreRunLine[]
}

export interface StoreIntakeDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  now: () => Date
  /** Queue a new report for classification (fire-and-forget). */
  classify: (db: Db, reportId: string, projectId: string) => Promise<void> | void
}

/** Projects one cron run pulls at most; the rest wait for the next run. */
export const MAX_PROJECTS_PER_RUN = 50

/**
 * The opted-in projects to pull this run, least recently pulled first, so that
 * past MAX_PROJECTS_PER_RUN every project still gets its turn. Postgres sorts
 * NULLs last when ascending, so never-pulled projects are put first explicitly.
 * A read failure throws: the caller reports it instead of pulling nothing.
 */
export async function projectsDueForStoreReviews(db: Db, only: string | null = null): Promise<string[]> {
  let q = db
    .from('project_settings')
    .select('project_id')
    .eq('store_review_intake_enabled', true)
    .order('store_review_last_pulled_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PROJECTS_PER_RUN)
  if (only) q = q.eq('project_id', only)
  const { data, error } = await q
  if (error) throw new Error(`could not read the projects to pull: ${error.message}`)
  return ((data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id)
}

/** The App Store apps and Play packages bound to this project through its store connectors. */
export async function loadStoreSources(db: Db, projectId: string, deps: Pick<StoreIntakeDeps, 'fetch' | 'now'>): Promise<StoreSource[]> {
  const { data: project, error: pErr } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  if (pErr) throw new Error(`could not read the project: ${pErr.message}`)
  const organizationId = (project as { organization_id?: string } | null)?.organization_id
  if (!organizationId) return []
  const [{ data: binds, error: bErr }, { data: owned, error: oErr }] = await Promise.all([
    db.from('connector_bindings').select('connector_instance_id, external_id').eq('project_id', projectId).limit(50),
    db.from('connector_instances').select('id').eq('project_id', projectId).in('kind', ['app_store_connect', 'play_console']).limit(10),
  ])
  if (bErr || oErr) throw new Error(`could not read the store connectors: ${(bErr ?? oErr)?.message}`)
  const bindRows = (binds ?? []) as Array<{ connector_instance_id: string; external_id: string }>
  const ids = [...new Set([...bindRows.map((b) => b.connector_instance_id), ...((owned ?? []) as Array<{ id: string }>).map((o) => o.id)])]
  if (ids.length === 0) return []
  const { data: rows, error } = await db
    .from('connector_instances')
    .select('id, kind, project_id, read_credential_ref, config')
    .in('id', ids)
    .eq('organization_id', organizationId)
    .in('kind', ['app_store_connect', 'play_console'])
  if (error) throw new Error(`could not read the store connectors: ${error.message}`)
  const out: StoreSource[] = []
  for (const r of (rows ?? []) as Array<{ id: string; kind: string; project_id: string | null; read_credential_ref: string | null; config: Record<string, unknown> | null }>) {
    const external = bindRows.filter((b) => b.connector_instance_id === r.id).map((b) => b.external_id)
    const store: ReviewStore = r.kind === 'app_store_connect' ? 'app_store' : 'play'
    // The instance's own package counts only when the instance belongs to this app.
    const configuredPackage = r.project_id === projectId ? r.config?.package : undefined
    const appIds = store === 'app_store'
      ? external.filter((x) => APPLE_ID.test(x))
      : [...external.filter(isPlayPackage), ...(isPlayPackage(configuredPackage) ? [configuredPackage] : [])]
    if (appIds.length === 0) continue
    const readCredential = await resolveCredential(db, r.read_credential_ref)
    const ctx: ConnectorContext = { db, organizationId, projectId, readCredential, writeCredential: null, config: r.config ?? {}, fetch: deps.fetch, now: deps.now }
    for (const appId of [...new Set(appIds)]) out.push({ store, appId, ctx })
  }
  return out.slice(0, MAX_SOURCES)
}

async function fetchReviews(source: StoreSource): Promise<StoreReview[]> {
  if (source.store === 'app_store') {
    const res = await appStoreConnectGet(source.ctx, `/v1/apps/${source.appId}/customerReviews?sort=-createdDate&limit=100&fields[customerReviews]=rating,title,body,territory,createdDate`)
    if (res.status !== 200) throw new ConnectorError(statusReason('App Store Connect', res.status))
    return parseAppStoreReviews(res.body)
  }
  const res = await playConsoleGet(source.ctx, `/${source.appId}/reviews?maxResults=100`)
  if (res.status !== 200) throw new ConnectorError(statusReason('Google Play', res.status))
  return parsePlayReviews(res.body)
}

async function recordStatus(db: Db, projectId: string, now: Date, status: 'ok' | 'partial' | 'failed' | 'not_connected', error: string | null): Promise<void> {
  await db.from('project_settings').update({
    store_review_last_pulled_at: now.toISOString(),
    store_review_last_status: status,
    store_review_last_error: error ? error.slice(0, 500) : null,
  }).eq('project_id', projectId)
}

/** Pull one project's reviews and file the low-star ones. Never throws for a store error; each store reports its own line. */
export async function runStoreReviewIntake(db: Db, projectId: string, deps: StoreIntakeDeps): Promise<StoreIntakeResult> {
  const now = deps.now()
  const { data: settings, error: sErr } = await db.from('project_settings').select('store_review_intake_enabled, store_review_max_rating').eq('project_id', projectId).maybeSingle()
  if (sErr) throw new Error(`could not read the project settings: ${sErr.message}`)
  const s = settings as { store_review_intake_enabled?: boolean | null; store_review_max_rating?: number | null } | null
  if (!s?.store_review_intake_enabled) return { status: 'disabled', filed: 0, stores: [] }
  const maxRating = s.store_review_max_rating ?? DEFAULT_MAX_RATING

  let sources: StoreSource[]
  try {
    sources = await loadStoreSources(db, projectId, deps)
  } catch (err) {
    const message = String((err as Error)?.message ?? err)
    await recordStatus(db, projectId, now, 'failed', message)
    return { status: 'failed', filed: 0, stores: [] }
  }
  if (sources.length === 0) {
    await recordStatus(db, projectId, now, 'not_connected', 'No App Store Connect or Google Play source is bound to this app.')
    return { status: 'not_connected', filed: 0, stores: [] }
  }

  const stores: StoreRunLine[] = []
  for (const source of sources) {
    const line: StoreRunLine = { store: source.store, appId: source.appId, status: 'ok', fetched: 0, newReviews: 0, filed: 0, detail: null }
    stores.push(line)
    if (!source.ctx.readCredential) {
      Object.assign(line, { status: 'not_connected', detail: `${STORE_LABEL[source.store]} has no readable key.` })
      continue
    }
    let reviews: StoreReview[]
    try {
      reviews = await fetchReviews(source)
    } catch (err) {
      const notConnected = err instanceof ConnectorError && err.status === 'not_connected'
      Object.assign(line, { status: notConnected ? 'not_connected' : 'error', detail: String((err as Error)?.message ?? err).slice(0, 300) })
      continue
    }
    line.fetched = reviews.length
    if (reviews.length === 0) continue

    const { data: seenRows, error: seenErr } = await db
      .from('store_review_items')
      .select('review_id')
      .eq('project_id', projectId)
      .eq('store', source.store)
      .in('review_id', reviews.map((r) => r.reviewId))
    if (seenErr) {
      Object.assign(line, { status: 'error', detail: 'Mushi could not check which reviews it has already seen.' })
      continue
    }
    const seen = new Set(((seenRows ?? []) as Array<{ review_id: string }>).map((r) => r.review_id))
    const fresh = reviews.filter((r) => !seen.has(r.reviewId))
    line.newReviews = fresh.length

    for (const review of fresh) {
      const file = shouldFile(review, maxRating, now)
      // Over the per-run cap, leave the review unseen so the next run files it.
      if (file && line.filed >= MAX_FILED_PER_STORE_RUN) continue
      // Claim the review first: the primary key keeps a concurrent run from filing it twice.
      const { error: claimErr } = await db.from('store_review_items').insert({
        project_id: projectId,
        store: source.store,
        review_id: review.reviewId,
        rating: review.rating,
        review_created_at: review.createdAt,
        seen_at: now.toISOString(),
      })
      if (claimErr) {
        if (claimErr.code !== '23505') Object.assign(line, { status: 'error', detail: 'Mushi could not record a review it read.' })
        continue
      }
      if (!file) continue
      const row = buildStoreReviewReport(projectId, review, now)
      const { error: insErr } = await db.from('reports').insert(row)
      if (insErr) {
        // Release the claim so the next run tries again.
        await db.from('store_review_items').delete().eq('project_id', projectId).eq('store', source.store).eq('review_id', review.reviewId)
        Object.assign(line, { status: 'error', detail: 'A report could not be created from a review.' })
        continue
      }
      await db.from('store_review_items').update({ report_id: row.id }).eq('project_id', projectId).eq('store', source.store).eq('review_id', review.reviewId)
      line.filed++
      await deps.classify(db, row.id as string, projectId)
    }
  }

  const ok = stores.filter((l) => l.status === 'ok').length
  const status: 'ok' | 'partial' | 'failed' | 'not_connected' = ok === stores.length ? 'ok' : ok > 0 ? 'partial' : stores.every((l) => l.status === 'not_connected') ? 'not_connected' : 'failed'
  const problems = stores.filter((l) => l.status !== 'ok').map((l) => `${STORE_LABEL[l.store]} ${l.appId}: ${l.detail ?? l.status}`).join('; ')
  await recordStatus(db, projectId, now, status, problems || null)
  return { status, filed: stores.reduce((n, l) => n + l.filed, 0), stores }
}
