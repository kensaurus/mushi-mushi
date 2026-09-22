/**
 * KENSAURUS spine — cross-app link builders.
 *
 * SOURCE: kensaurus/yen-yen kensaurus-spine/links.ts. Vendored copies are
 * written by scripts/spine-sync.mjs and verified by check-spine.mjs — do not
 * edit a copy; change the source and re-sync.
 *
 * There are no new subdomains (owner decision, 2026-09-19): the redirector
 * is a static page on the existing hub, `https://kensaur.us/go/`, and the
 * passport is `https://kensaur.us/account/`. `goLink()` builds the
 * redirector URL (Phase 3: it logs a `crosslink_click`, then sends the
 * visitor to app / store / web). Until it ships, `webLink()` returns the
 * app's web URL with UTM tags so a "More from KENSAURUS" row can go live
 * today and switch to go-links later without touching call sites.
 */

import { KENSAURUS_APPS, type KensaurusApp, type KensaurusPlatform } from './apps.generated'
import { canonicalAppId } from './account'

/** The redirector: a static page on the apex hub, not a subdomain. */
export const KENSAURUS_GO_URL = 'https://kensaur.us/go/'
/** The passport (wallet, stamps, linked apps): a path on the apex hub. */
export const PASSPORT_URL = 'https://kensaur.us/account/'
/** The passport stamp drawings: one linocut per stamp app plus the explorer seal, on the hub. */
export const STAMP_ART_URL = 'https://kensaur.us/account/stamps/'

/**
 * Which inking of a stamp drawing to link. `current` is the hub's own file
 * (`fill="currentColor"`, for a CSS mask on kensaur.us itself). Another
 * origin cannot mask a cross-origin file, so it loads a pre-inked copy as a
 * plain `<img>`: `rose` is the passport's light-theme stamp ink, `amber` its
 * dark-theme stamp ink. Both are generated from the source on the hub, never
 * drawn separately, so a card in any app shows the same stamp the passport does.
 */
export type StampInk = 'current' | 'rose' | 'amber'

const STORE_PLATFORMS: readonly KensaurusPlatform[] = ['ios', 'android', 'web']

export interface GoLinkOptions {
  /** The app the link is shown in (attribution source). */
  readonly ref?: string
  /** Campaign / placement, e.g. `more-from-kensaurus`. */
  readonly campaign?: string
  /** Invite / referral code, forwarded as `r`. */
  readonly invite?: string
}

export interface PassportLinkOptions {
  readonly ref?: string
  readonly invite?: string
}

export interface WebLinkUtm {
  readonly source?: string
  readonly medium?: string
  readonly campaign?: string
  readonly content?: string
  readonly term?: string
  /** Kept alongside utm_* because every events client captures `ref` too. */
  readonly ref?: string
}

/** The manifest entry for an id or alias; undefined for unknown ids. */
export function kensaurusApp(idOrAlias: string): KensaurusApp | undefined {
  const id = canonicalAppId(idOrAlias)
  return (KENSAURUS_APPS as readonly KensaurusApp[]).find((app) => app.id === id)
}

function encodeQuery(params: Readonly<Record<string, string | undefined>>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+/, '')
}

function joinUrl(base: string, path: string): string {
  const rest = trimSlashes(path)
  if (rest === '') return base
  return base.endsWith('/') ? `${base}${rest}` : `${base}/${rest}`
}

/**
 * The `p` value for a go-link: a relative path with one leading `/`, or
 * undefined when the input could escape the app (a scheme, a
 * protocol-relative `//host`, a backslash a browser would read as `/`, or a
 * `..` segment). Dropped rather than thrown: this runs in render paths.
 */
export function goLinkPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  const trimmed = path.trim()
  if (trimmed === '' || trimmed === '/') return undefined
  if (
    trimmed.includes('://') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    trimmed.includes('..')
  ) {
    return undefined
  }
  return `/${trimSlashes(trimmed)}`
}

/**
 * `https://kensaur.us/go/?a=<appId>&p=<path>&ref=<ref>&c=<campaign>&r=<invite>`.
 * The app id is canonicalised, every value is URL-encoded, and `p` is only
 * set when `goLinkPath()` accepts it.
 */
export function goLink(idOrAlias: string, path = '', options: GoLinkOptions = {}): string {
  return `${KENSAURUS_GO_URL}${encodeQuery({
    a: canonicalAppId(idOrAlias),
    p: goLinkPath(path),
    ref: options.ref,
    c: options.campaign,
    r: options.invite,
  })}`
}

/** `https://kensaur.us/go/?a=passport&ref=<ref>&r=<invite>` — the passport via the redirector. */
export function passportLink(options: PassportLinkOptions = {}): string {
  return `${KENSAURUS_GO_URL}${encodeQuery({
    a: 'passport',
    ref: options.ref,
    r: options.invite,
  })}`
}

/** The app's own web URL plus `path` and UTM tags; undefined for unknown apps. */
export function webLink(idOrAlias: string, path = '', utm: WebLinkUtm = {}): string | undefined {
  const app = kensaurusApp(idOrAlias)
  if (!app) return undefined
  return `${joinUrl(app.web, path)}${encodeQuery({
    utm_source: utm.source,
    utm_medium: utm.medium,
    utm_campaign: utm.campaign,
    utm_content: utm.content,
    utm_term: utm.term,
    ref: utm.ref,
  })}`
}

/** Store page for a platform; undefined when the app has none listed. */
export function storeLink(idOrAlias: string, platform: 'ios' | 'android'): string | undefined {
  const app = kensaurusApp(idOrAlias)
  if (!app) return undefined
  return platform === 'ios' ? app.ios : app.android
}

function inkSuffix(ink: StampInk): string {
  return ink === 'current' ? '' : `.${ink}`
}

/**
 * `https://kensaur.us/account/stamps/<appId>[.rose|.amber].svg` — the stamp
 * an app earns, for its own KENSAURUS card or a "More from KENSAURUS" row.
 * Undefined for an app that earns no stamp (no activation event, or the
 * hub) and for unknown ids.
 */
export function stampArtUrl(idOrAlias: string, ink: StampInk = 'current'): string | undefined {
  const app = kensaurusApp(idOrAlias)
  if (!app || app.activationEvent === undefined || app.role === 'hub') return undefined
  return `${STAMP_ART_URL}${app.id}${inkSuffix(ink)}.svg`
}

/** `https://kensaur.us/account/stamps/kensaurus[.rose|.amber].svg` — the explorer seal a full passport earns. */
export function sealArtUrl(ink: StampInk = 'current'): string {
  return `${STAMP_ART_URL}kensaurus${inkSuffix(ink)}.svg`
}

/**
 * Apps worth cross-promoting from `idOrAlias`: every manifest app that ships
 * on a store or the web, excluding the app itself and the hub entry.
 */
export function siblings(idOrAlias: string): readonly KensaurusApp[] {
  const self = canonicalAppId(idOrAlias)
  return (KENSAURUS_APPS as readonly KensaurusApp[]).filter(
    (app) =>
      app.id !== self &&
      app.role !== 'hub' &&
      app.platforms.some((platform) => STORE_PLATFORMS.includes(platform)),
  )
}
