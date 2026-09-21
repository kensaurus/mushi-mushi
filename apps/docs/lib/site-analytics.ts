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

export type DocsViewEvent = 'landing_view' | 'quickstart_view' | 'pricing_view'

/** `usePathname()` already strips `basePath`; this just drops trailing slashes. */
export function normalizePathname(pathname: string): string {
  const p = pathname.replace(/\/+$/, '')
  return p === '' ? '/' : p
}

export function viewEventForRoute(pathname: string): DocsViewEvent | null {
  const p = normalizePathname(pathname)
  if (p === '/') return 'landing_view'
  if (p === '/quickstart' || p.startsWith('/quickstart/')) return 'quickstart_view'
  if (p === '/pricing') return 'pricing_view'
  return null
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

/** `?ref=` values ride into the console URL — keep them slug-shaped. @internal */
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

/** @internal Exported for unit tests only. */
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

/** Write-once. An existing record always wins — first touch is never overwritten. */
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

// ─── CTA links ───────────────────────────────────────────────────────────────

export type CtaHrefKind = 'signup' | 'connect' | null

export function ctaHrefKind(href: string | null | undefined): CtaHrefKind {
  if (!href) return null
  if (href.includes('/admin/signup') || href.includes('/signup')) return 'signup'
  if (href.includes('/connect')) return 'connect'
  return null
}

const ABSOLUTE_RE = /^[a-z][a-z0-9+.-]*:/i

/**
 * Append `src=<ctaId>` (when absent) and `ref=<first-touch utm_source>` (when
 * known and absent) at click time, so MDX / copy links stay static. Existing
 * params are never overwritten; unparseable hrefs are returned untouched.
 */
export function decorateSignupHref(href: string, ctaId: string, ref?: string | null): string {
  const relative = !ABSOLUTE_RE.test(href)
  let url: URL
  try {
    url = relative ? new URL(href, 'http://relative.invalid') : new URL(href)
  } catch {
    return href
  }
  if (ctaId && !url.searchParams.has('src')) url.searchParams.set('src', ctaId)
  const refSlug = sanitizeRefSlug(ref)
  if (refSlug && !url.searchParams.has('ref')) url.searchParams.set('ref', refSlug)
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
