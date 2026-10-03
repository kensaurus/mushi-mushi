/**
 * FILE: apps/admin/src/components/design/directionMock.ts
 * PURPOSE: Pure token → role resolution for the Directions board. Each role
 *          lists the token paths it accepts, most specific first, so the three
 *          glot directions (which name a few roles differently) all resolve:
 *            component tokens (choice.*, button.primary.*) → semantic roles
 *            (color.surface.base | color.surface.canvas, …) → a neutral
 *            default.
 *
 *          Defaults are CSS keywords (system colours, `inherit`, `currentColor`)
 *          — never colour literals — and every role that fell back is listed
 *          in `defaulted`, so the mock never silently looks "on-system".
 */

import type { DesignDirection, DesignToken } from '../../lib/recipeTypes'
import { cssFontFamily, dimensionPx } from './designTokens'

export interface DirectionRoles {
  canvas: string
  raised: string
  text: string
  textMuted: string
  textOnRaised: string
  choiceBg: string
  choiceFg: string
  action: string
  onAction: string
  reward: string
  line: string
  radiusPx: number
  fontDisplay: string
  fontBody: string
  fontLabel: string
  /** Roles that found no token and use the neutral default. */
  defaulted: string[]
}

type ColorRole = Exclude<keyof DirectionRoles, 'radiusPx' | 'fontDisplay' | 'fontBody' | 'fontLabel' | 'defaulted'>

const COLOR_CANDIDATES: Record<ColorRole, readonly string[]> = {
  canvas: ['color.surface.base', 'color.surface.canvas', 'color.surface.default'],
  raised: ['color.surface.raised', 'color.surface.sunken'],
  text: ['color.text.primary', 'color.text.default'],
  textMuted: ['color.text.secondary', 'color.text.tertiary'],
  textOnRaised: ['color.text.onRaised'],
  choiceBg: ['choice.background', 'color.surface.raised'],
  choiceFg: ['choice.foreground', 'color.text.onRaised', 'color.text.primary'],
  action: ['button.primary.background', 'color.action.primary'],
  onAction: ['button.primary.foreground', 'color.text.onAction', 'color.action.onPrimary'],
  reward: ['color.feedback.reward', 'color.text.reward', 'color.feedback.positive'],
  line: ['color.line.default', 'color.line.strong'],
}

/** Data-free defaults: CSS system colours / keywords, never literals. */
const COLOR_DEFAULT: Record<ColorRole, string> = {
  canvas: 'Canvas',
  raised: 'ButtonFace',
  text: 'CanvasText',
  textMuted: 'GrayText',
  textOnRaised: 'ButtonText',
  choiceBg: 'ButtonFace',
  choiceFg: 'ButtonText',
  action: 'Highlight',
  onAction: 'HighlightText',
  reward: 'currentColor',
  line: 'currentColor',
}

const RADIUS_CANDIDATES = ['radius.control', 'button.primary.radius', 'choice.radius'] as const
const FONT_CANDIDATES = {
  fontDisplay: ['font.family.display', 'font.family.thai', 'font.family.body', 'font.family.ui'],
  fontBody: ['font.family.body', 'font.family.thai', 'font.family.ui', 'font.family.display'],
  fontLabel: ['font.family.label', 'font.family.mono', 'font.family.ui', 'font.family.body'],
} as const

function index(tokens: DesignToken[]): Map<string, DesignToken> {
  const m = new Map<string, DesignToken>()
  for (const t of tokens) m.set(t.path, t)
  return m
}

function firstColor(idx: Map<string, DesignToken>, paths: readonly string[]): string | null {
  for (const p of paths) {
    const hex = idx.get(p)?.hex
    if (hex) return hex
  }
  return null
}

function firstFont(idx: Map<string, DesignToken>, paths: readonly string[]): string | null {
  for (const p of paths) {
    const t = idx.get(p)
    if (!t) continue
    const family = cssFontFamily(t.value, t.display)
    if (family && family !== 'inherit') return family
  }
  return null
}

export function resolveDirectionRoles(tokens: DesignToken[]): DirectionRoles {
  const idx = index(tokens)
  const defaulted: string[] = []

  const colors = {} as Record<ColorRole, string>
  for (const role of Object.keys(COLOR_CANDIDATES) as ColorRole[]) {
    const found = firstColor(idx, COLOR_CANDIDATES[role])
    if (found) colors[role] = found
    else {
      colors[role] = COLOR_DEFAULT[role]
      defaulted.push(role)
    }
  }
  // Text on a raised surface: an explicit token, else the primary text colour.
  if (defaulted.includes('textOnRaised') && !defaulted.includes('text')) {
    colors.textOnRaised = colors.text
    defaulted.splice(defaulted.indexOf('textOnRaised'), 1)
  }

  let radiusPx = 0
  let radiusFound = false
  for (const p of RADIUS_CANDIDATES) {
    const t = idx.get(p)
    const px = t ? t.px ?? dimensionPx(t.value) : null
    if (px !== null && px !== undefined) {
      radiusPx = Math.max(0, Math.min(px, 32))
      radiusFound = true
      break
    }
  }
  if (!radiusFound) defaulted.push('radius')

  const fonts = {} as Record<keyof typeof FONT_CANDIDATES, string>
  for (const role of Object.keys(FONT_CANDIDATES) as Array<keyof typeof FONT_CANDIDATES>) {
    const found = firstFont(idx, FONT_CANDIDATES[role])
    if (found) fonts[role] = found
    else {
      fonts[role] = 'inherit'
      defaulted.push(role)
    }
  }

  return { ...colors, radiusPx, ...fonts, defaulted }
}

const ROLE_ORDER = ['color.surface.', 'color.text.', 'color.action.', 'color.feedback.', 'color.line.'] as const

/** Colour tokens with the semantic roles first (surface, text, action, feedback, line), then the rest. */
export function orderPalette(direction: Pick<DesignDirection, 'tokens'>): DesignToken[] {
  const colors = direction.tokens.filter((t) => t.hex && (t.type === 'color' || t.type === null))
  const rank = (path: string) => {
    const i = ROLE_ORDER.findIndex((prefix) => path.startsWith(prefix))
    return i === -1 ? ROLE_ORDER.length : i
  }
  return colors
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t.path) - rank(b.t.path) || a.i - b.i)
    .map(({ t }) => t)
}

/** Four choice labels for the mock: the prompt word plus up to three words from the sample. */
export function mockChoices(word: string, sample: string): string[] {
  const out = [word]
  for (const w of sample.split(/\s+/)) {
    const clean = w.replace(/[.,!?;:"'()]/g, '')
    if (clean && !out.includes(clean) && clean.length <= 12) out.push(clean)
    if (out.length === 4) break
  }
  const fill = ['—', '…', '·']
  while (out.length < 4) out.push(fill[out.length - 1] ?? '·')
  return out
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * A server asset path (relative to the api base) → an absolute URL for an
 * `<img src>`, or null when unsafe. The api base can come from a setting
 * stored in this browser, so the joined URL is parsed and checked: it must
 * stay on the api's origin and under its path, and be https (http only on a
 * loopback host, for local development). Anything else, a `javascript:` or
 * `data:` URL included, is refused.
 */
export function directionAssetUrl(
  url: string | null,
  apiBase: string,
  pageOrigin: string = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
): string | null {
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return null
  let base: URL
  let asset: URL
  try {
    base = new URL(apiBase || '/', pageOrigin)
    asset = new URL(`${apiBase}${url}`, pageOrigin)
  } catch {
    return null
  }
  if (asset.origin !== base.origin || asset.username || asset.password) return null
  const basePath = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname
  if (!asset.pathname.startsWith(`${basePath}/`)) return null
  const href = asset.href
  if (href.startsWith('https://')) return href
  if (href.startsWith('http://') && LOOPBACK_HOSTS.has(asset.hostname)) return href
  return null
}
