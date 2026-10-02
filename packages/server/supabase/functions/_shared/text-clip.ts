/**
 * FILE: packages/server/supabase/functions/_shared/text-clip.ts
 * PURPOSE: Shorten display text without cutting a word in half.
 *
 * fast-filter stored `reports.summary` as `.slice(0, 200)`, so the console
 * heading read "…creating awkwar". Pure, no imports.
 */

/**
 * At most `max` characters. Over the limit, the text is cut at the last space
 * that keeps a reasonable amount of it (≥ 60%) and ends with "…"; a single
 * unbroken token falls back to a hard cut, still with the ellipsis.
 */
export function clipAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const budget = Math.max(1, max - 1)
  const head = clean.slice(0, budget)
  const lastSpace = head.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor(budget * 0.6) ? head.slice(0, lastSpace) : head
  return `${cut.replace(/[\s,;:.\-–—]+$/, '')}…`
}
