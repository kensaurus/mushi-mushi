/**
 * FILE: packages/server/supabase/functions/api/routes/project-home.ts
 * PURPOSE: The per-app Home in one call, served by `api-ext` (deploy size
 *          limit; `api` forwards these paths).
 *
 *   GET  /v1/admin/projects/:id/home             every Home section (members)
 *   POST /v1/admin/projects/:id/home/thumbnail   capture a fresh screenshot (non-viewers)
 *
 * The decisions live in `_shared/project-home.ts`; this file does the reads.
 * Each section reads on its own with a deadline, so one slow or failing read
 * makes that section `error` and the rest still render. Counts are exact
 * (`count: 'exact', head: true`), never the length of a capped row list.
 *
 * The thumbnail (`_shared/home-thumbnail.ts`) bills the project's own
 * Firecrawl key, never the platform's. Opening Home captures one in the
 * background only while the app's live-site watch is on (the owner already
 * spends that key on the site daily) and the last capture is over 7 days
 * old; otherwise the console's Refresh button asks for one.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { runInBackground } from '../../_shared/background.ts'
import { resolveFirecrawl } from '../../_shared/firecrawl.ts'
import { assertSafeOutboundUrl } from '../../_shared/inventory-guards.ts'
import { parseGithubRepoUrl } from '../../_shared/github.ts'
import { isSdkKey } from '../../_shared/setup-signals.ts'
import { compareSemver, resolveSdkFreshnessStatus } from '../../_shared/sdk-version-compare.ts'
import { fetchLatestStampedSdkReports, fetchProjectSdkObservations, resolveProjectSdkIdentity } from '../../_shared/sdk-observation.ts'
import {
  buildActivity,
  buildNeedsYou,
  buildSitemap,
  buildStations,
  buildWeek,
  ciSignal,
  setupSignal,
  type SetupInput,
  currentTrain,
  detectPlatforms,
  errorSection,
  errorSignal,
  errorsSignal,
  keyKind,
  median,
  notConnected,
  okSection,
  pickLiveUrl,
  sdkSignal,
  shouldAutoCapture,
  siteSignal,
  SITE_WATCH_CONNECT,
  SITE_WATCH_HREF,
  THUMBNAIL_AUTO_GAP_MS,
  THUMBNAIL_MANUAL_GAP_MS,
  waitingBySeverity,
  type CiJobRow,
  type HealthSignal,
  type HomeSection,
  type KeyKind,
  type Platform,
  type SeverityKey,
} from '../../_shared/project-home.ts'
import {
  captureThumbnail,
  claimCapture,
  THUMBNAIL_BUCKET,
  THUMBNAIL_TABLE,
  THUMBNAIL_URL_TTL_SEC,
  type ThumbnailRow,
} from '../../_shared/home-thumbnail.ts'
import { readPipeline } from './pipeline.ts'
import { reportWindowStartIso } from '../../_shared/report-list-filters.ts'
import { dbError, OPEN_REPORT_STATUSES, parseUuidParam, userCanAccessProject } from '../shared.ts'

const hlog = log.child('project-home')

type Ctx = Context<{ Variables: Variables }>
type Db = ReturnType<typeof getServiceClient>

const HOUR = 3600_000
const DAY = 24 * HOUR
/** Each section's read budget; a slower section reads `error`. */
const SECTION_MS = 12_000
const PAGE_VIEW_SAMPLE = 5000
const MEMBER_LOOKUPS = 8

export interface ProjectHomeDeps {
  now: () => Date
  readPipeline: typeof readPipeline
  resolveFirecrawl: typeof resolveFirecrawl
  captureThumbnail: typeof captureThumbnail
  lookupUser: (db: Db, userId: string) => Promise<{ name: string | null; avatarUrl: string | null }>
}

async function lookupUser(db: Db, userId: string): Promise<{ name: string | null; avatarUrl: string | null }> {
  const { data } = await db.auth.admin.getUserById(userId)
  const user = data?.user
  if (!user) return { name: null, avatarUrl: null }
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const pick = (k: string) => (typeof meta[k] === 'string' && (meta[k] as string).trim() ? (meta[k] as string).trim() : null)
  const name = pick('full_name') ?? pick('name') ?? pick('user_name') ?? user.email?.split('@')[0] ?? null
  const avatar = pick('avatar_url') ?? pick('picture')
  return { name, avatarUrl: avatar && /^https:\/\//.test(avatar) ? avatar : null }
}

export const defaultProjectHomeDeps: ProjectHomeDeps = {
  now: () => new Date(),
  readPipeline,
  resolveFirecrawl,
  captureThumbnail,
  lookupUser,
}

function within<T>(p: PromiseLike<T>, what: string, ms = SECTION_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s`)), ms)
  })
  return Promise.race([Promise.resolve(p), deadline]).finally(() => clearTimeout(timer))
}

/** A read's rows, or a thrown error naming the table. */
async function rows<T>(what: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await within(q, what)
  if (error) throw new Error(`${what}: ${error.message}`)
  return (data ?? []) as T[]
}

async function one<T>(what: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await within(q, what)
  if (error) throw new Error(`${what}: ${error.message}`)
  return (data ?? null) as T | null
}

async function count(what: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: n, error } = await within(q, what)
  if (error) throw new Error(`${what}: ${error.message}`)
  return n ?? 0
}

/** Settle a read so one failure stays in its section. */
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }
function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  )
}

interface KeyRow {
  label: string | null
  scopes: string[] | null
  is_active: boolean
  created_at: string
  last_seen_at: string | null
  last_seen_origin: string | null
  last_seen_user_agent: string | null
}

interface ProjectRow {
  id: string
  name: string
  slug: string | null
  created_at: string
  organization_id: string | null
  owner_id: string | null
  icon_url: string | null
  icon_source: string | null
}

const latestSeen = (keys: KeyRow[]) =>
  keys.map((k) => k.last_seen_at).filter((x): x is string => !!x).sort().at(-1) ?? null

export async function readProjectHome(db: Db, project: ProjectRow, deps: ProjectHomeDeps) {
  const id = project.id
  const now = deps.now()
  const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString()
  // The report list's calendar windows (UTC midnight), so `/reports?days=N` shows the same count.
  const todayStart = reportWindowStartIso(1, now)
  const yesterdayStart = reportWindowStartIso(2, now)
  const weekStart = reportWindowStartIso(7, now)
  const priorStart = reportWindowStartIso(14, now)
  const sdkHref = `/connect?project=${encodeURIComponent(id)}#connect-sdk-health`
  const reportCount = () => db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', id)
  const mergedCount = () => db.from('fix_attempts').select('id', { count: 'exact', head: true }).eq('project_id', id)

  // Reads several sections share.
  const keysP = settle(
    rows<KeyRow>('project_api_keys', db.from('project_api_keys').select('label, scopes, is_active, created_at, last_seen_at, last_seen_origin, last_seen_user_agent').eq('project_id', id)),
  )
  const watchP = settle(
    one<{ base_url: string; status: string; last_checked_at: string | null; last_error: string | null }>(
      'site_watches',
      db.from('site_watches').select('base_url, status, last_checked_at, last_error').eq('project_id', id).maybeSingle(),
    ),
  )
  // The pages the site-watch page lists: filed findings only (ADR 0029).
  const brokenP = settle(
    rows<{ url: string }>(
      'site_watch_pages',
      db.from('site_watch_pages').select('url').eq('project_id', id).is('resolved_at', null).or('confirmed_at.not.is.null,report_id.not.is.null').limit(200),
    ),
  )
  const liveUrlP = settle(
    Promise.all([
      one<{ base_url: string; enabled: boolean }>('site_audits', db.from('site_audits').select('base_url, enabled').eq('project_id', id).maybeSingle()),
      one<{ crawler_base_url: string | null }>('project_settings', db.from('project_settings').select('crawler_base_url').eq('project_id', id).maybeSingle()),
    ]),
  )
  const repoP = settle(
    one<{ repo_url: string; default_branch: string | null }>(
      'project_repos',
      db.from('project_repos').select('repo_url, default_branch').eq('project_id', id).order('is_primary', { ascending: false }).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    ),
  )
  const pipelineP = settle(within(deps.readPipeline(db, [id], now), 'pipeline'))
  const deployP = settle(
    one<{ observed_at: string; observed_version: string | null; ok: boolean }>(
      'deploy_observations',
      db.from('deploy_observations').select('observed_at, observed_version, ok').eq('project_id', id).order('observed_at', { ascending: false }).limit(1).maybeSingle(),
    ),
  )
  const thumbP = settle(
    one<ThumbnailRow>(THUMBNAIL_TABLE, db.from(THUMBNAIL_TABLE).select('project_id, storage_path, page_url, captured_at, last_attempt_at, last_error').eq('project_id', id).maybeSingle()),
  )
  const firecrawlP = settle(within(deps.resolveFirecrawl(db, id), 'firecrawl key'))

  const [keys, watch, broken, liveUrls, repo, pipeline, deploy, thumb, firecrawl] = await Promise.all([
    keysP, watchP, brokenP, liveUrlP, repoP, pipelineP, deployP, thumbP, firecrawlP,
  ])

  const origins = keys.ok ? keys.value.map((k) => k.last_seen_origin) : []
  const liveUrl = pickLiveUrl({
    watch: watch.ok ? watch.value?.base_url ?? null : null,
    audit: liveUrls.ok ? liveUrls.value[0]?.base_url ?? liveUrls.value[1]?.crawler_base_url ?? null : null,
    origins,
  })

  // ── Health ──
  const health = await Promise.all<HealthSignal>([
    (async () => {
      if (!watch.ok) return errorSignal('site', 'Site up', SITE_WATCH_HREF, watch.error)
      if (!broken.ok) return errorSignal('site', 'Site up', SITE_WATCH_HREF, broken.error)
      const latencies = await rows<{ latency_ms: number | null }>(
        'synthetic_runs',
        db.from('synthetic_runs').select('latency_ms').eq('project_id', id).gte('ran_at', iso(DAY)).not('latency_ms', 'is', null).limit(500),
      ).catch(() => [] as Array<{ latency_ms: number | null }>)
      return siteSignal({
        watch: watch.value,
        brokenPages: broken.value.length,
        medianLatencyMs: median(latencies.map((r) => r.latency_ms).filter((x): x is number => typeof x === 'number')),
        now,
      })
    })().catch((e) => errorSignal('site', 'Site up', SITE_WATCH_HREF, e)),
    (async () => {
      const [todayCount, yesterdayCount, criticalToday, ever, latest] = await Promise.all([
        count('reports today', reportCount().gte('created_at', todayStart)),
        count('reports yesterday', reportCount().gte('created_at', yesterdayStart).lt('created_at', todayStart)),
        count('critical today', reportCount().gte('created_at', todayStart).eq('severity', 'critical')),
        count('reports ever', reportCount()),
        one<{ created_at: string }>('latest report', db.from('reports').select('created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()),
      ])
      const sdkSeen = keys.ok && !!latestSeen(keys.value.filter((k) => isSdkKey(k.scopes)))
      return errorsSignal({ today: todayCount, yesterday: yesterdayCount, criticalToday, everConnected: ever > 0 || sdkSeen, latestAt: latest?.created_at ?? null, sdkHref })
    })().catch((e) => errorSignal('errors', 'Errors today', '/reports?days=1', e)),
    (async () => {
      if (!keys.ok) return errorSignal('sdk', 'SDK sending', sdkHref, keys.error)
      const sdk = keys.value.filter((k) => k.is_active && isSdkKey(k.scopes))
      return sdkSignal({ sdkKeys: sdk.length, lastSeenAt: latestSeen(sdk), now, sdkHref })
    })(),
    (async () => {
      if (!repo.ok) return errorSignal('ci', 'CI on main', '/ci', repo.error)
      const ref = parseGithubRepoUrl(repo.value?.repo_url)
      const slug = ref ? `${ref.owner}/${ref.repo}` : null
      const branch = repo.value?.default_branch ?? 'main'
      const jobs = slug
        ? await rows<CiJobRow>(
            'ci_jobs',
            db
              .from('ci_jobs')
              .select('run_id, run_attempt, job_name, status, conclusion, infra, gh_created_at, completed_at')
              .eq('project_id', id)
              .eq('repo', slug)
              .eq('head_branch', branch)
              .order('gh_created_at', { ascending: false })
              .limit(200),
          )
        : []
      return ciSignal({ repo: slug, branch, jobs })
    })().catch((e) => errorSignal('ci', 'CI on main', '/ci', e)),
  ])
  // First-time setup, only for apps with a finished fresh-eyes run (ADR 0051).
  const setupRun = await one<SetupInput['run']>(
    'fresh-eyes run',
    db.from('ux_runs').select('ttfv_seconds, steps, reached, stalled_at, finished_at, counts').eq('project_id', id).eq('kind', 'fresh_eyes').eq('status', 'done').eq('dry_run', false).order('finished_at', { ascending: false }).limit(1).maybeSingle(),
  ).catch((e) => {
    // Display only: the light is left out, the rest of Home renders.
    log.warn('home: fresh-eyes run unreadable', { projectId: id, err: e instanceof Error ? e.message : String(e) })
    return null
  })
  const setup = setupSignal({ run: setupRun })
  if (setup) health.push(setup)

  // ── Release ──
  const waitingP = settle(
    (async () => {
      const open = [...OPEN_REPORT_STATUSES]
      const sev = (s: string) => count(`waiting ${s}`, reportCount().in('status', open).eq('severity', s))
      const [critical, high, medium, low, unrated] = await Promise.all([
        sev('critical'),
        sev('high'),
        sev('medium'),
        sev('low'),
        count('waiting unrated', reportCount().in('status', open).is('severity', null)),
      ])
      return waitingBySeverity({ critical, high, medium, low, unrated } satisfies Record<SeverityKey, number>)
    })(),
  )

  // ── Week, activity ──
  const weekP = settle(
    (async () => {
      const sessions = () => db.from('end_user_sessions').select('id', { count: 'exact', head: true }).eq('project_id', id)
      const [r0, r1, c0, c1, m0, m1, s0, s1] = await Promise.all([
        count('reports 7d', reportCount().gte('created_at', weekStart)),
        count('reports prior 7d', reportCount().gte('created_at', priorStart).lt('created_at', weekStart)),
        count('critical 7d', reportCount().eq('severity', 'critical').gte('created_at', weekStart)),
        count('critical prior 7d', reportCount().eq('severity', 'critical').gte('created_at', priorStart).lt('created_at', weekStart)),
        count('merged 7d', mergedCount().gte('merged_at', weekStart)),
        count('merged prior 7d', mergedCount().gte('merged_at', priorStart).lt('merged_at', weekStart)),
        // Visits are optional (the SDK session tracker); no table or no rows hides the row.
        count('sessions 7d', sessions().gte('started_at', weekStart)).catch(() => null),
        count('sessions prior 7d', sessions().gte('started_at', priorStart).lt('started_at', weekStart)).catch(() => null),
      ])
      return buildWeek({ reports: [r0, r1], critical: [c0, c1], merged: [m0, m1], sessions: s0 != null && s1 != null && s0 + s1 > 0 ? [s0, s1] : null })
    })(),
  )
  const activityP = settle(
    (async () => {
      const [reportsToday, reportsWeek, mergedToday, mergedWeek, prsOpenedWeek, deploysWeek] = await Promise.all([
        count('reports today', reportCount().gte('created_at', todayStart)),
        count('reports week', reportCount().gte('created_at', weekStart)),
        count('merged today', mergedCount().gte('merged_at', todayStart)),
        count('merged week', mergedCount().gte('merged_at', weekStart)),
        count('prs week', mergedCount().not('pr_url', 'is', null).gte('created_at', weekStart)),
        count('deploys week', db.from('deploy_observations').select('id', { count: 'exact', head: true }).eq('project_id', id).eq('ok', true).gte('observed_at', weekStart)),
      ])
      const last = deploy.ok && deploy.value ? { at: deploy.value.observed_at, version: deploy.value.observed_version } : null
      return buildActivity({ reportsToday, reportsWeek, mergedToday, mergedWeek, prsOpenedWeek, deploysWeek, lastDeploy: last })
    })(),
  )

  // ── Sitemap ──
  const sitemapP = settle(
    (async () => {
      const [views, bugs] = await Promise.all([
        rows<{ route: string }>('session_page_views', db.from('session_page_views').select('route').eq('project_id', id).gte('ts', weekStart).order('ts', { ascending: false }).limit(PAGE_VIEW_SAMPLE)),
        rows<{ url: string | null }>('report urls', db.from('reports').select('url:environment->>url').eq('project_id', id).gte('created_at', priorStart).limit(2000)),
      ])
      return buildSitemap({
        views: views.map((v) => v.route),
        viewsCapped: views.length >= PAGE_VIEW_SAMPLE,
        bugUrls: bugs.map((b) => b.url).filter((u): u is string => !!u),
        brokenUrls: broken.ok ? broken.value.map((b) => b.url) : [],
      })
    })(),
  )

  // ── Access ──
  const accessP = settle(
    (async () => {
      const [orgMembers, projectMembers, observations, stamped, catalog] = await Promise.all([
        project.organization_id
          ? rows<{ user_id: string; role: string }>('organization_members', db.from('organization_members').select('user_id, role').eq('organization_id', project.organization_id).limit(200))
          : Promise.resolve([]),
        rows<{ user_id: string; role: string }>('project_members', db.from('project_members').select('user_id, role').eq('project_id', id).limit(200)),
        fetchProjectSdkObservations(db, [id]),
        fetchLatestStampedSdkReports(db, [id]),
        rows<{ package: string; version: string; deprecated: boolean | null }>('sdk_versions', db.from('sdk_versions').select('package, version, deprecated')),
      ])
      const roles = new Map<string, string>()
      if (project.owner_id) roles.set(project.owner_id, 'owner')
      for (const m of [...orgMembers, ...projectMembers]) if (!roles.has(m.user_id)) roles.set(m.user_id, m.role)
      const order = ['owner', 'admin', 'member', 'viewer']
      const people = [...roles.entries()].sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1])).slice(0, MEMBER_LOOKUPS)
      const shown = await Promise.all(
        people.map(async ([userId, role]) => {
          const who = await within(deps.lookupUser(db, userId), 'member lookup', 4000).catch(() => ({ name: null, avatarUrl: null }))
          return { name: who.name, avatarUrl: who.avatarUrl, role }
        }),
      )
      const identity = resolveProjectSdkIdentity(observations[0], stamped[0])
      // The catalogue keeps history: the highest semver of this package is the latest.
      const latest = catalog
        .filter((row) => row.package === identity.sdk_package)
        .reduce<{ version: string; deprecated: boolean } | null>(
          (best, row) => (!best || compareSemver(row.version, best.version) > 0 ? { version: row.version, deprecated: !!row.deprecated } : best),
          null,
        )
      const status = resolveSdkFreshnessStatus({ sdkPackage: identity.sdk_package, sdkVersion: identity.sdk_version, catalogVersion: latest?.version ?? null, catalogDeprecated: !!latest?.deprecated })
      const keyList: Array<{ label: string; kind: KeyKind; lastUsedAt: string | null; createdAt: string }> = keys.ok
        ? keys.value
            .filter((k) => k.is_active)
            .map((k) => ({ label: k.label ?? 'Unnamed key', kind: keyKind(k.scopes), lastUsedAt: k.last_seen_at, createdAt: k.created_at }))
            .sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
        : []
      return {
        projectId: id,
        createdAt: project.created_at,
        repo: repo.ok && repo.value ? { url: repo.value.repo_url, branch: repo.value.default_branch ?? null } : null,
        members: { total: roles.size, people: shown },
        sdk: { package: identity.sdk_package, version: identity.sdk_version, latest: latest?.version ?? null, status },
        keys: keyList.slice(0, 6),
        keysTotal: keyList.length,
        keysReadable: keys.ok,
      }
    })(),
  )

  const [waiting, week, activity, sitemap, access] = await Promise.all([waitingP, weekP, activityP, sitemapP, accessP])

  // ── App card ──
  let thumbnail: { url: string; capturedAt: string | null; pageUrl: string | null } | null = null
  if (thumb.ok && thumb.value?.storage_path) {
    const { data } = await db.storage.from(THUMBNAIL_BUCKET).createSignedUrl(thumb.value.storage_path, THUMBNAIL_URL_TTL_SEC)
    if (data?.signedUrl) thumbnail = { url: data.signedUrl, capturedAt: thumb.value.captured_at, pageUrl: thumb.value.page_url }
  }
  const ownKey = firecrawl.ok && firecrawl.value?.source === 'byok'
  const thumbnailState = {
    // The table is created by this feature's migration; before it lands the card falls back to the icon.
    available: thumb.ok,
    canRefresh: thumb.ok && ownKey && !!liveUrl,
    reason: !thumb.ok
      ? 'Screenshots are not set up on this server yet.'
      : !liveUrl
        ? 'Add your live site address to take a screenshot.'
        : !ownKey
          ? 'Add a Firecrawl key in Settings to take a screenshot.'
          : null,
    lastError: thumb.ok ? thumb.value?.last_error ?? null : null,
    lastAttemptAt: thumb.ok ? thumb.value?.last_attempt_at ?? null : null,
  }
  if (
    thumb.ok &&
    firecrawl.ok &&
    firecrawl.value &&
    liveUrl &&
    shouldAutoCapture({
      watchActive: watch.ok && watch.value?.status === 'active',
      ownKey,
      pageUrl: liveUrl,
      capturedAt: thumb.value?.captured_at ?? null,
      lastAttemptAt: thumb.value?.last_attempt_at ?? null,
      now,
    }) &&
    assertSafeOutboundUrl(liveUrl).ok
  ) {
    const key = firecrawl.value.key
    runInBackground(
      (async () => {
        if (await claimCapture(db, id, now, THUMBNAIL_AUTO_GAP_MS)) await deps.captureThumbnail(db, id, liveUrl, key)
      })(),
      'home-thumbnail-auto',
    )
  }
  const lastDeploy = deploy.ok && deploy.value ? { at: deploy.value.observed_at, version: deploy.value.observed_version, ok: deploy.value.ok } : null
  const app = okSection({
    name: project.name,
    slug: project.slug,
    iconUrl: project.icon_url,
    liveUrl,
    platforms: detectPlatforms({
      liveUrl,
      iconSource: project.icon_source,
      agents: keys.ok ? keys.value.map((k) => k.last_seen_user_agent) : [],
      origins,
    }) as Platform[],
    version: lastDeploy?.version ? { value: lastDeploy.version, at: lastDeploy.at } : null,
    sdkOrigin: origins.find((o) => !!o) ?? null,
    repoUrl: repo.ok ? repo.value?.repo_url ?? null : null,
    thumbnail,
    thumbnailState,
  })

  // ── Release section ──
  let release: HomeSection<unknown>
  if (!pipeline.ok) release = errorSection(pipeline.error)
  else {
    const p = pipeline.value
    const trains = p.trains.flatMap((t) => t.trains.map((x) => ({ state: x.state, prNumber: x.prNumber, members: x.members, createdAt: x.createdAt, repo: t.repo })))
    const data = {
      stations: buildStations(p.stages),
      train: currentTrain(trains),
      lastDeploy,
      waiting: waiting.ok ? waiting.value : null,
      waitingError: waiting.ok ? null : String(waiting.error instanceof Error ? waiting.error.message : waiting.error),
    }
    const hasAnything = data.stations.some((s) => s.count > 0) || !!data.train || !!lastDeploy || (waiting.ok && waiting.value.total > 0)
    release = hasAnything || (repo.ok && repo.value) ? okSection(data) : notConnected({ label: 'Connect GitHub', to: '/connect' }, data)
  }

  // ── Needs you ──
  const sdkFreshness = access.ok ? access.value.sdk : null
  const needsYou = okSection(
    buildNeedsYou({
      projectId: id,
      health,
      criticalWaiting: waiting.ok ? waiting.value.counts.critical : null,
      pipeline: pipeline.ok ? pipeline.value.stages : null,
      sdk: sdkFreshness,
    }),
  )

  const sitemapSection = !sitemap.ok
    ? errorSection(sitemap.error)
    : sitemap.value.pages.length === 0
      ? notConnected({ label: liveUrl ? 'Turn on the live-site watch' : 'Install the SDK', to: liveUrl ? SITE_WATCH_CONNECT.to : sdkHref }, sitemap.value)
      : okSection(sitemap.value)

  return {
    generatedAt: now.toISOString(),
    projectId: id,
    app,
    health: okSection(health),
    needsYou,
    release,
    sitemap: sitemapSection,
    week: week.ok ? okSection(week.value) : errorSection(week.error),
    activity: activity.ok ? okSection(activity.value) : errorSection(activity.error),
    access: access.ok ? okSection(access.value) : errorSection(access.error),
    // Reads Needs you could not use, so the console can say the list may be incomplete.
    partial: [!pipeline.ok && 'pipeline', !waiting.ok && 'waiting'].filter(Boolean) as string[],
  }
}

async function projectFor(c: Ctx, db: Db): Promise<{ project: ProjectRow; role: string } | { response: Response }> {
  const parsed = parseUuidParam(c)
  if (!parsed.ok) return { response: parsed.error }
  const access = await userCanAccessProject(db, c.get('userId') as string, parsed.value)
  if (!access.allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } }, 404) }
  const { data, error } = await db
    .from('projects')
    .select('id, name, slug, created_at, organization_id, owner_id, icon_url, icon_source')
    .eq('id', parsed.value)
    .maybeSingle()
  if (error) return { response: dbError(c, error) }
  if (!data) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } }, 404) }
  return { project: data as ProjectRow, role: access.role ?? 'viewer' }
}

export function registerProjectHomeRoutes(app: Hono<{ Variables: Variables }>, deps: ProjectHomeDeps = defaultProjectHomeDeps): void {
  app.get('/v1/admin/projects/:id/home', jwtAuth, async (c: Ctx) => {
    const db = getServiceClient()
    const p = await projectFor(c, db)
    if ('response' in p) return p.response
    return c.json({ ok: true, data: await readProjectHome(db, p.project, deps) })
  })

  app.post('/v1/admin/projects/:id/home/thumbnail', jwtAuth, async (c: Ctx) => {
    const db = getServiceClient()
    const p = await projectFor(c, db)
    if ('response' in p) return p.response
    if (p.role === 'viewer') return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Viewers cannot take a new screenshot.' } }, 403)
    const id = p.project.id
    const [watch, audit, settings, fc] = await Promise.all([
      db.from('site_watches').select('base_url').eq('project_id', id).maybeSingle(),
      db.from('site_audits').select('base_url').eq('project_id', id).maybeSingle(),
      db.from('project_settings').select('crawler_base_url').eq('project_id', id).maybeSingle(),
      deps.resolveFirecrawl(db, id).catch(() => null),
    ])
    const { data: keys } = await db.from('project_api_keys').select('last_seen_origin').eq('project_id', id)
    const pageUrl = pickLiveUrl({
      watch: (watch.data?.base_url as string | undefined) ?? null,
      audit: (audit.data?.base_url as string | undefined) ?? (settings.data?.crawler_base_url as string | null | undefined) ?? null,
      origins: ((keys ?? []) as Array<{ last_seen_origin: string | null }>).map((k) => k.last_seen_origin),
    })
    if (!pageUrl) return c.json({ ok: false, error: { code: 'NO_LIVE_URL', message: 'Add your live site address first (site watch or site audit).' } }, 409)
    if (!assertSafeOutboundUrl(pageUrl).ok) return c.json({ ok: false, error: { code: 'UNSAFE_URL', message: 'The live site address is not a public https address.' } }, 400)
    if (!fc || fc.source !== 'byok') {
      return c.json({ ok: false, error: { code: 'FIRECRAWL_KEY_REQUIRED', message: 'Add your own Firecrawl key in Settings → Web tools. Mushi never uses its own key for this.' } }, 409)
    }
    const now = deps.now()
    let claimed: boolean
    try {
      claimed = await claimCapture(db, id, now, THUMBNAIL_MANUAL_GAP_MS)
    } catch (err) {
      return dbError(c, { message: err instanceof Error ? err.message : String(err) })
    }
    if (!claimed) return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'A screenshot was taken in the last 10 minutes. Try again shortly.' } }, 429)
    try {
      const path = await deps.captureThumbnail(db, id, pageUrl, fc.key)
      await logAudit(db, id, c.get('userId') as string, 'settings.updated', 'home_thumbnail', id, { pageUrl }).catch(() => {})
      const { data } = await db.storage.from(THUMBNAIL_BUCKET).createSignedUrl(path, THUMBNAIL_URL_TTL_SEC)
      return c.json({ ok: true, data: { url: data?.signedUrl ?? null, capturedAt: now.toISOString(), pageUrl } })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      hlog.warn('thumbnail capture failed', { projectId: id, err: message.slice(0, 200) })
      return c.json({ ok: false, error: { code: 'CAPTURE_FAILED', message } }, 502)
    }
  })
}
