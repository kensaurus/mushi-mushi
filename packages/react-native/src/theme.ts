/**
 * FILE: theme.ts
 * PURPOSE: Host-adaptive theme for the RN report sheet (`widget.theme`).
 *
 * OVERVIEW:
 * - Defaults are neutral: the shared washi/sumi surfaces with an INK accent,
 *   so the sheet reads as part of the host app rather than a neon Mushi
 *   product. The neon palette is only used by `<MushiBanner variant="neon">`.
 * - Hosts override any token. When a host sets `accent` but not `accentFg`,
 *   the text colour on the accent is picked for contrast (black or white).
 *
 * Plan 018 (docs/execplans/reporter-loop-v2.md §1.4).
 */

import { mushiPalette, MUSHI_CONTROL_DISABLED, MUSHI_RADIUS } from '@mushi-mushi/core'

export interface MushiRNTheme {
  /** Sheet background. */
  bg: string
  /** Primary text. */
  fg: string
  /** Secondary text. */
  muted: string
  /** Cards, inputs, chips. */
  surface: string
  /** Borders and separators. */
  border: string
  /** Selected chip, primary button, links. */
  accent: string
  /** Text on `accent`. */
  accentFg: string
  success: string
  error: string
  /** Host font family; undefined keeps the platform font. */
  fontFamily?: string
  /** Corner radius for cards, inputs and buttons. */
  radius: number
}

/** Resolved theme plus the derived colours the sheet needs. */
export interface ResolvedRNTheme extends MushiRNTheme {
  backdrop: string
  disabled: string
  disabledFg: string
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Black or white, whichever contrasts more with `bg`. Non-hex input returns `fallback`. */
function contrastingText(bg: string, fallback: string): string {
  const rgb = hexToRgb(bg)
  if (!rgb) return fallback
  const l = luminance(rgb)
  // Contrast with white vs black: (1.05)/(l+0.05) vs (l+0.05)/(0.05).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#FFFFFF' : '#000000'
}

export function resolveRNTheme(dark: boolean, override: Partial<MushiRNTheme> = {}): ResolvedRNTheme {
  const pal = mushiPalette(dark ? 'dark' : 'light')
  const base: MushiRNTheme = {
    bg: dark ? pal.paper : pal.paperRaised,
    fg: pal.ink,
    muted: pal.inkMuted,
    surface: dark ? pal.paperRaised : pal.paper,
    border: pal.ruleStrong,
    accent: pal.ink,
    accentFg: dark ? pal.paper : pal.paperRaised,
    success: pal.ok,
    error: pal.danger,
    fontFamily: undefined,
    radius: MUSHI_RADIUS.card,
  }
  const defined = Object.fromEntries(
    Object.entries(override).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<MushiRNTheme>
  const merged: MushiRNTheme = { ...base, ...defined }
  if (defined.accent && !defined.accentFg) merged.accentFg = contrastingText(defined.accent, base.accentFg)
  return {
    ...merged,
    backdrop: dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)',
    disabled: dark ? MUSHI_CONTROL_DISABLED.dark : MUSHI_CONTROL_DISABLED.light,
    disabledFg: pal.inkFaint,
  }
}
