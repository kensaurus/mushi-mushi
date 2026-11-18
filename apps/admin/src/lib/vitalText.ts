/**
 * FILE: apps/admin/src/lib/vitalText.ts
 * PURPOSE: Find Web Vitals written as words in text ("LCP of 7444 ms",
 *          "LCP 6408ms", "Poor INP: 432.0", "CLS 0.12") so the console can
 *          show each one as a graded badge (components/signal/VitalBadge)
 *          instead of a sentence (owner, 2026-11-18). Most of these arrive in
 *          report titles and summaries written by the server or the
 *          classifier, so the text is parsed, not changed at the source.
 *
 *          Units: CLS has none; the others are milliseconds, or seconds when
 *          followed by "s" or "seconds" ("7.4 s" is 7400 ms).
 */
import { parseVitalName, type VitalName } from '../components/signal/VitalBadge'

export type VitalPart = string | { name: VitalName; value: number; raw: string }

// Name, an optional joiner ("of", ":", "=", "is", "was"), the number, an optional unit.
const VITAL_RE = /\b(LCP|INP|CLS|FCP|TTFB|FID)\b(?:\s*(?:of|is|was|=|:))?\s*(\d+(?:\.\d+)?)(?:\s*(ms|s|secs?|seconds?)\b)?/gi

/** The text split into plain runs and vitals, in order. No vitals: one string. */
export function splitVitalText(text: string): VitalPart[] {
  const parts: VitalPart[] = []
  let last = 0
  for (const m of text.matchAll(VITAL_RE)) {
    const name = parseVitalName(m[1])
    if (!name) continue
    const n = Number(m[2])
    if (!Number.isFinite(n)) continue
    const value = name === 'CLS' ? n : m[3] && m[3].toLowerCase() !== 'ms' ? n * 1000 : n
    const at = m.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    parts.push({ name, value, raw: m[0] })
    last = at + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : [text]
}
