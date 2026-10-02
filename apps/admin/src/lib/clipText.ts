/**
 * Shorten display text on a word boundary. Mirrors
 * packages/server/supabase/functions/_shared/text-clip.ts so the console and
 * the server clip the same way.
 */

/** Server-side cap fast-filter applied to `reports.summary` before 2026-10-02 (a hard `.slice(0, 200)`). */
export const LEGACY_SUMMARY_CAP = 200

export function clipAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const budget = Math.max(1, max - 1)
  const head = clean.slice(0, budget)
  const lastSpace = head.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor(budget * 0.6) ? head.slice(0, lastSpace) : head
  return `${cut.replace(/[\s,;:.\-–—]+$/, '')}…`
}

export interface ReportHeading {
  /** What the heading renders: never ends mid-word. */
  text: string
  /** The untruncated text, for the hover title and the expand toggle. */
  full: string
  truncated: boolean
}

/**
 * Heading for a report: the Stage-2 title, else the summary, else the raw
 * description. A summary exactly at the legacy cap was hard-sliced mid-word,
 * so it is re-clipped on a word and the description supplies the full text.
 */
export function reportHeading(report: {
  title?: string | null
  summary?: string | null
  description?: string | null
}): ReportHeading {
  const title = report.title?.trim()
  if (title) return { text: title, full: title, truncated: false }

  const summary = report.summary?.trim()
  const description = report.description?.trim() || ''
  if (summary) {
    const legacyCut = summary.length >= LEGACY_SUMMARY_CAP && !/[.!?…]$/.test(summary)
    if (legacyCut) {
      return {
        text: clipAtWord(summary, LEGACY_SUMMARY_CAP - 1),
        full: description || summary,
        truncated: true,
      }
    }
    return { text: summary, full: summary, truncated: false }
  }

  if (!description) return { text: 'Untitled report', full: 'Untitled report', truncated: false }
  const text = clipAtWord(description, LEGACY_SUMMARY_CAP)
  return { text, full: description, truncated: text !== description.replace(/\s+/g, ' ').trim() }
}
