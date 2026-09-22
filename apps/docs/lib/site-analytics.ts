/**
 * FILE: apps/docs/lib/site-analytics.ts
 * PURPOSE: Pure helpers behind `<MushiSiteAnalytics />` — the docs + landing
 *          site measuring Mushi's own funnel with Mushi's own SDK.
 *          Everything testable without a DOM lives here; the component only
 *          wires effects.
 *
 * Vocabulary (event names, reserved `$` props) is owned by
 * packages/core/src/analytics-taxonomy.ts. This file never invents an event.
 */

export interface SiteAnalyticsConfig {
  projectId: string
  apiKey: string
  apiEndpoint: string
}

/**
 * Build-time env, inlined by Next (static export). Referenced as literal
 * `process.env.NEXT_PUBLIC_*` reads on purpose — Next only inlines those.
 * All three unset (the default for forks) → the whole feature is a no-op.
 */
export const SITE_ANALYTICS_ENV = {
  projectId: process.env.NEXT_PUBLIC_MUSHI_SELF_PROJECT_ID,
  apiKey: process.env.NEXT_PUBLIC_MUSHI_SELF_API_KEY,
  apiEndpoint: process.env.NEXT_PUBLIC_MUSHI_SELF_API_ENDPOINT,
} as const

export function readSiteAnalyticsConfig(env: {
  projectId?: string
  apiKey?: string
  apiEndpoint?: string
}): SiteAnalyticsConfig | null {
  const projectId = env.projectId?.trim()
  const apiKey = env.apiKey?.trim()
  const apiEndpoint = env.apiEndpoint?.trim()
  if (!projectId || !apiKey || !apiEndpoint) return null
  return { projectId, apiKey, apiEndpoint }
}

// ─── Routes → view events ────────────────────────────────────────────────────

type DocsViewEvent = 'landing_view' | 'quickstart_view' | 'pricing_view'

/**
 * Fired on every docs route (landing included), so visits are not limited to
 * the three pages below. Its taxonomy entry requires a host `route` prop.
 */
const DOCS_PAGE_VIEW_EVENT = 'docs_page_view'

/** `usePathname()` already strips `basePath`; this just drops trailing slashes. */
export function normalizePathname(pathname: string): string {
  const p = pathname.replace(/\/+$/, '')
  return p === '' ? '/' : p
}

/**
 * The page-specific view event, kept alongside `docs_page_view` so the funnel
 * series that started with them stay continuous. Null for other routes.
 */
function viewEventForRoute(pathname: string): DocsViewEvent | null {
  const p = normalizePathname(pathname)
  if (p === '/') return 'landing_view'
  if (p === '/quickstart' || p.startsWith('/quickstart/')) return 'quickstart_view'
  if (p === '/pricing') return 'pricing_view'
  return null
}

export interface RouteViewEvent {
  name: typeof DOCS_PAGE_VIEW_EVENT | DocsViewEvent
  props: Record<string, string>
}

/**
 * What one route view emits, in order: `docs_page_view` for every route,
 * then the page-specific event where there is one.
 */
export function viewEventsForRoute(pathname: string): RouteViewEvent[] {
  const route = normalizePathname(pathname)
  const events: RouteViewEvent[] = [{ name: DOCS_PAGE_VIEW_EVENT, props: { route } }]
  const specific = viewEventForRoute(route)
  if (specific) events.push({ name: specific, props: {} })
  return events
}

// ─── UTM / referrer → reserved props ─────────────────────────────────────────

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
type UtmKey = (typeof UTM_KEYS)[number]
/** @internal Exported for unit tests only. */
export type UtmParams = Partial<Record<UtmKey, string>>

const MAX_PARAM = 128
const MAX_URL = 256

/** @internal Exported for unit tests only. */
export function parseUtm(search: string): UtmParams {
  const params = new URLSearchParams(search)
  const out: UtmParams = {}
  for (const key of UTM_KEYS) {
    const v = params.get(key)?.trim()
    if (v) out[key] = v.slice(0, MAX_PARAM)
  }
  return out
}

/** Origin + path only — a referrer's query string can carry someone else's tokens. @internal */
export function sanitizeReferrer(referrer: string): string {
  if (!referrer) return ''
  try {
    const u = new URL(referrer)
    return `${u.origin}${u.pathname}`.slice(0, MAX_URL)
  } catch {
    return ''
  }
}

/** `?ref=` values ride into the console URL — keep them slug-shaped. */
export function sanitizeRefSlug(value: string | null | undefined): string | null {
  if (!value) return null
  const slug = value.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64)
  return slug.length > 0 ? slug : null
}

export type ReservedProps = Record<string, string | boolean>

/**
 * Reserved (`$`-prefixed) props for a `*_view` event. The SDK only accepts
 * these through `trackEvent(name, props, { reserved })`; host props cannot
 * start with `$`.
 */
export function reservedViewProps(input: {
  search: string
  referrer: string
  pathname: string
  /** True only on the first tracked view after the first-touch record was created. */
  firstTouch: boolean
}): ReservedProps {
  const out: ReservedProps = { $route: normalizePathname(input.pathname) }
  const utm = parseUtm(input.search)
  for (const key of UTM_KEYS) {
    const v = utm[key]
    if (v) out[`$${key}`] = v
  }
  const ref = sanitizeRefSlug(new URLSearchParams(input.search).get('ref'))
  if (ref) out.$ref = ref
  const referrer = sanitizeReferrer(input.referrer)
  if (referrer) out.$referrer = referrer
  if (input.firstTouch) out.$first_touch = true
  return out
}

// ─── localStorage: consent + first touch ─────────────────────────────────────

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type StoredConsent = 'granted' | 'denied'

/**
 * Mirrors `storageKey('consent')` in packages/core/src/event-tracker.ts. The
 * SDK owns the value; we only read it so we can decide whether to load the
 * SDK at all (denied → zero bytes, zero requests) and write it from the
 * consent bar before the SDK exists.
 * @internal
 */
export function consentKey(projectId: string): string {
  return `mushi_events_consent_${projectId}`
}

/** @internal Exported for unit tests only. */
export function firstTouchKey(projectId: string): string {
  return `mushi_first_touch_${projectId}`
}

export function readStoredConsent(store: KeyValueStore | null | undefined, projectId: string): StoredConsent | null {
  try {
    const v = store?.getItem(consentKey(projectId))
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

export function writeStoredConsent(
  store: KeyValueStore | null | undefined,
  projectId: string,
  value: StoredConsent,
): void {
  try {
    store?.setItem(consentKey(projectId), value)
  } catch {
    /* storage unavailable (private mode, blocked) — the choice just won't persist */
  }
}

export interface FirstTouch {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  referrer: string
  landing_path: string
  at: string
}

export function buildFirstTouch(input: {
  search: string
  referrer: string
  pathname: string
  now?: Date
}): FirstTouch {
  const utm = parseUtm(input.search)
  return {
    ...(utm.utm_source ? { utm_source: utm.utm_source } : {}),
    ...(utm.utm_medium ? { utm_medium: utm.utm_medium } : {}),
    ...(utm.utm_campaign ? { utm_campaign: utm.utm_campaign } : {}),
    referrer: sanitizeReferrer(input.referrer),
    landing_path: normalizePathname(input.pathname),
    at: (input.now ?? new Date()).toISOString(),
  }
}

/** Read-only: safe before consent (nothing is written, nothing leaves the browser). */
export function readFirstTouch(store: KeyValueStore | null | undefined, projectId: string): FirstTouch | null {
  try {
    const raw = store?.getItem(firstTouchKey(projectId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FirstTouch> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.landing_path !== 'string' || typeof parsed.at !== 'string') return null
    const touch: FirstTouch = {
      referrer: typeof parsed.referrer === 'string' ? parsed.referrer : '',
      landing_path: parsed.landing_path,
      at: parsed.at,
    }
    if (typeof parsed.utm_source === 'string') touch.utm_source = parsed.utm_source
    if (typeof parsed.utm_medium === 'string') touch.utm_medium = parsed.utm_medium
    if (typeof parsed.utm_campaign === 'string') touch.utm_campaign = parsed.utm_campaign
    return touch
  } catch {
    return null
  }
}

/**
 * Write-once. An existing record always wins — first touch is never overwritten.
 * @internal Exported for tests only.
 */
export function recordFirstTouchOnce(
  store: KeyValueStore | null | undefined,
  projectId: string,
  touch: FirstTouch,
): { touch: FirstTouch; created: boolean } {
  const existing = readFirstTouch(store, projectId)
  if (existing) return { touch: existing, created: false }
  try {
    store?.setItem(firstTouchKey(projectId), JSON.stringify(touch))
  } catch {
    /* storage unavailable — treat as created for this page only */
  }
  return { touch, created: true }
}

/**
 * Consent gate for the first-touch record. The privacy policy promises that
 * the docs site stores nothing for analytics until the visitor accepts the
 * consent bar, so the write happens only on `granted`; any other state
 * returns null and leaves storage untouched. The caller keeps the candidate
 * in memory and commits it if consent arrives later in the visit.
 */
export function commitFirstTouch(
  store: KeyValueStore | null | undefined,
  projectId: string,
  candidate: FirstTouch,
  consent: StoredConsent | 'pending' | 'blocked' | null,
): { touch: FirstTouch; created: boolean } | null {
  if (consent !== 'granted') return null
  return recordFirstTouchOnce(store, projectId, candidate)
}

/**
 * Reserved `$ft_*` props carrying the stored first touch. The component adds
 * them to the first event it tracks on each page load, so every visitor's
 * anon id can be tied to where they first came from, not just the one visit
 * that created the record.
 */
export function firstTouchReservedProps(touch: FirstTouch | null | undefined): ReservedProps {
  if (!touch) return {}
  const out: ReservedProps = { $ft_landing_path: touch.landing_path }
  if (touch.utm_source) out.$ft_utm_source = touch.utm_source
  if (touch.utm_medium) out.$ft_utm_medium = touch.utm_medium
  if (touch.utm_campaign) out.$ft_utm_campaign = touch.utm_campaign
  if (touch.referrer) out.$ft_referrer = touch.referrer
  return out
}

// ─── CTA links ───────────────────────────────────────────────────────────────

export type CtaHrefKind = 'signup' | 'connect' | null

export function ctaHrefKind(href: string | null | undefined): CtaHrefKind {
  if (!href) return null
  if (href.includes('/admin/signup') || href.includes('/signup')) return 'signup'
  if (href.includes('/connect')) return 'connect'
  return null
}

const ABSOLUTE_RE = /^[a-z][a-z0-9+.-]*:/i

export interface SignupDecoration {
  /** `data-mushi-cta` of the clicked element → `src=`. */
  ctaId: string
  /** Decoration is analytics: nothing is appended unless this is `granted`. */
  consent: StoredConsent | 'pending' | 'blocked' | null
  /** The stored first touch → `ft_src=` plus `utm_source/medium/campaign`. */
  firstTouch?: FirstTouch | null
  /**
   * The `?ref=` this page load arrived with, forwarded unchanged. The widget's
   * "Bug reports by Mushi" mark puts the host project's hash there; the
   * console decides whether it is a loop ref (signupAttribution.isLoopRef).
   */
  landingRef?: string | null
}

/**
 * Append attribution to a signup link at click time, so MDX / copy links stay
 * static: `src=<ctaId>`, `ft_src=<first-touch utm_source>`, the first touch's
 * `utm_*`, and the landing's own `ref=`. First touch never rides in `ref=`:
 * the console reads `ref=` as a growth-loop referral, and until 2026-09-22 a
 * `ref=<utm_source>` here turned every UTM visitor who signed up into a loop
 * signup while a real widget ref was overwritten.
 *
 * Only on `consent === 'granted'`; otherwise the href comes back unchanged.
 * Existing params are never overwritten; unparseable hrefs are returned
 * untouched.
 */
export function decorateSignupHref(href: string, input: SignupDecoration): string {
  if (input.consent !== 'granted') return href
  const relative = !ABSOLUTE_RE.test(href)
  let url: URL
  try {
    url = relative ? new URL(href, 'http://relative.invalid') : new URL(href)
  } catch {
    return href
  }
  const setIfAbsent = (key: string, value: string | null | undefined) => {
    const slug = sanitizeRefSlug(value)
    if (slug && !url.searchParams.has(key)) url.searchParams.set(key, slug)
  }
  setIfAbsent('src', input.ctaId)
  const touch = input.firstTouch
  setIfAbsent('ft_src', touch?.utm_source)
  setIfAbsent('utm_source', touch?.utm_source)
  setIfAbsent('utm_medium', touch?.utm_medium)
  setIfAbsent('utm_campaign', touch?.utm_campaign)
  setIfAbsent('ref', input.landingRef)
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString()
}

// ─── Do Not Track / Global Privacy Control ───────────────────────────────────

/**
 * Same signal the SDK honours (packages/core/src/event-tracker.ts `dntActive`),
 * checked here before the SDK is loaded so a DNT visitor never downloads it.
 */
export function dntActive(
  nav?: { doNotTrack?: string | null; msDoNotTrack?: string | null; globalPrivacyControl?: boolean } | null,
  win?: { doNotTrack?: string | null } | null,
): boolean {
  if (!nav) return false
  if (nav.globalPrivacyControl === true) return true
  const dnt = nav.doNotTrack ?? nav.msDoNotTrack ?? win?.doNotTrack
  return dnt === '1' || dnt === 'yes'
}
