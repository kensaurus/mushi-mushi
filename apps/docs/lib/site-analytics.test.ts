/**
 * Unit tests for the docs-site funnel helpers (no DOM — storage is injected).
 */
import { describe, expect, it } from 'vitest'
import { MUSHI_EVENTS } from '@mushi-mushi/core'
import {
  DOCS_PAGE_VIEW_EVENT,
  buildFirstTouch,
  commitFirstTouch,
  consentKey,
  ctaHrefKind,
  decorateSignupHref,
  dntActive,
  firstTouchKey,
  firstTouchReservedProps,
  normalizePathname,
  parseUtm,
  readFirstTouch,
  readSiteAnalyticsConfig,
  readStoredConsent,
  recordFirstTouchOnce,
  reservedViewProps,
  sanitizeReferrer,
  sanitizeRefSlug,
  viewEventForRoute,
  viewEventsForRoute,
  writeStoredConsent,
  type KeyValueStore,
} from './site-analytics'

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

describe('readSiteAnalyticsConfig', () => {
  it('is a no-op unless all three vars are set', () => {
    expect(readSiteAnalyticsConfig({})).toBeNull()
    expect(readSiteAnalyticsConfig({ projectId: 'p', apiKey: 'k' })).toBeNull()
    expect(readSiteAnalyticsConfig({ projectId: ' p ', apiKey: 'k', apiEndpoint: 'https://x/api' })).toEqual({
      projectId: 'p',
      apiKey: 'k',
      apiEndpoint: 'https://x/api',
    })
  })
})

describe('viewEventForRoute', () => {
  it('maps landing, quickstart subtree and pricing', () => {
    expect(viewEventForRoute('/')).toBe('landing_view')
    expect(viewEventForRoute('')).toBe('landing_view')
    expect(viewEventForRoute('/quickstart')).toBe('quickstart_view')
    expect(viewEventForRoute('/quickstart/incident-loop/')).toBe('quickstart_view')
    expect(viewEventForRoute('/pricing')).toBe('pricing_view')
  })

  it('returns null for every other docs route', () => {
    expect(viewEventForRoute('/connect')).toBeNull()
    expect(viewEventForRoute('/quickstarts')).toBeNull()
    expect(viewEventForRoute('/pricing/faq')).toBeNull()
    expect(viewEventForRoute('/sdks/web')).toBeNull()
  })
})

describe('viewEventsForRoute', () => {
  it('emits docs_page_view with its route on every docs route', () => {
    for (const path of ['/', '/connect', '/sdks/web/', '/pricing/faq', '/quickstart']) {
      const [first] = viewEventsForRoute(path)
      expect(first).toEqual({ name: 'docs_page_view', props: { route: normalizePathname(path) } })
    }
  })

  it('keeps the page-specific event after it, for continuity', () => {
    expect(viewEventsForRoute('/').map((e) => e.name)).toEqual(['docs_page_view', 'landing_view'])
    expect(viewEventsForRoute('/quickstart/incident-loop').map((e) => e.name)).toEqual([
      'docs_page_view',
      'quickstart_view',
    ])
    expect(viewEventsForRoute('/pricing').map((e) => e.name)).toEqual(['docs_page_view', 'pricing_view'])
    expect(viewEventsForRoute('/sdks/web').map((e) => e.name)).toEqual(['docs_page_view'])
  })

  it('names only taxonomy events and satisfies their required props', () => {
    for (const path of ['/', '/quickstart', '/pricing', '/sdks/web']) {
      for (const ev of viewEventsForRoute(path)) {
        const spec = MUSHI_EVENTS[ev.name]
        expect(spec, ev.name).toBeDefined()
        for (const key of spec.required as readonly string[]) expect(ev.props[key], `${ev.name}.${key}`).toBeTruthy()
      }
    }
    expect(MUSHI_EVENTS[DOCS_PAGE_VIEW_EVENT].surface).toBe('docs')
  })
})

describe('UTM + referrer → reserved props', () => {
  it('parses only the five utm keys, trimmed and capped', () => {
    const utm = parseUtm('?utm_source= hn &utm_medium=social&utm_campaign=launch&foo=bar&utm_term=&utm_content=' + 'x'.repeat(300))
    expect(utm).toEqual({
      utm_source: 'hn',
      utm_medium: 'social',
      utm_campaign: 'launch',
      utm_content: 'x'.repeat(128),
    })
  })

  it('keeps origin + path of the referrer and drops its query', () => {
    expect(sanitizeReferrer('https://news.ycombinator.com/item?id=1&token=secret')).toBe(
      'https://news.ycombinator.com/item',
    )
    expect(sanitizeReferrer('not a url')).toBe('')
    expect(sanitizeReferrer('')).toBe('')
  })

  it('builds $-prefixed reserved props only', () => {
    const props = reservedViewProps({
      search: '?utm_source=hn&utm_medium=social&ref=glot it!',
      referrer: 'https://news.ycombinator.com/',
      pathname: '/',
      firstTouch: true,
    })
    expect(props).toEqual({
      $route: '/',
      $utm_source: 'hn',
      $utm_medium: 'social',
      $ref: 'glotit',
      $referrer: 'https://news.ycombinator.com/',
      $first_touch: true,
    })
    for (const key of Object.keys(props)) expect(key.startsWith('$')).toBe(true)
  })

  it('omits empty reserved values', () => {
    expect(reservedViewProps({ search: '', referrer: '', pathname: '/pricing/', firstTouch: false })).toEqual({
      $route: '/pricing',
    })
  })
})

describe('consent storage', () => {
  it('uses the SDK key shape mushi_events_consent_<projectId>', () => {
    expect(consentKey('abc')).toBe('mushi_events_consent_abc')
  })

  it('round-trips granted / denied and ignores junk', () => {
    const store = memoryStore({ [consentKey('p')]: 'maybe' })
    expect(readStoredConsent(store, 'p')).toBeNull()
    writeStoredConsent(store, 'p', 'granted')
    expect(readStoredConsent(store, 'p')).toBe('granted')
    writeStoredConsent(store, 'p', 'denied')
    expect(readStoredConsent(store, 'p')).toBe('denied')
    expect(readStoredConsent(null, 'p')).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readStoredConsent(broken, 'p')).toBeNull()
    expect(() => writeStoredConsent(broken, 'p', 'granted')).not.toThrow()
  })
})

describe('first touch', () => {
  const now = new Date('2026-09-20T00:00:00.000Z')

  it('records utm + referrer + landing path once and never overwrites', () => {
    const store = memoryStore()
    const first = buildFirstTouch({
      search: '?utm_source=hn&utm_medium=social&utm_campaign=launch&utm_term=ignored',
      referrer: 'https://news.ycombinator.com/item?id=1',
      pathname: '/',
      now,
    })
    expect(first).toEqual({
      utm_source: 'hn',
      utm_medium: 'social',
      utm_campaign: 'launch',
      referrer: 'https://news.ycombinator.com/item',
      landing_path: '/',
      at: '2026-09-20T00:00:00.000Z',
    })

    expect(recordFirstTouchOnce(store, 'p', first)).toEqual({ touch: first, created: true })
    expect(store.data[firstTouchKey('p')]).toBe(JSON.stringify(first))

    const later = buildFirstTouch({ search: '?utm_source=twitter', referrer: '', pathname: '/pricing', now })
    expect(recordFirstTouchOnce(store, 'p', later)).toEqual({ touch: first, created: false })
    expect(readFirstTouch(store, 'p')).toEqual(first)
  })

  it('rejects malformed stored records', () => {
    expect(readFirstTouch(memoryStore({ [firstTouchKey('p')]: '{"nope":1}' }), 'p')).toBeNull()
    expect(readFirstTouch(memoryStore({ [firstTouchKey('p')]: 'not json' }), 'p')).toBeNull()
    expect(readFirstTouch(memoryStore(), 'p')).toBeNull()
  })
})

describe('commitFirstTouch (consent gate)', () => {
  const touch = buildFirstTouch({
    search: '?utm_source=hn',
    referrer: '',
    pathname: '/',
    now: new Date('2026-09-21T00:00:00.000Z'),
  })

  it('writes nothing before the visitor accepts', () => {
    for (const consent of [null, 'pending', 'denied', 'blocked'] as const) {
      const store = memoryStore()
      expect(commitFirstTouch(store, 'p', touch, consent)).toBeNull()
      expect(store.data).toEqual({})
    }
  })

  it('records the in-memory candidate once consent is granted', () => {
    const store = memoryStore()
    expect(commitFirstTouch(store, 'p', touch, 'granted')).toEqual({ touch, created: true })
    expect(readFirstTouch(store, 'p')).toEqual(touch)
  })

  it('keeps an earlier record instead of overwriting it', () => {
    const earlier = buildFirstTouch({ search: '?utm_source=reddit', referrer: '', pathname: '/pricing' })
    const store = memoryStore({ [firstTouchKey('p')]: JSON.stringify(earlier) })
    expect(commitFirstTouch(store, 'p', touch, 'granted')).toEqual({ touch: earlier, created: false })
  })
})

describe('firstTouchReservedProps', () => {
  it('maps the stored first touch to $ft_* reserved props', () => {
    const touch = buildFirstTouch({
      search: '?utm_source=hn&utm_medium=social&utm_campaign=launch',
      referrer: 'https://news.ycombinator.com/item?id=1',
      pathname: '/pricing/',
    })
    const props = firstTouchReservedProps(touch)
    expect(props).toEqual({
      $ft_landing_path: '/pricing',
      $ft_utm_source: 'hn',
      $ft_utm_medium: 'social',
      $ft_utm_campaign: 'launch',
      $ft_referrer: 'https://news.ycombinator.com/item',
    })
    for (const key of Object.keys(props)) expect(key.startsWith('$')).toBe(true)
  })

  it('omits what the first touch did not have, and is empty without one', () => {
    expect(firstTouchReservedProps(buildFirstTouch({ search: '', referrer: '', pathname: '/' }))).toEqual({
      $ft_landing_path: '/',
    })
    expect(firstTouchReservedProps(null)).toEqual({})
  })
})

describe('CTA links', () => {
  it('classifies signup and connect hrefs', () => {
    expect(ctaHrefKind('https://kensaur.us/mushi-mushi/admin/signup?src=landing-hero')).toBe('signup')
    expect(ctaHrefKind('/signup')).toBe('signup')
    expect(ctaHrefKind('/connect')).toBe('connect')
    expect(ctaHrefKind('/quickstart/incident-loop')).toBeNull()
    expect(ctaHrefKind(null)).toBeNull()
  })

  const granted = { consent: 'granted' } as const
  const hnTouch = buildFirstTouch({
    search: '?utm_source=hn&utm_medium=social&utm_campaign=launch',
    referrer: '',
    pathname: '/',
    now: new Date('2026-09-22T00:00:00.000Z'),
  })

  it('appends src when absent and never overwrites an existing src', () => {
    expect(decorateSignupHref('https://x.test/admin/signup', { ...granted, ctaId: 'pricing-start' })).toBe(
      'https://x.test/admin/signup?src=pricing-start',
    )
    expect(decorateSignupHref('https://x.test/admin/signup?src=landing-hero', { ...granted, ctaId: 'other' })).toBe(
      'https://x.test/admin/signup?src=landing-hero',
    )
  })

  it('decorates nothing unless consent is granted', () => {
    const href = 'https://x.test/admin/signup'
    for (const consent of [null, 'pending', 'denied', 'blocked'] as const) {
      expect(
        decorateSignupHref(href, { ctaId: 'landing-hero', consent, firstTouch: hnTouch, landingRef: 'a1b2c3d4e5f6' }),
      ).toBe(href)
    }
  })

  it('carries first touch in ft_src + utm_*, never in ref', () => {
    const next = decorateSignupHref('https://x.test/admin/signup', {
      ...granted,
      ctaId: 'landing-hero',
      firstTouch: hnTouch,
    })
    const params = new URL(next).searchParams
    expect(params.get('src')).toBe('landing-hero')
    expect(params.get('ft_src')).toBe('hn')
    expect(params.get('utm_source')).toBe('hn')
    expect(params.get('utm_medium')).toBe('social')
    expect(params.get('utm_campaign')).toBe('launch')
    // The collision this pins: ref=<utm_source> made every UTM visitor a
    // growth-loop signup in the console.
    expect(params.has('ref')).toBe(false)
  })

  it('forwards the landing ref unchanged alongside first touch', () => {
    // What the widget mark lands with: utm_source=widget + ref=<project hash>.
    const widgetTouch = buildFirstTouch({
      search: '?utm_source=widget&utm_medium=powered-by&ref=a1b2c3d4e5f6',
      referrer: '',
      pathname: '/',
    })
    const params = new URL(
      decorateSignupHref('https://x.test/admin/signup', {
        ...granted,
        ctaId: 'landing-hero',
        firstTouch: widgetTouch,
        landingRef: 'a1b2c3d4e5f6',
      }),
    ).searchParams
    expect(params.get('ref')).toBe('a1b2c3d4e5f6')
    expect(params.get('ft_src')).toBe('widget')
  })

  it('never overwrites params the link already carries, and slug-cleans values', () => {
    expect(
      decorateSignupHref('https://x.test/admin/signup?ref=kept&utm_source=post', {
        ...granted,
        ctaId: 'a',
        firstTouch: hnTouch,
        landingRef: 'a1b2c3d4e5f6',
      }),
    ).toBe('https://x.test/admin/signup?ref=kept&utm_source=post&src=a&ft_src=hn&utm_medium=social&utm_campaign=launch')
    expect(decorateSignupHref('https://x.test/admin/signup', { ...granted, ctaId: 'a', landingRef: '<script>' })).toBe(
      'https://x.test/admin/signup?src=a&ref=script',
    )
    expect(decorateSignupHref('https://x.test/admin/signup', { ...granted, ctaId: 'a', landingRef: '!!!' })).toBe(
      'https://x.test/admin/signup?src=a',
    )
  })

  it('keeps relative hrefs relative and leaves junk untouched', () => {
    expect(decorateSignupHref('/signup#top', { ...granted, ctaId: 'pricing', landingRef: 'abc123' })).toBe(
      '/signup?src=pricing&ref=abc123#top',
    )
    expect(decorateSignupHref('http://[bad', { ...granted, ctaId: 'a' })).toBe('http://[bad')
  })

  it('sanitizes ref slugs', () => {
    expect(sanitizeRefSlug('  glot.it ')).toBe('glot.it')
    expect(sanitizeRefSlug('')).toBeNull()
    expect(sanitizeRefSlug(undefined)).toBeNull()
    expect(sanitizeRefSlug('x'.repeat(100))).toHaveLength(64)
  })
})

describe('dntActive', () => {
  it('honours DNT and GPC the way the SDK does', () => {
    expect(dntActive(undefined)).toBe(false)
    expect(dntActive({ doNotTrack: '0' })).toBe(false)
    expect(dntActive({ doNotTrack: '1' })).toBe(true)
    expect(dntActive({ msDoNotTrack: 'yes' })).toBe(true)
    expect(dntActive({ globalPrivacyControl: true })).toBe(true)
    expect(dntActive({}, { doNotTrack: '1' })).toBe(true)
  })
})
