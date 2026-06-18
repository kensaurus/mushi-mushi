import type { ReactNode } from 'react'

/** Plain-string tooltips longer than this wrap unless `nowrap` is forced. */
export const TOOLTIP_NOWRAP_MAX_CHARS = 48

/**
 * Pick single-line vs wrapping layout for the shared Tooltip primitive.
 * Call sites can still override with an explicit `nowrap` prop.
 */
export function shouldTooltipNowrap(content: ReactNode, nowrap?: boolean): boolean {
  if (nowrap !== undefined) return nowrap
  if (typeof content === 'string') {
    const text = content.trim()
    if (!text) return true
    if (text.length > TOOLTIP_NOWRAP_MAX_CHARS) return false
    if (text.includes('\n')) return false
    // Explanatory copy (BYOK posture, metric help, stage hints) should wrap.
    if (/[.!?]\s/.test(text)) return false
    if (text.includes(' — ') || text.includes(' – ') || text.includes(' - ')) return false
    return true
  }
  if (typeof content === 'number' || typeof content === 'boolean') return true
  return false
}

export function tooltipLayoutClasses(nowrap: boolean): string {
  return nowrap ? 'mushi-tooltip mushi-tooltip--single' : 'mushi-tooltip mushi-tooltip--wrap'
}
