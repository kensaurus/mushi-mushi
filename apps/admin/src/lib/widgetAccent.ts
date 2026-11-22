/**
 * FILE: apps/admin/src/lib/widgetAccent.ts
 * PURPOSE: The widget brand colour in the console editor: parse what the
 *          person typed, and show the text colour and contrast the server
 *          will serve with it. Mirrors parseAccentColour / accentInk in
 *          packages/server/supabase/functions/_shared/sdk-config.ts, which
 *          stays the authority (the console only previews).
 */

/** `#rgb` / `#rrggbb`, with or without `#`, as lowercase `#rrggbb`; else null. */
export function parseAccentColour(value: string): string | null {
  const raw = value.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`
  return null
}

function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

// mushi-mushi-allowlist: widget colour values (the colour the host's users see), not console UI colours.
/** The two text colours the server pairs with an accent. */
export const INK_BLACK = '#000000'
// mushi-mushi-allowlist: widget colour value, not a console UI colour.
export const INK_WHITE = '#ffffff'
// mushi-mushi-allowlist: the swatch a person starts from when they switch Auto off.
export const DEFAULT_PICK = '#3b5bdb'

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Black or white text on the accent, whichever reads better, and its contrast ratio. */
export function accentInk(accent: string): { ink: typeof INK_BLACK | typeof INK_WHITE; ratio: number } {
  const onBlack = contrastRatio(accent, INK_BLACK)
  const onWhite = contrastRatio(accent, INK_WHITE)
  return {
    ink: onBlack >= onWhite ? INK_BLACK : INK_WHITE,
    ratio: Math.round(Math.max(onBlack, onWhite) * 10) / 10,
  }
}
