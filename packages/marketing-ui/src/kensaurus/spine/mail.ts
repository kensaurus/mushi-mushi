/**
 * KENSAURUS spine — the email kit: one designed layout for every app's mail.
 *
 * SOURCE: kensaurus/yen-yen kensaurus-spine/mail.ts. Vendored copies are
 * written by scripts/spine-sync.mjs and verified by check-spine.mjs — do not
 * edit a copy; change the source and re-sync. ADR 0100 records the rules.
 *
 * `renderMail(input)` is pure: subject, preheader, HTML and a plain-text twin.
 * It runs unchanged in Deno (edge functions), Node and the browser, so this
 * file imports NOTHING — Deno rejects the spine's extensionless imports
 * without `--sloppy-imports`. The brand table and the go-link builder below
 * are therefore copies; mail.test.mjs proves they match the manifest,
 * `siblings()` and `goLink()` on every run.
 *
 * Mail-client rules: 600px single column, tables and inline styles only, a
 * hidden preheader, a mobile media query, a dark-mode block, images only as
 * absolute https PNG/JPG with alt text (Outlook and Gmail fail on SVG and
 * WebP), every text escaped, links only https or mailto, and a size budget
 * well under Gmail's 102 KB clip.
 *
 * Kinds:
 *   security       sign-in codes, resets, magic links: no cross-links, ever
 *   transactional  receipts, confirmations, invites: cross-links unless
 *                  `crossLinks: false` (payment mail)
 *   marketing      announcements: cross-links, a required `unsubscribeUrl`,
 *                  a visible opt-out line, and the RFC 8058 header pair
 *   operator       owner-only mail (digests, alerts): no cross-links, no UTM,
 *                  no sender block; a one-line footer naming the app and
 *                  what triggers the mail (a required `trigger`)
 *
 * Transactional and marketing footers carry the sender facts
 * 特定電子メール法 asks of mail that can carry an ad: the legal name, the
 * address and a contact. Security mail carries one line instead (the brand
 * or domain and why it was sent; owner 2026-10-14: a company name in a
 * sign-in mail reads like a scam), and operator mail goes only to the owner.
 * Never a phone number, and never any other company.
 *
 * `neutral: true` renders brand-free (a thin accent bar, the domain instead
 * of the brand name). `image.width` centres a small picture; `code.mono`
 * is a monospace snippet that keeps its line breaks.
 *
 * Report blocks (`status`, `rows`, `table`) serve any kind; operator mail is
 * built from them. `mailTags()` and `mailIdempotencyKey()` shape the Resend
 * `tags` field and `Idempotency-Key` header; an operator mail given an
 * `entityRefId` returns an `X-Entity-Ref-ID` header so Gmail does not thread
 * alerts that share a subject.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** The manifest ids (well-known/kensaurus-apps.json); mail.test.mjs pins the set. */
export type MailAppId =
  | 'glot-it'
  | 'yen-yen'
  | 'the-wanting-mind'
  | 'help-her-take-photo'
  | 'how-to-talk-to-girls'
  | 'solo-boss'
  | 'tsumagoi'
  | 'mushi-mushi'
  | 'cursor-kenji'
  | 'portfolio'

export type MailLang = 'ja' | 'en'
export type MailKind = 'security' | 'transactional' | 'marketing' | 'operator'

/** Report tone: always shown with a word or glyph as well as a colour. */
export type MailTone = 'ok' | 'warn' | 'bad'

export interface MailRow {
  readonly label: string
  readonly value: string
  /** Colours the value and prefixes a glyph (✓ ▲ ✕). */
  readonly tone?: MailTone
  /** A small muted line under the value. */
  readonly note?: string
}

export interface MailTableColumn {
  readonly label: string
  /** 'right' for numbers. Defaults to 'left'. */
  readonly align?: 'left' | 'right'
}

/** A `table` block holds at most this many rows (renderMail throws past it). */
export const MAIL_TABLE_MAX_ROWS = 12
/** …and at most this many columns, so it still fits a 320px screen. */
export const MAIL_TABLE_MAX_COLUMNS = 5

/** An `image` block's `width` runs from this to the 544px body width. */
export const MAIL_IMAGE_MIN_WIDTH = 40

export interface MailBrand {
  readonly id: MailAppId
  /** The manifest `brand`: the store name before " – ". */
  readonly name: string
  /** Brand colour (kensaur.us portfolioProjects.ts `accentColor`). */
  readonly accent: string
  /** The accent deepened to ≥ 4.5:1 against white: header bar, buttons, links. */
  readonly accentInk: string
  /** Absolute https PNG, checked 200 image/png on 2026-11-20; null = text wordmark. */
  readonly logo: string | null
  /** The manifest `web`. */
  readonly web: string
  /** Where a reader gets help; the web root where an app has no support page. */
  readonly support: string
  /** Mirrors `siblings()`: an app someone can open (store or web; not an SDK, a place or the hub). */
  readonly crossLink: boolean
}

export interface MailImage {
  /** Absolute https URL ending in .png, .jpg or .jpeg. */
  readonly src: string
  readonly alt: string
  readonly caption?: string
}

/** `id` becomes the link's utm_content; it defaults to `<type>-<index>`. */
export type MailBlock =
  | { readonly type: 'heading'; readonly text: string; readonly id?: string }
  | { readonly type: 'paragraph'; readonly text: string; readonly id?: string }
  | {
      readonly type: 'button'
      readonly label: string
      readonly url: string
      readonly id?: string
      /** false = never add UTM tags (a signed or single-use link). */
      readonly track?: boolean
    }
  | {
      readonly type: 'facts'
      readonly items: readonly [string, string] | readonly [string, string, string]
      readonly id?: string
    }
  | ({
      readonly type: 'image'
      readonly id?: string
      /**
       * Display width in px (MAIL_IMAGE_MIN_WIDTH–544), centred: a mascot at
       * 160–240 instead of a full-width picture. Omitted = full width.
       */
      readonly width?: number
    } & MailImage)
  | {
      readonly type: 'imagePair'
      readonly images: readonly [MailImage, MailImage]
      readonly id?: string
    }
  | {
      readonly type: 'code'
      readonly value: string
      readonly label?: string
      /**
       * true = a left-aligned monospace block that keeps line breaks (an
       * install snippet). Omitted = the big centred sign-in code.
       */
      readonly mono?: boolean
      readonly id?: string
    }
  | { readonly type: 'divider'; readonly id?: string }
  | { readonly type: 'note'; readonly text: string; readonly id?: string }
  | {
      /** A banner: coloured left bar, a tone word, the headline and an optional detail. */
      readonly type: 'status'
      readonly tone: MailTone
      readonly headline: string
      readonly detail?: string
      /** Replaces the tone word (OK / Watch / Action needed; 正常 / 注意 / 要対応). */
      readonly label?: string
      readonly id?: string
    }
  | {
      /** A label/value list; `title` names the section and its window ("Last 24 h"). */
      readonly type: 'rows'
      readonly title?: string
      readonly rows: readonly MailRow[]
      readonly id?: string
    }
  | {
      /** A header row plus at most MAIL_TABLE_MAX_ROWS rows of plain strings. */
      readonly type: 'table'
      readonly title?: string
      readonly columns: readonly MailTableColumn[]
      readonly rows: readonly (readonly string[])[]
      /** Shown instead of the body when `rows` is empty. Defaults to "None" / 「なし」. */
      readonly empty?: string
      readonly note?: string
      readonly id?: string
    }

interface MailInputBase {
  readonly app: MailAppId
  readonly lang: MailLang
  readonly subject: string
  /** The inbox preview line. Never a secret: it is visible on a locked screen. */
  readonly preheader: string
  /** A short line above the body, in the accent colour (「ロケ地・撮影のご案内」). */
  readonly eyebrow?: string
  /** Full-width photo under the header (1200px wide for retina). */
  readonly hero?: { readonly src: string; readonly alt: string }
  readonly blocks: readonly MailBlock[]
  /** utm_campaign, and `c` on cross-links: the template key, e.g. `otp-sign-in`. */
  readonly campaign: string
  /**
   * The "More from KENSAURUS" row: false hides it (payment mail), a list
   * picks the apps (up to 3). Ignored on security and operator mail, which
   * never have it.
   */
  readonly crossLinks?: boolean | readonly MailAppId[]
  /**
   * Brand-free mail (the-wanting-mind's neutral passport): a thin accent bar
   * instead of the logo and wordmark, the domain (`kensaur.us`) wherever the
   * brand name would appear, the web link at the domain root, and no
   * cross-link row. The caller keeps the product name out of the blocks.
   */
  readonly neutral?: boolean
}

/**
 * Why a security mail was sent, for its one-line footer. 'sign-in' (the
 * default) for codes and magic links; 'account' for everything else that
 * follows account activity: password or email changed, MFA added, recovery.
 */
export type MailSecurityReason = 'sign-in' | 'account'

export type MailInput =
  | (MailInputBase & {
      readonly kind: 'security'
      readonly unsubscribeUrl?: undefined
      readonly securityReason?: MailSecurityReason
    })
  | (MailInputBase & {
      readonly kind: 'transactional'
      readonly unsubscribeUrl?: undefined
    })
  | (MailInputBase & {
      readonly kind: 'marketing'
      /** https one-click endpoint; also the footer's visible opt-out link. */
      readonly unsubscribeUrl: string
    })
  | (MailInputBase & {
      readonly kind: 'operator'
      readonly unsubscribeUrl?: undefined
      /** What sends this mail, for the footer: "Daily at 09:05 JST", "Stripe webhook". */
      readonly trigger: string
      /**
       * A value unique to this send (the caller's `crypto.randomUUID()`):
       * returned as `X-Entity-Ref-ID` so Gmail never threads two alerts that
       * share a subject. Omit it on mail that should thread (a daily digest).
       */
      readonly entityRefId?: string
    })

export interface RenderedMail {
  readonly subject: string
  readonly preheader: string
  readonly html: string
  readonly text: string
  /** The RFC 8058 pair on marketing mail; `X-Entity-Ref-ID` on operator mail given one; empty otherwise. */
  readonly headers: Readonly<Record<string, string>>
}

// ── Sender facts ─────────────────────────────────────────────────────────────

export const MAIL_SENDER = {
  legalNameJa: 'ｋｅｎｓａｕｒｕｓ合同会社',
  legalNameEn: 'kensaurus LLC',
  address: '〒150-0043 東京都渋谷区道玄坂1丁目10番8号 渋谷道玄坂東急ビル2F-C',
  email: 'kensaurus@gmail.com',
} as const

/** Gmail clips at 102 KB; the kit keeps every mail well under it. */
export const MAIL_SIZE_BUDGET_BYTES = 60_000

// ── Brands ───────────────────────────────────────────────────────────────────
// name/web from the manifest, accent from kensaur.us portfolioProjects.ts
// (the hub's own accent for `portfolio` is its mask-icon colour). Logos are
// the apps' own hosted PNG icons; mushi-mushi, kenji skills and the hub have
// no PNG icon, so they render a text wordmark — never an invented URL.

export const MAIL_BRANDS: Readonly<Record<MailAppId, MailBrand>> = {
  'glot-it': {
    id: 'glot-it',
    name: 'glot.it',
    accent: '#E8387F',
    accentInk: '#C72F6C',
    logo: 'https://kensaur.us/glot-it/icon-192.png',
    web: 'https://kensaur.us/glot-it/',
    support: 'https://kensaur.us/glot-it/',
    crossLink: true,
  },
  'yen-yen': {
    id: 'yen-yen',
    name: 'yen-yen',
    accent: '#C8902A',
    accentInk: '#8F661C',
    logo: 'https://kensaur.us/yen-yen/icon-192.png',
    web: 'https://kensaur.us/yen-yen/',
    support: 'https://kensaur.us/yen-yen/',
    crossLink: true,
  },
  'the-wanting-mind': {
    id: 'the-wanting-mind',
    name: 'the wanting mind',
    accent: '#8B6914',
    accentInk: '#7C5D12',
    logo: 'https://kensaur.us/the-wanting-mind/pwa-192x192.png',
    web: 'https://kensaur.us/the-wanting-mind/',
    support: 'https://kensaur.us/the-wanting-mind/',
    crossLink: true,
  },
  'help-her-take-photo': {
    id: 'help-her-take-photo',
    name: 'help her take photo',
    accent: '#F5A0B8',
    accentInk: '#A8445F',
    logo: 'https://kensaur.us/help-her-take-photo/assets/apple-touch-icon.png',
    web: 'https://kensaur.us/help-her-take-photo/',
    support: 'https://kensaur.us/help-her-take-photo/',
    crossLink: true,
  },
  'how-to-talk-to-girls': {
    id: 'how-to-talk-to-girls',
    name: 'lets-talk',
    accent: '#C81E63',
    accentInk: '#B31B59',
    logo: 'https://talk.kensaur.us/pwa-192.png',
    web: 'https://talk.kensaur.us',
    support: 'https://talk.kensaur.us',
    crossLink: true,
  },
  'solo-boss': {
    id: 'solo-boss',
    name: '一人社長 Solo Boss',
    accent: '#047857',
    accentInk: '#046A4D',
    logo: 'https://solo-boss.kensaur.us/apple-touch-icon.png',
    web: 'https://solo-boss.kensaur.us/',
    support: 'https://solo-boss.kensaur.us/',
    crossLink: true,
  },
  tsumagoi: {
    id: 'tsumagoi',
    name: 'Tsumagoi Work&Camp 嬬恋牧場',
    accent: '#4D6B52',
    accentInk: '#3D5742',
    logo: 'https://tsumagoi.kensaur.us/apple-touch-icon.png',
    web: 'https://tsumagoi.kensaur.us/',
    support: 'https://tsumagoi.kensaur.us/',
    crossLink: false,
  },
  'mushi-mushi': {
    id: 'mushi-mushi',
    name: 'mushi-mushi',
    accent: '#E03C2C',
    accentInk: '#C23426',
    logo: null,
    web: 'https://kensaur.us/mushi-mushi/',
    support: 'https://kensaur.us/mushi-mushi/',
    crossLink: false,
  },
  'cursor-kenji': {
    id: 'cursor-kenji',
    name: 'kenji skills',
    accent: '#64748B',
    accentInk: '#56637A',
    logo: null,
    web: 'https://github.com/kensaurus/skills',
    support: 'https://github.com/kensaurus/skills',
    crossLink: false,
  },
  portfolio: {
    id: 'portfolio',
    name: 'kensaur.us',
    accent: '#2448A8',
    accentInk: '#2448A8',
    logo: null,
    web: 'https://kensaur.us/?view=portfolio',
    support: 'https://kensaur.us/',
    crossLink: false,
  },
}

/** Every brand id in manifest order (the order cross-links are picked in). */
export const MAIL_APP_IDS = Object.keys(MAIL_BRANDS) as readonly MailAppId[]

/** Apps the "More from KENSAURUS" row may show from `app`, in manifest order. */
export function mailSiblings(app: MailAppId): readonly MailBrand[] {
  return MAIL_APP_IDS.filter((id) => id !== app && MAIL_BRANDS[id].crossLink).map(
    (id) => MAIL_BRANDS[id],
  )
}

// ── Links ────────────────────────────────────────────────────────────────────

const GO_URL = 'https://kensaur.us/go/'

/** `goLink(app, '', { ref, campaign })` from links.ts, byte for byte (mail.test.mjs). */
export function mailGoLink(app: MailAppId, ref: MailAppId, campaign: string): string {
  const parts: string[] = []
  for (const [key, value] of [
    ['a', app],
    ['ref', ref],
    ['c', campaign],
  ] as const) {
    if (value === '') continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  return `${GO_URL}?${parts.join('&')}`
}

/** kensaur.us and its subdomains, except the API host (auth tokens, not pages). */
export function isOwnMailHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'api.kensaur.us') return false
  return host === 'kensaur.us' || host.endsWith('.kensaur.us')
}

function parseUrl(raw: string, what: string): URL {
  try {
    return new URL(raw)
  } catch {
    throw new Error(`renderMail: ${what} is not an absolute URL: ${raw}`)
  }
}

/** An https or mailto link, or a thrown error: never javascript:, data: or http:. */
function checkedHref(raw: string, what: string): URL {
  const url = parseUrl(raw, what)
  if (url.protocol !== 'https:' && url.protocol !== 'mailto:') {
    throw new Error(`renderMail: ${what} must be https or mailto: ${raw}`)
  }
  return url
}

/**
 * The link as the mail prints it: on our own domains, utm_source=email,
 * utm_medium=<kind>, utm_campaign, utm_content set through the URL API (an
 * existing query or #fragment is kept; never a second `?`). Other hosts,
 * mailto, `track: false` links and operator mail (the owner is not a
 * campaign audience) are returned untouched.
 */
export function mailHref(
  raw: string,
  utm: { readonly kind: MailKind; readonly campaign: string; readonly content: string },
  track = true,
): string {
  const url = checkedHref(raw, 'link')
  if (!track || utm.kind === 'operator') return url.toString()
  if (url.protocol !== 'https:' || !isOwnMailHost(url.hostname)) return url.toString()
  url.searchParams.set('utm_source', 'email')
  url.searchParams.set('utm_medium', utm.kind)
  url.searchParams.set('utm_campaign', utm.campaign)
  url.searchParams.set('utm_content', utm.content)
  return url.toString()
}

function checkedImage(src: string, alt: string): string {
  const url = parseUrl(src, 'image')
  if (url.protocol !== 'https:' || !/\.(png|jpe?g)$/i.test(url.pathname)) {
    throw new Error(`renderMail: images must be https PNG or JPG (no SVG, no WebP): ${src}`)
  }
  if (alt.trim() === '') throw new Error(`renderMail: image needs alt text: ${src}`)
  return url.toString()
}

/**
 * RFC 8058 one-click unsubscribe, which Gmail and Yahoo require on bulk
 * marketing mail: `List-Unsubscribe: <https>, <mailto>` plus
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The https endpoint
 * must accept a POST with no cookies.
 */
export function listUnsubscribeHeaders(
  unsubscribeUrl: string,
  mailto = `mailto:${MAIL_SENDER.email}?subject=unsubscribe`,
): { readonly 'List-Unsubscribe': string; readonly 'List-Unsubscribe-Post': string } {
  const https = parseUrl(unsubscribeUrl, 'unsubscribeUrl')
  if (https.protocol !== 'https:') {
    throw new Error(`listUnsubscribeHeaders: unsubscribeUrl must be https: ${unsubscribeUrl}`)
  }
  if (!mailto.startsWith('mailto:')) {
    throw new Error(`listUnsubscribeHeaders: mailto must start with mailto: ${mailto}`)
  }
  return {
    'List-Unsubscribe': `<${https.toString()}>, <${mailto}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

// ── Resend send options ──────────────────────────────────────────────────────
// Resend send-email API (read 2026-11-20): a tag name and value may hold only
// ASCII letters, digits, `_` and `-`, at most 256 characters each. The
// `Idempotency-Key` request header takes at most 256 characters and Resend
// keeps it for 24 hours: the same key within a day sends once.

export interface MailTag {
  readonly name: string
  readonly value: string
}

const TAG_MAX = 256

function tagSafe(value: string, what: string): string {
  const safe = value
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, TAG_MAX)
  if (safe.replace(/_/g, '') === '')
    throw new Error(`mailTags: ${what} is empty: ${JSON.stringify(value)}`)
  return safe
}

/**
 * The Resend `tags` for one mail: app, kind and template, plus any extras.
 * Characters Resend rejects become `_` (`glot.it` → `glot_it`); an empty
 * value throws instead of sending an untagged mail.
 */
export function mailTags(input: {
  readonly app: MailAppId
  readonly kind: MailKind
  readonly template: string
  readonly extra?: Readonly<Record<string, string>>
}): readonly MailTag[] {
  const pairs: [string, string][] = [
    ['app', input.app],
    ['kind', input.kind],
    ['template', input.template],
    ...Object.entries(input.extra ?? {}),
  ]
  return pairs.map(([name, value]) => ({
    name: tagSafe(name, 'tag name'),
    value: tagSafe(value, name),
  }))
}

const IDEMPOTENCY_MAX = 256

/** FNV-1a, 32-bit, as 8 hex characters: a stable suffix for an over-long key (no crypto import). */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * A Resend `Idempotency-Key` from its parts, joined with `/`:
 * `mailIdempotencyKey(['glot-ops-digest', '2026-11-20'])` →
 * `glot-ops-digest/2026-11-20`. Each part must be non-empty; anything but
 * printable ASCII becomes `_`. A key longer than 256 characters keeps its
 * start plus a hash of the whole, so two long keys stay distinct.
 */
export function mailIdempotencyKey(parts: readonly (string | number)[]): string {
  if (parts.length === 0) throw new Error('mailIdempotencyKey: needs at least one part')
  const clean = parts.map((part) => {
    const value = String(part)
      .trim()
      .replace(/[^\x21-\x7E]/g, '_')
    if (value === '') throw new Error('mailIdempotencyKey: a part is empty')
    return value
  })
  const key = clean.join('/')
  if (key.length <= IDEMPOTENCY_MAX) return key
  return `${key.slice(0, IDEMPOTENCY_MAX - 9)}~${fnv1a(key)}`
}

// ── Escaping ─────────────────────────────────────────────────────────────────

export function escapeMailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const esc = escapeMailHtml
/** Text with its line breaks kept. */
const escLines = (value: string): string => value.split('\n').map(esc).join('<br>')
/** A header-safe single line: CR/LF would let a caller inject headers. */
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()

// ── Copy ─────────────────────────────────────────────────────────────────────

const COPY = {
  ja: {
    more: 'KENSAURUS のほかのアプリ',
    code: '確認コード',
    why: {
      // Security mail's whole footer (owner 2026-10-14: a company name in a
      // sign-in mail reads like a scam), so it carries the brand or domain only.
      security: (b: string) =>
        `${b} から、このメールアドレスでのサインインのご依頼があったためお送りしています。お心当たりがない場合は、このメールを破棄してください。`,
      securityAccount: (b: string) =>
        `${b} のアカウント操作にあわせて自動でお送りしています。お心当たりがない場合は、このメールを破棄してください。`,
      transactional: (b: string) => `${b}のご利用内容についてのお知らせです。`,
      marketing: (b: string) => `${b}のお知らせの受け取りに登録された方にお送りしています。`,
    },
    optOut: '配信停止はこちら',
    optOutLead: '今後このお知らせが不要な場合は',
    contact: 'お問い合わせ',
    sender: '送信者',
    address: '所在地',
    operator: (b: string, trigger: string) => `KENSAURUS 運営者あて · ${b} · ${trigger}`,
    tone: { ok: '正常', warn: '注意', bad: '要対応' },
    empty: 'なし',
  },
  en: {
    more: 'More from KENSAURUS',
    code: 'Your code',
    why: {
      security: (b: string) =>
        `${b} sent this because someone asked to sign in with this address. If it wasn't you, ignore it.`,
      securityAccount: (b: string) =>
        `${b} sent this automatically because of activity on your account. If it wasn't you, ignore it.`,
      transactional: (b: string) => `This email is about your use of ${b}.`,
      marketing: (b: string) => `You get this because you signed up for news from ${b}.`,
    },
    optOut: 'Unsubscribe',
    optOutLead: 'No longer want these emails?',
    contact: 'Contact',
    sender: 'Sender',
    address: 'Address',
    operator: (b: string, trigger: string) => `Sent to the KENSAURUS operator · ${b} · ${trigger}`,
    tone: { ok: 'OK', warn: 'Watch', bad: 'Action needed' },
    empty: 'None',
  },
} as const

// ── Style ────────────────────────────────────────────────────────────────────

const C = {
  outer: '#F3F1EC',
  card: '#FFFFFF',
  line: '#E6E1D6',
  ink: '#26241F',
  muted: '#6B675E',
  faint: '#8A867C',
  foot: '#FAF9F6',
  tint: '#F6F3EC',
  onAccent: '#FFFFFF',
} as const

/**
 * Report tones. `ink` is the tone word and a toned value: ≥ 4.5:1 on both
 * `bg` and the white card (mail.test.mjs checks it). `dark*` are the
 * prefers-color-scheme versions. No pure black or white anywhere.
 */
export const MAIL_TONES: Readonly<
  Record<
    MailTone,
    {
      readonly bar: string
      readonly bg: string
      readonly ink: string
      readonly glyph: string
      readonly darkBg: string
      readonly darkInk: string
    }
  >
> = {
  ok: {
    bar: '#2E7D4F',
    bg: '#EDF6F0',
    ink: '#1F6B41',
    glyph: '✓',
    darkBg: '#18271E',
    darkInk: '#86D6A6',
  },
  warn: {
    bar: '#C27C0E',
    bg: '#FDF3E1',
    ink: '#875200',
    glyph: '▲',
    darkBg: '#2B2414',
    darkInk: '#F0B85C',
  },
  bad: {
    bar: '#C0392B',
    bg: '#FCEBE9',
    ink: '#A12A1F',
    glyph: '✕',
    darkBg: '#2E1A18',
    darkInk: '#F49B90',
  },
}

const FONT = {
  ja: "'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  en: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Hiragino Sans','Meiryo',sans-serif",
} as const
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace"

const STYLE =
  'body{margin:0;padding:0;-webkit-text-size-adjust:100%}img{border:0;outline:none;text-decoration:none}' +
  '@media (max-width:620px){.km-card{width:100%!important}.km-pad{padding-left:20px!important;padding-right:20px!important}' +
  '.km-stack{display:block!important;width:100%!important;box-sizing:border-box;border-left:0!important}' +
  '.km-stack-gap{padding:0 0 12px!important}.km-btn,.km-btn a{display:block!important;text-align:center!important}}' +
  '@media (prefers-color-scheme:dark){.km-outer{background:#121110!important}.km-card{background:#1C1B19!important;border-color:#34312B!important}' +
  '.km-text{color:#ECEAE5!important}.km-muted{color:#ABA69C!important}.km-tint{background:#27251F!important}' +
  '.km-foot{background:#171614!important;border-color:#34312B!important}.km-link{color:#ECEAE5!important}' +
  '.km-line{border-color:#34312B!important}' +
  (Object.keys(MAIL_TONES) as MailTone[])
    .map(
      (t) =>
        `.km-bg-${t}{background:${MAIL_TONES[t].darkBg}!important}.km-ink-${t}{color:${MAIL_TONES[t].darkInk}!important}`,
    )
    .join('') +
  '}' +
  '[data-ogsc] .km-text{color:#ECEAE5!important}[data-ogsc] .km-muted{color:#ABA69C!important}[data-ogsc] .km-link{color:#ECEAE5!important}' +
  (Object.keys(MAIL_TONES) as MailTone[])
    .map((t) => `[data-ogsc] .km-ink-${t}{color:${MAIL_TONES[t].darkInk}!important}`)
    .join('')

// ── Render ───────────────────────────────────────────────────────────────────

interface Ctx {
  readonly brand: MailBrand
  readonly lang: MailLang
  readonly kind: MailKind
  readonly campaign: string
  readonly font: string
  readonly lh: string
}

function href(ctx: Ctx, raw: string, content: string, track = true): string {
  return mailHref(raw, { kind: ctx.kind, campaign: ctx.campaign, content }, track)
}

function p(
  ctx: Ctx,
  inner: string,
  size: number,
  color: string,
  cls: string,
  margin: string,
): string {
  return `<p class="${cls}" style="margin:${margin};font-family:${ctx.font};font-size:${size}px;line-height:${ctx.lh};color:${color};">${inner}</p>`
}

function imageCell(ctx: Ctx, img: MailImage, width: number): string {
  const src = checkedImage(img.src, img.alt)
  const caption = img.caption ? p(ctx, esc(img.caption), 12, C.muted, 'km-muted', '6px 0 0') : ''
  return `<img src="${esc(src)}" width="${width}" alt="${esc(img.alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;border-radius:6px;">${caption}`
}

function blockHtml(ctx: Ctx, block: MailBlock, id: string): string {
  switch (block.type) {
    case 'heading':
      return `<h2 class="km-text" style="margin:4px 0 12px;font-family:${ctx.font};font-size:20px;line-height:1.4;font-weight:700;color:${C.ink};">${esc(block.text)}</h2>`
    case 'paragraph':
      return p(ctx, escLines(block.text), 15, C.ink, 'km-text', '0 0 16px')
    case 'note':
      return p(ctx, escLines(block.text), 12, C.muted, 'km-muted', '0 0 14px')
    case 'divider':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr></table>`
    case 'button': {
      const url = href(ctx, block.url, id, block.track !== false)
      const ink = ctx.brand.accentInk
      return (
        `<table role="presentation" class="km-btn" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;border-collapse:separate;">` +
        `<tr><td align="center" bgcolor="${ink}" style="border-radius:6px;background:${ink};mso-padding-alt:13px 26px;">` +
        `<a href="${esc(url)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${ctx.font};font-size:15px;line-height:22px;font-weight:700;color:${C.onAccent};text-decoration:none;border-radius:6px;">${esc(block.label)} &rarr;</a>` +
        `</td></tr></table>`
      )
    }
    case 'facts': {
      const cells = block.items
        .map(
          (fact, i) =>
            `<td class="km-stack km-text" width="${Math.floor(100 / block.items.length)}%" valign="top" style="padding:12px 8px;${i === 0 ? '' : `border-left:1px solid ${C.line};`}font-family:${ctx.font};font-size:13px;line-height:1.6;color:${C.ink};text-align:center;">${esc(fact)}</td>`,
        )
        .join('')
      return `<table role="presentation" class="km-tint" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;background:${C.tint};border-radius:6px;"><tr>${cells}</tr></table>`
    }
    case 'image': {
      if (block.width === undefined) {
        return `<div style="margin:0 0 20px;">${imageCell(ctx, block, 544)}</div>`
      }
      const w = checkedImageWidth(block.width)
      return (
        `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px;"><tr>` +
        `<td align="center" width="${w}" style="width:${w}px;max-width:100%;text-align:center;">${imageCell(ctx, block, w)}</td>` +
        `</tr></table>`
      )
    }
    case 'imagePair': {
      const [a, b] = block.images
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>` +
        `<td class="km-stack km-stack-gap" width="50%" valign="top" style="padding-right:6px;">${imageCell(ctx, a, 266)}</td>` +
        `<td class="km-stack" width="50%" valign="top" style="padding-left:6px;">${imageCell(ctx, b, 266)}</td>` +
        `</tr></table>`
      )
    }
    case 'code': {
      if (block.mono) {
        return (
          `<table role="presentation" class="km-tint" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;background:${C.tint};border-radius:6px;"><tr><td style="padding:14px 16px;">` +
          (block.label ? p(ctx, esc(block.label), 12, C.muted, 'km-muted', '0 0 6px') : '') +
          `<pre class="km-text" style="margin:0;font-family:${MONO};font-size:13px;line-height:1.55;color:${C.ink};white-space:pre-wrap;word-break:break-all;">${esc(block.value)}</pre>` +
          `</td></tr></table>`
        )
      }
      const label = block.label ?? COPY[ctx.lang].code
      return (
        `<table role="presentation" class="km-tint" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;background:${C.tint};border-radius:6px;"><tr><td align="center" style="padding:18px 12px;">` +
        p(ctx, esc(label), 12, C.muted, 'km-muted', '0 0 6px') +
        `<p class="km-text" style="margin:0;font-family:${MONO};font-size:32px;line-height:1.2;font-weight:700;letter-spacing:8px;color:${C.ink};">${esc(block.value)}</p>` +
        `</td></tr></table>`
      )
    }
    case 'status': {
      const t = MAIL_TONES[block.tone]
      const label = block.label ?? COPY[ctx.lang].tone[block.tone]
      return (
        `<table role="presentation" class="km-bg-${block.tone}" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background:${t.bg};border-left:4px solid ${t.bar};border-radius:6px;"><tr><td style="padding:14px 16px;">` +
        `<p class="km-ink-${block.tone}" style="margin:0 0 4px;font-family:${ctx.font};font-size:12px;line-height:1.4;letter-spacing:0.06em;font-weight:700;color:${t.ink};">${esc(t.glyph)} ${esc(label)}</p>` +
        `<p class="km-text" style="margin:0;font-family:${ctx.font};font-size:17px;line-height:1.45;font-weight:700;color:${C.ink};">${esc(block.headline)}</p>` +
        (block.detail ? p(ctx, escLines(block.detail), 14, C.muted, 'km-muted', '6px 0 0') : '') +
        `</td></tr></table>`
      )
    }
    case 'rows': {
      const rows = block.rows
        .map((row, i) => {
          const last = i === block.rows.length - 1
          const line = last ? '' : `border-bottom:1px solid ${C.line};`
          const t = row.tone ? MAIL_TONES[row.tone] : null
          const value = (t ? `${esc(t.glyph)} ` : '') + esc(row.value)
          const note = row.note
            ? `<br><span class="km-muted" style="font-size:12px;font-weight:400;color:${C.muted};">${esc(row.note)}</span>`
            : ''
          return (
            `<tr><td class="km-muted km-line" valign="top" style="padding:8px 12px 8px 0;${line}font-family:${ctx.font};font-size:14px;line-height:1.5;color:${C.muted};">${esc(row.label)}</td>` +
            `<td class="${t ? `km-ink-${row.tone}` : 'km-text'} km-line" valign="top" align="right" style="padding:8px 0;${line}font-family:${ctx.font};font-size:14px;line-height:1.5;font-weight:700;color:${t ? t.ink : C.ink};text-align:right;">${value}${note}</td></tr>`
          )
        })
        .join('')
      return (
        sectionTitle(ctx, block.title) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;border-collapse:collapse;">${rows}</table>`
      )
    }
    case 'table': {
      checkTable(block)
      const cols = block.columns
      // Outer cells sit flush with the card padding; inner cells get 10px each side.
      const cell = (j: number) => ({
        align: cols[j]?.align === 'right' ? 'right' : 'left',
        right: j === cols.length - 1 ? '0' : '10px',
        left: j === 0 ? '0' : '10px',
      })
      const head = cols
        .map((col, j) => {
          const { align, right, left } = cell(j)
          return `<th class="km-muted km-line" align="${align}" style="padding:6px ${right} 6px ${left};border-bottom:1px solid ${C.line};font-family:${ctx.font};font-size:12px;line-height:1.4;font-weight:700;color:${C.muted};text-align:${align};">${esc(col.label)}</th>`
        })
        .join('')
      const body =
        block.rows.length === 0
          ? `<tr><td colspan="${cols.length}" class="km-muted" style="padding:10px 0;font-family:${ctx.font};font-size:13px;color:${C.muted};">${esc(block.empty ?? COPY[ctx.lang].empty)}</td></tr>`
          : block.rows
              .map((row, i) => {
                const line = i === block.rows.length - 1 ? '' : `border-bottom:1px solid ${C.line};`
                return (
                  '<tr>' +
                  row
                    .map((value, j) => {
                      const { align, right, left } = cell(j)
                      const nowrap =
                        align === 'right' ? 'white-space:nowrap;' : 'word-break:break-word;'
                      return `<td class="km-text km-line" align="${align}" valign="top" style="padding:7px ${right} 7px ${left};${line}font-family:${ctx.font};font-size:13px;line-height:1.5;color:${C.ink};text-align:${align};${nowrap}font-variant-numeric:tabular-nums;">${esc(value)}</td>`
                    })
                    .join('') +
                  '</tr>'
                )
              })
              .join('')
      const note = block.note
        ? p(ctx, escLines(block.note), 12, C.muted, 'km-muted', '6px 0 0')
        : ''
      return (
        sectionTitle(ctx, block.title) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${head}</tr>${body}</table>` +
        `<div style="margin:0 0 22px;">${note}</div>`
      )
    }
  }
}

function sectionTitle(ctx: Ctx, title: string | undefined): string {
  if (!title) return ''
  return `<h3 class="km-text" style="margin:0 0 6px;font-family:${ctx.font};font-size:13px;line-height:1.4;letter-spacing:0.04em;font-weight:700;color:${C.ink};">${esc(title)}</h3>`
}

/** An image width the body can hold, as an integer number of px. */
function checkedImageWidth(width: number): number {
  if (!Number.isInteger(width) || width < MAIL_IMAGE_MIN_WIDTH || width > 544) {
    throw new Error(
      `renderMail: image width must be an integer from ${MAIL_IMAGE_MIN_WIDTH} to 544, got ${width}`,
    )
  }
  return width
}

/** A table that would break the layout or hide data throws instead. */
function checkTable(block: Extract<MailBlock, { type: 'table' }>): void {
  const n = block.columns.length
  if (n === 0 || n > MAIL_TABLE_MAX_COLUMNS) {
    throw new Error(`renderMail: a table needs 1–${MAIL_TABLE_MAX_COLUMNS} columns, got ${n}`)
  }
  if (block.rows.length > MAIL_TABLE_MAX_ROWS) {
    throw new Error(
      `renderMail: a table holds at most ${MAIL_TABLE_MAX_ROWS} rows, got ${block.rows.length}`,
    )
  }
  block.rows.forEach((row, i) => {
    if (row.length !== n)
      throw new Error(`renderMail: table row ${i + 1} has ${row.length} cells, not ${n}`)
  })
}

function blockText(ctx: Ctx, block: MailBlock, id: string): string {
  switch (block.type) {
    case 'heading':
      return block.text
    case 'paragraph':
    case 'note':
      return block.text
    case 'divider':
      return '――――――――'
    case 'button':
      return `${block.label}: ${href(ctx, block.url, id, block.track !== false)}`
    case 'facts':
      return block.items.map((fact) => `・${fact}`).join('\n')
    case 'image':
      return [`[${block.alt}]`, block.caption].filter(Boolean).join(' ')
    case 'imagePair':
      return block.images
        .map((img) => [`[${img.alt}]`, img.caption].filter(Boolean).join(' '))
        .join('\n')
    case 'code':
      if (block.mono) return block.label ? `${block.label}:\n${block.value}` : block.value
      return `${block.label ?? COPY[ctx.lang].code}: ${block.value}`
    case 'status':
      return [
        `${MAIL_TONES[block.tone].glyph} [${block.label ?? COPY[ctx.lang].tone[block.tone]}] ${block.headline}`,
        block.detail,
      ]
        .filter(Boolean)
        .join('\n')
    case 'rows':
      return [
        ...(block.title ? [block.title] : []),
        ...block.rows.map(
          (row) =>
            `・${row.label}: ${row.tone ? `${MAIL_TONES[row.tone].glyph} ` : ''}${row.value}${row.note ? ` (${row.note})` : ''}`,
        ),
      ].join('\n')
    case 'table': {
      checkTable(block)
      const lines = block.rows.length
        ? [
            block.columns.map((c) => c.label).join(' | '),
            ...block.rows.map((row) => row.join(' | ')),
          ]
        : [block.empty ?? COPY[ctx.lang].empty]
      return [
        ...(block.title ? [block.title] : []),
        ...lines,
        ...(block.note ? [block.note] : []),
      ].join('\n')
    }
  }
}

function pickCrossLinks(input: MailInput): readonly MailBrand[] {
  if (input.kind === 'security' || input.kind === 'operator' || input.crossLinks === false)
    return []
  if (input.neutral) return []
  const allowed = mailSiblings(input.app)
  const chosen = Array.isArray(input.crossLinks)
    ? allowed.filter((b) => (input.crossLinks as readonly MailAppId[]).includes(b.id))
    : allowed
  return chosen.slice(0, 3)
}

function wordmark(ctx: Ctx, brand: MailBrand, size: number, color: string): string {
  return `<span style="font-family:${ctx.font};font-size:${size}px;font-weight:700;letter-spacing:0.02em;color:${color};">${esc(brand.name)}</span>`
}

function logoImg(brand: MailBrand, size: number): string {
  return brand.logo
    ? `<img src="${esc(brand.logo)}" width="${size}" height="${size}" alt="${esc(brand.name)}" style="display:block;width:${size}px;height:${size}px;border:0;border-radius:${Math.round(size / 4.5)}px;">`
    : ''
}

/** Subject, preheader, HTML and plain text for one mail. Throws on an unsafe link or image. */
export function renderMail(input: MailInput): RenderedMail {
  const brand = MAIL_BRANDS[input.app]
  if (!brand) throw new Error(`renderMail: unknown app ${String(input.app)}`)
  if (input.lang !== 'ja' && input.lang !== 'en') {
    throw new Error(`renderMail: lang must be ja or en, got ${String(input.lang)}`)
  }
  const campaign = oneLine(input.campaign ?? '')
  if (campaign === '') throw new Error('renderMail: campaign is required (utm_campaign)')
  if (input.kind === 'marketing' && !input.unsubscribeUrl) {
    throw new Error('renderMail: marketing mail needs an unsubscribeUrl')
  }
  const trigger = input.kind === 'operator' ? oneLine(input.trigger ?? '') : ''
  if (input.kind === 'operator' && trigger === '') {
    throw new Error('renderMail: operator mail needs a trigger (what sends it)')
  }
  let headers: Record<string, string> = {}
  if (input.kind === 'marketing') headers = { ...listUnsubscribeHeaders(input.unsubscribeUrl) }
  if (input.kind === 'operator' && input.entityRefId !== undefined) {
    const ref = oneLine(input.entityRefId)
    if (ref === '') throw new Error('renderMail: entityRefId is empty')
    headers = { 'X-Entity-Ref-ID': ref }
  }

  const lang = input.lang
  const copy = COPY[lang]
  const ctx: Ctx = {
    brand,
    lang,
    kind: input.kind,
    campaign,
    font: FONT[lang],
    lh: lang === 'ja' ? '1.85' : '1.65',
  }
  const subject = oneLine(input.subject)
  const preheader = oneLine(input.preheader)
  const blockId = (block: MailBlock, i: number): string => block.id ?? `${block.type}-${i + 1}`
  const cross = pickCrossLinks(input)
  const unsubscribe =
    input.kind === 'marketing' ? checkedHref(input.unsubscribeUrl, 'unsubscribeUrl').toString() : ''
  // Neutral mail names the domain, never the product, and links its root.
  const neutral = input.neutral === true
  const webRoot = neutral ? `${parseUrl(brand.web, 'brand web').origin}/` : brand.web
  const sender = neutral ? new URL(webRoot).hostname : brand.name
  let securityLine = ''
  if (input.kind === 'security') {
    const reason = input.securityReason ?? 'sign-in'
    if (reason !== 'sign-in' && reason !== 'account') {
      throw new Error(
        `renderMail: securityReason must be sign-in or account, got ${String(reason)}`,
      )
    }
    securityLine =
      reason === 'account' ? copy.why.securityAccount(sender) : copy.why.security(sender)
  }
  const webHref = href(ctx, webRoot, 'footer-web')
  const webLabel = webRoot.replace(/^https:\/\//, '').replace(/\/$/, '')

  // ── text ──
  const textParts: string[] = neutral ? [] : [brand.name, '']
  if (input.eyebrow) textParts.push(input.eyebrow, '')
  input.blocks.forEach((block, i) => textParts.push(blockText(ctx, block, blockId(block, i)), ''))
  if (cross.length > 0) {
    textParts.push(
      copy.more,
      ...cross.map(
        (b) =>
          `・${b.name}: ${href(ctx, mailGoLink(b.id, brand.id, campaign), `crosslink-${b.id}`)}`,
      ),
      '',
    )
  }
  if (input.kind === 'operator') {
    textParts.push('――――――――', copy.operator(sender, trigger))
  } else if (input.kind === 'security') {
    // A sign-in mail carries no company name, address or reply address.
    textParts.push('――――――――', securityLine)
  } else {
    textParts.push(
      '――――――――',
      copy.why[input.kind](sender),
      ...(input.kind === 'marketing' ? [`${copy.optOutLead} ${copy.optOut}: ${unsubscribe}`] : []),
      `${copy.sender}: ${MAIL_SENDER.legalNameJa} / ${MAIL_SENDER.legalNameEn}`,
      `${copy.address}: ${MAIL_SENDER.address}`,
      `${copy.contact}: ${MAIL_SENDER.email}`,
      webHref,
    )
  }
  const text = textParts.join('\n')

  // ── html ──
  const header = neutral
    ? `<tr><td bgcolor="${brand.accentInk}" style="background:${brand.accentInk};height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>`
    : `<tr><td class="km-pad" bgcolor="${brand.accentInk}" style="background:${brand.accentInk};padding:16px 28px;">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      (brand.logo
        ? `<td valign="middle" style="padding-right:10px;">${logoImg(brand, 28)}</td>`
        : '') +
      `<td valign="middle"><a href="${esc(webHref)}" style="text-decoration:none;">${wordmark(ctx, brand, 16, C.onAccent)}</a></td>` +
      `</tr></table></td></tr>`
  const hero = input.hero
    ? `<tr><td style="padding:0;"><img src="${esc(checkedImage(input.hero.src, input.hero.alt))}" width="600" alt="${esc(input.hero.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`
    : ''
  const eyebrow = input.eyebrow
    ? `<p style="margin:0 0 14px;font-family:${ctx.font};font-size:12px;line-height:1.5;letter-spacing:0.08em;font-weight:700;color:${brand.accentInk};">${esc(input.eyebrow)}</p>`
    : ''
  const body =
    `<tr><td class="km-pad" style="padding:28px 28px 8px;">${eyebrow}` +
    input.blocks.map((block, i) => blockHtml(ctx, block, blockId(block, i))).join('') +
    `</td></tr>`
  const crossHtml =
    cross.length > 0
      ? `<tr><td class="km-pad" style="padding:4px 28px 22px;">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${C.line};padding-top:16px;">` +
        p(ctx, esc(copy.more), 12, C.muted, 'km-muted', '0 0 10px') +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
        cross
          .map((b) => {
            const link = esc(href(ctx, mailGoLink(b.id, brand.id, campaign), `crosslink-${b.id}`))
            const icon = b.logo
              ? `<td valign="middle" style="padding-right:8px;"><a href="${link}">${logoImg(b, 24)}</a></td>`
              : ''
            return (
              `<td valign="middle" style="padding:0 18px 6px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${icon}` +
              `<td valign="middle"><a class="km-link" href="${link}" style="font-family:${ctx.font};font-size:13px;line-height:1.4;color:${C.ink};text-decoration:none;">${esc(b.name)}</a></td>` +
              `</tr></table></td>`
            )
          })
          .join('') +
        `</tr></table></td></tr></table></td></tr>`
      : ''
  const optOut =
    input.kind === 'marketing'
      ? p(
          ctx,
          `${esc(copy.optOutLead)} <a class="km-link" href="${esc(unsubscribe)}" style="color:${C.muted};text-decoration:underline;">${esc(copy.optOut)}</a>`,
          12,
          C.muted,
          'km-muted',
          '0 0 8px',
        )
      : ''
  const senderFacts = p(
    ctx,
    `${esc(MAIL_SENDER.legalNameJa)} / ${esc(MAIL_SENDER.legalNameEn)}<br>${esc(MAIL_SENDER.address)}<br>` +
      `${esc(copy.contact)}: <a class="km-link" href="mailto:${MAIL_SENDER.email}" style="color:${C.muted};">${MAIL_SENDER.email}</a>&nbsp;&nbsp;` +
      `<a class="km-link" href="${esc(webHref)}" style="color:${C.muted};">${esc(webLabel)}</a>`,
    12,
    C.faint,
    'km-muted',
    '0',
  )
  // Operator mail: one line naming the app and the trigger. Security mail:
  // one line, the brand or domain and why (no company, address or contact).
  // Transactional and marketing: why they got it, the opt-out on marketing,
  // and the 特定電子メール法 sender facts.
  const oneLineFooter = input.kind === 'operator' || input.kind === 'security'
  const footerInner =
    input.kind === 'operator'
      ? p(ctx, esc(copy.operator(sender, trigger)), 12, C.muted, 'km-muted', '0')
      : input.kind === 'security'
        ? p(ctx, esc(securityLine), 12, C.muted, 'km-muted', '0')
        : p(ctx, esc(copy.why[input.kind](sender)), 12, C.muted, 'km-muted', '0 0 8px') +
          optOut +
          senderFacts
  const footer =
    `<tr><td class="km-foot km-pad" style="padding:${oneLineFooter ? '14px 28px 16px' : '18px 28px 22px'};background:${C.foot};border-top:1px solid ${C.line};">` +
    footerInner +
    `</td></tr>`
  const filler = '&#847;&zwnj;&nbsp;'.repeat(40)
  const html =
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
    `<meta name="x-apple-disable-message-reformatting"><title>${esc(subject)}</title><style>${STYLE}</style></head>` +
    `<body class="km-outer" style="margin:0;padding:0;background:${C.outer};">` +
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.outer};opacity:0;">${esc(preheader)}${filler}</div>` +
    `<table role="presentation" class="km-outer" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.outer};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" class="km-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${C.card};border:1px solid ${C.line};border-radius:8px;overflow:hidden;">` +
    header +
    hero +
    body +
    crossHtml +
    footer +
    `</table></td></tr></table></body></html>`

  return { subject, preheader, html, text, headers }
}
