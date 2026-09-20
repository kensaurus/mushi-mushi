/**
 * Unit tests for the docs-site funnel helpers (no DOM — storage is injected).
 */
import { describe, expect, it } from 'vitest'
import {
  buildFirstTouch,
  consentKey,
  ctaHrefKind,
  decorateSignupHref,
  dntActive,
  firstTouchKey,
  parseUtm,
  readFirstTouch,
  readSiteAnalyticsConfig,
  readStoredConsent,
  recordFirstTouchOnce,
  reservedViewProps,
  sanitizeReferrer,
  sanitizeRefSlug,
  viewEventForRoute,
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

describe('CTA links', () => {
  it('classifies signup and connect hrefs', () => {
    expect(ctaHrefKind('https://kensaur.us/mushi-mushi/admin/signup?src=landing-hero')).toBe('signup')
    expect(ctaHrefKind('/signup')).toBe('signup')
    expect(ctaHrefKind('/connect')).toBe('connect')
    expect(ctaHrefKind('/quickstart/incident-loop')).toBeNull()
    expect(ctaHrefKind(null)).toBeNull()
  })

  it('appends src when absent and never overwrites an existing src', () => {
    expect(decorateSignupHref('https://x.test/admin/signup', 'pricing-start')).toBe(
      'https://x.test/admin/signup?src=pricing-start',
    )
    expect(decorateSignupHref('https://x.test/admin/signup?src=landing-hero', 'other')).toBe(
      'https://x.test/admin/signup?src=landing-hero',
    )
  })

  it('appends a slug-safe ref from the first-touch utm_source when known', () => {
    expect(decorateSignupHref('https://x.test/admin/signup?src=landing-hero', 'landing-hero', 'hn')).toBe(
      'https://x.test/admin/signup?src=landing-hero&ref=hn',
    )
    expect(decorateSignupHref('https://x.test/admin/signup?ref=kept', 'a', 'hn')).toBe(
      'https://x.test/admin/signup?ref=kept&src=a',
    )
    expect(decorateSignupHref('https://x.test/admin/signup', 'a', '<script>')).toBe(
      'https://x.test/admin/signup?src=a&ref=script',
    )
    expect(decorateSignupHref('https://x.test/admin/signup', 'a', '!!!')).toBe('https://x.test/admin/signup?src=a')
  })

  it('keeps relative hrefs relative and leaves junk untouched', () => {
    expect(decorateSignupHref('/signup#top', 'pricing', 'hn')).toBe('/signup?src=pricing&ref=hn#top')
    expect(decorateSignupHref('http://[bad', 'a')).toBe('http://[bad')
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
