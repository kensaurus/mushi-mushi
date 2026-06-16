/**
 * FILE: apps/admin/src/lib/paletteNlDetect.ts
 * PURPOSE: Heuristics for when Cmd+K query should trigger console navigate/assist mode.
 */

const QUESTION_STARTERS = [
  'how ',
  'how do',
  'how to',
  'what ',
  'what can',
  'what does',
  'where ',
  'where do',
  'why ',
  'can i',
  'should i',
  'help me',
  'show me',
  'take me',
  'setup',
  'set up',
  'install',
  'connect',
  'triage',
] as const

export function isNavigateQuery(query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  if (q.includes('@page:') || q.startsWith('/howto') || q.startsWith('/goto')) return true
  if (q.endsWith('?')) return true
  if (QUESTION_STARTERS.some((s) => q.startsWith(s))) return true
  const words = q.split(/\s+/).filter(Boolean)
  return words.length >= 5
}

/** Keyword live-search (reports/fixes) is skipped for NL assist and composer tokens. */
export function shouldRunPaletteLiveSearch(
  query: string,
  opts?: { composingMention?: boolean; composingSlash?: boolean },
): boolean {
  const trimmed = query.trim()
  if (trimmed.length < 2) return false
  if (opts?.composingMention || opts?.composingSlash) return false
  if (isNavigateQuery(trimmed)) return false
  return true
}

export const PALETTE_SAMPLE_QUERIES = [
  'How do I triage a fix?',
  'What can I do on this page?',
  'How do I connect GitHub?',
  'Where do I review drafted PRs?',
] as const
