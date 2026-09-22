'use client'

/**
 * FILE: apps/docs/components/MushiSiteAnalytics.tsx
 * PURPOSE: Mushi measuring its own funnel with its own SDK on the landing +
 *          docs site. First-party, consent-gated, no ads, no cross-site.
 *
 * Consent model
 * -------------
 * Nothing loads before consent. `@mushi-mushi/web` (and with it the session
 * heartbeat) is dynamically imported only after the visitor said OK — now or
 * on an earlier visit (`localStorage` `mushi_events_consent_<projectId>`,
 * the SDK's own key). "No thanks" and Do-Not-Track / GPC never load it.
 * Events that fire before the SDK is ready (`landing_view` on first paint)
 * sit in a small in-memory queue and replay after init. The SDK is still
 * initialised with `analytics.consent: 'required'` so a stale or spoofed
 * stored value cannot widen anything — it just reads the same key.
 * The first-touch record (`mushi_first_touch_<projectId>`) is held in memory
 * and written only on consent too, and until then signup links are not
 * decorated at all — the consent answer is the only thing stored before an OK
 * (apps/docs/content/legal/privacy.mdx §11 lists every key).
 *
 * Events (packages/core/src/analytics-taxonomy.ts)
 * -------------------------------------------------
 *   docs_page_view   every route (the funnel's visits count this + landing_view)
 *   landing_view     `/`
 *   quickstart_view  `/quickstart`, `/quickstart/*`
 *   pricing_view     `/pricing`
 *   cta_click        any click inside `[data-mushi-cta]`
 *   signup_click     …when that element links to `/signup`
 *   connect_demo_click …when it links to `/connect`
 * View events carry reserved `$utm_*`, `$referrer`, `$route`, `$ref` and
 * `$first_touch` (true on the first tracked view after the first-touch
 * record was created — i.e. this visitor's very first session). The first
 * event tracked on each page load also carries the stored first touch as
 * `$ft_*`. Signup links get `src=<cta_id>`, `ft_src=<first-touch
 * utm_source>`, the first touch's `utm_*` and the landing's own `ref=`
 * (the widget mark's project hash) appended at click time, so MDX links stay
 * static. `ref=` is the console's growth-loop referral and never carries a
 * UTM source.
 *
 * Config: NEXT_PUBLIC_MUSHI_SELF_{PROJECT_ID,API_KEY,API_ENDPOINT}
 * (apps/docs/.env.example). Unset → renders nothing, does nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  SITE_ANALYTICS_ENV,
  buildFirstTouch,
  commitFirstTouch,
  ctaHrefKind,
  decorateSignupHref,
  dntActive,
  firstTouchReservedProps,
  normalizePathname,
  readFirstTouch,
  readSiteAnalyticsConfig,
  readStoredConsent,
  reservedViewProps,
  sanitizeRefSlug,
  viewEventsForRoute,
  writeStoredConsent,
  type FirstTouch,
  type ReservedProps,
  type SiteAnalyticsConfig,
  type StoredConsent,
} from '@/lib/site-analytics'

type EventProps = Record<string, string | number | boolean | null>
type QueuedEvent = { name: string; props: EventProps; reserved?: ReservedProps }
type Tracker = { track: (name: string, props: EventProps, reserved?: ReservedProps) => void }

/** Bounded like the SDK's own pre-consent buffer. */
const QUEUE_MAX = 50

const SITE_ANALYTICS_CONSENT_COPY =
  'Mushi measures its own funnel with its own SDK — first-party, no ads, no cross-site tracking.'

/**
 * Module singleton: survives React StrictMode double-mount and client
 * navigations. `Mushi.init` is itself idempotent, but the import + init pair
 * must never race.
 */
let trackerPromise: Promise<Tracker | null> | null = null

function loadTracker(config: SiteAnalyticsConfig): Promise<Tracker | null> {
  if (trackerPromise) return trackerPromise
  trackerPromise = (async () => {
    try {
      // `@mushi-mushi/web` marks `@mushi-mushi/core` external, so both
      // imports resolve to the one core module instance — the tracker state
      // `Mushi.init` sets up is the state `trackEvent` reads.
      const [{ Mushi }, core] = await Promise.all([import('@mushi-mushi/web'), import('@mushi-mushi/core')])
      Mushi.init({
        projectId: config.projectId,
        apiKey: config.apiKey,
        apiEndpoint: config.apiEndpoint,
        // Pin the launcher locally — a remote dashboard default must not
        // resurrect a bug-report FAB on the marketing site.
        runtimeConfig: false,
        widget: { trigger: 'hidden', smartHide: false },
        proactive: {
          rageClick: false,
          errorBoundary: false,
          longTask: false,
          apiCascade: false,
          pageDwell: false,
          firstSession: false,
        },
        // Funnel only. No console / network / screenshot capture on docs.
        capture: {
          console: false,
          network: false,
          performance: false,
          screenshot: 'off',
          elementSelector: false,
        },
        analytics: { consent: 'required', surface: 'docs' },
      })
      return {
        track: (name, props, reserved) => {
          core.trackEvent(name, props, reserved ? { reserved } : undefined)
        },
      }
    } catch (err) {
      console.warn('[mushi-docs] analytics init failed', err)
      return null
    }
  })()
  return trackerPromise
}

const CONFIG = readSiteAnalyticsConfig(SITE_ANALYTICS_ENV)

export function MushiSiteAnalytics() {
  const pathname = usePathname()
  const [showBar, setShowBar] = useState(false)

  const consentRef = useRef<StoredConsent | 'pending' | 'blocked'>('pending')
  const trackerRef = useRef<Tracker | null>(null)
  const queueRef = useRef<QueuedEvent[]>([])
  const lastViewRef = useRef<string | null>(null)
  /** The stored first touch, set once consent committed it. Decorates signup links. */
  const firstTouchStoredRef = useRef<FirstTouch | null>(null)
  const firstTouchPendingRef = useRef(false)
  /** First-touch candidate held in memory until consent allows the write. */
  const firstTouchCandidateRef = useRef<FirstTouch | null>(null)
  /** `$ft_*` already attached to an event on this page load. */
  const firstTouchAttachedRef = useRef(false)
  /** The `?ref=` this page load arrived with (widget mark hash), forwarded to signup. */
  const landingRefRef = useRef<string | null>(null)

  /** Write the first-touch record — a no-op unless consent is `granted`. */
  const persistFirstTouch = useCallback((consent: StoredConsent) => {
    const candidate = firstTouchCandidateRef.current
    if (!CONFIG || !candidate) return
    const committed = commitFirstTouch(window.localStorage, CONFIG.projectId, candidate, consent)
    if (committed) firstTouchStoredRef.current = committed.touch
  }, [])

  const emit = useCallback((name: string, props: EventProps, reserved?: ReservedProps) => {
    const consent = consentRef.current
    if (consent === 'denied' || consent === 'blocked') return
    // Queued events only leave on `granted`, which also commits the
    // candidate, so the candidate here is the first touch that gets stored.
    if (!firstTouchAttachedRef.current && firstTouchCandidateRef.current) {
      firstTouchAttachedRef.current = true
      reserved = { ...firstTouchReservedProps(firstTouchCandidateRef.current), ...reserved }
    }
    const tracker = trackerRef.current
    if (tracker) {
      tracker.track(name, props, reserved)
      return
    }
    if (queueRef.current.length < QUEUE_MAX) queueRef.current.push({ name, props, reserved })
  }, [])

  const activate = useCallback(() => {
    if (!CONFIG) return
    void loadTracker(CONFIG).then((tracker) => {
      if (!tracker || consentRef.current !== 'granted') return
      trackerRef.current = tracker
      const queued = queueRef.current
      queueRef.current = []
      for (const ev of queued) tracker.track(ev.name, ev.props, ev.reserved)
    })
  }, [])

  const decide = useCallback(
    (state: StoredConsent) => {
      if (!CONFIG) return
      writeStoredConsent(window.localStorage, CONFIG.projectId, state)
      consentRef.current = state
      setShowBar(false)
      if (state === 'granted') {
        persistFirstTouch(state)
        activate()
      } else {
        queueRef.current = []
        firstTouchCandidateRef.current = null
      }
    },
    [activate, persistFirstTouch],
  )

  // Mount: DNT gate → first touch (read only) → stored consent → maybe load the SDK.
  useEffect(() => {
    if (!CONFIG) return
    // `window.doNotTrack` is a legacy vendor field lib.dom does not declare.
    if (dntActive(navigator, window as Window & { doNotTrack?: string | null })) {
      consentRef.current = 'blocked'
      return
    }
    const storage = window.localStorage
    // Reading is fine before consent; the write waits for `granted`.
    const existing = readFirstTouch(storage, CONFIG.projectId)
    firstTouchCandidateRef.current =
      existing ?? buildFirstTouch({ search: window.location.search, referrer: document.referrer, pathname })
    firstTouchPendingRef.current = existing === null
    // In memory only; used just to decorate a signup link after consent.
    landingRefRef.current = sanitizeRefSlug(new URLSearchParams(window.location.search).get('ref'))

    const stored = readStoredConsent(storage, CONFIG.projectId)
    if (stored === 'granted') {
      consentRef.current = 'granted'
      persistFirstTouch(stored)
      activate()
    } else if (stored === 'denied') {
      consentRef.current = 'denied'
    } else {
      consentRef.current = 'pending'
      setShowBar(true)
    }
    // `pathname` is deliberately not a dependency: it is only read for the
    // first-touch landing path, and re-running on navigation must not
    // re-record anything (recordFirstTouchOnce is write-once regardless).
  }, [activate, persistFirstTouch])

  // Route views — `usePathname` changes on every client navigation
  // (Nextra catch-all included); dedupe so StrictMode / same-route
  // re-renders never double-fire.
  useEffect(() => {
    if (!CONFIG) return
    const key = normalizePathname(pathname)
    if (lastViewRef.current === key) return
    lastViewRef.current = key
    const firstTouch = firstTouchPendingRef.current
    firstTouchPendingRef.current = false
    const reserved = reservedViewProps({
      search: window.location.search,
      referrer: document.referrer,
      pathname,
      firstTouch,
    })
    for (const ev of viewEventsForRoute(pathname)) emit(ev.name, ev.props, reserved)
  }, [pathname, emit])

  // Delegated CTA clicks. Capture phase so the href is decorated before the
  // anchor's default navigation reads it.
  useEffect(() => {
    if (!CONFIG) return
    const onClick = (ev: MouseEvent) => {
      const target = ev.target instanceof Element ? ev.target : null
      const el = target?.closest<HTMLElement>('[data-mushi-cta]') ?? null
      if (!el) return
      const ctaId = el.dataset.mushiCta ?? ''
      if (!ctaId) return
      const ctaLocation = el.dataset.mushiLocation ?? 'unknown'
      emit('cta_click', { cta_id: ctaId, location: ctaLocation })
      if (!(el instanceof HTMLAnchorElement)) return
      const kind = ctaHrefKind(el.getAttribute('href'))
      if (kind === 'signup') {
        const next = decorateSignupHref(el.href, {
          ctaId,
          consent: consentRef.current,
          firstTouch: firstTouchStoredRef.current,
          landingRef: landingRefRef.current,
        })
        if (next !== el.href) el.href = next
        emit('signup_click', { href: next })
      } else if (kind === 'connect') {
        emit('connect_demo_click', { href: el.href })
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [emit])

  if (!CONFIG || !showBar) return null

  return (
    <div className="docs-consent-bar not-prose" role="region" aria-label="Analytics consent">
      <p className="docs-consent-bar__text">{SITE_ANALYTICS_CONSENT_COPY}</p>
      <div className="docs-consent-bar__actions">
        <button
          type="button"
          className="landing-hero-cta landing-hero-cta--primary docs-consent-bar__btn"
          onClick={() => decide('granted')}
        >
          OK
        </button>
        <button
          type="button"
          className="landing-hero-cta landing-hero-cta--secondary docs-consent-bar__btn"
          onClick={() => decide('denied')}
        >
          No thanks
        </button>
      </div>
    </div>
  )
}
