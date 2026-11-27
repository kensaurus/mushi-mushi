/**
 * FILE: packages/server/supabase/functions/_shared/ux-score-cache.ts
 * PURPOSE: Plan 025 P8 / ADR 0072: score a scorecard page only when what it
 *          shows changed. Pure apart from Web Crypto (Deno and Node 22).
 *
 * The cache key is what the model would be shown, minus the numbers that move
 * on every load:
 *   - the prompt version (a rubric change re-scores every page);
 *   - the viewport;
 *   - the page's text facts: title, breadcrumb, headings, visible text,
 *     controls, axe counts and rules, sideways scroll, whether the console
 *     had errors;
 *   - a perceptual hash of the settled screenshot (the CLI's 64-bit dHash),
 *     so a moved layout or a new colour is a new key.
 * Left out: settle time, layout shift, the early text and the error count.
 * Those vary run to run, and the two caps they feed are re-applied to the
 * reused score from today's facts (reuseScore), so a slower page still loses
 * its speed score.
 *
 * Text is in the key because a 9×8 dHash does not see copy change ("Not run
 * yet" → "7 of 7 passed"), and truthfulness and copy are scored dimensions.
 * No shot hash, no key: an older CLI keeps scoring every page.
 */

import {
  accessibilityCap,
  evidenceSeenIn,
  overallScore,
  performanceCap,
  UX_DIMENSIONS,
  UX_SCORECARD_PROMPT_VERSION,
  type UxDimension,
  type UxPageFacts,
  type UxPageScore,
} from './ux-scorecard.ts'

/** A reused verdict is at most this old; a newer model or rubric gets its turn. */
export const UX_SCORE_CACHE_DAYS = 30
const SHOT_HASH_RE = /^[0-9a-f]{16}$/

/** Pure: the canonical text the key hashes. Exported for tests. */
export function scoreCacheInput(facts: UxPageFacts, shotHash: string, promptVersion = UX_SCORECARD_PROMPT_VERSION): string {
  const axe = facts.axe ? { c: facts.axe.critical, s: facts.axe.serious, r: [...facts.axe.rules].sort() } : null
  return JSON.stringify([
    promptVersion,
    `${facts.viewport.width}x${facts.viewport.height}`,
    facts.path,
    facts.title,
    facts.breadcrumb ?? '',
    facts.headings,
    facts.text,
    facts.controls,
    axe,
    facts.overflowX,
    facts.consoleErrors > 0,
    shotHash,
  ])
}

/** sha256 hex of the page's cache input, or null when the CLI sent no usable shot hash. */
export async function scoreCacheKey(facts: UxPageFacts, shotHash: unknown, promptVersion = UX_SCORECARD_PROMPT_VERSION): Promise<string | null> {
  if (typeof shotHash !== 'string' || !SHOT_HASH_RE.test(shotHash)) return null
  const bytes = new TextEncoder().encode(scoreCacheInput(facts, shotHash, promptVersion))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Pure: an earlier verdict for the same capture, re-read against today's
 * facts. The model's own numbers (`capped[d]` where a fact had capped it)
 * are capped again by today's settle time and axe results; evidence is
 * checked against today's text. Null when the stored verdict is not a
 * scorecard verdict of this prompt version.
 */
export function reuseScore(cached: unknown, facts: UxPageFacts, promptVersion = UX_SCORECARD_PROMPT_VERSION): UxPageScore | null {
  if (!cached || typeof cached !== 'object') return null
  const c = cached as Partial<UxPageScore>
  if (c.promptVersion !== promptVersion || !c.scores || typeof c.scores !== 'object') return null
  const raw = {} as Record<UxDimension, number>
  for (const d of UX_DIMENSIONS) {
    const n = Number(c.capped?.[d] ?? c.scores[d])
    if (!Number.isFinite(n)) return null
    raw[d] = Math.max(1, Math.min(10, Math.round(n)))
  }
  const scores = { ...raw }
  const capped: Partial<Record<UxDimension, number>> = {}
  const caps: Partial<Record<UxDimension, number>> = { performance: performanceCap(facts.settleMs), accessibility: accessibilityCap(facts) }
  for (const [d, cap] of Object.entries(caps) as Array<[UxDimension, number]>) {
    if (scores[d] > cap) {
      capped[d] = scores[d]
      scores[d] = cap
    }
  }
  const issues = (Array.isArray(c.issues) ? c.issues : []).map((i) => ({ ...i, evidenceSeen: evidenceSeenIn(String(i.evidence ?? ''), facts) }))
  return {
    key: facts.key,
    page: typeof c.page === 'string' ? c.page : '',
    scores,
    why: c.why ?? {},
    capped,
    overall: overallScore(scores),
    issues,
    claims: Array.isArray(c.claims) ? c.claims : [],
    promptVersion,
  }
}

/** Pure: the cutoff a reusable verdict must be newer than. */
export function scoreCacheCutoff(now: Date, days = UX_SCORE_CACHE_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

export interface RunCostRow {
  cost_usd: number | string | null
  judge_cached: boolean | null
  score: number | null
}

/** Pure: a scorecard run's cost from its pages: total USD, model calls, reuses, unpriced calls. */
export function runCostFromSurfaces(rows: readonly RunCostRow[]): { cost_usd: number; cost: { judged: number; cached: number; unpriced: number } } {
  let usd = 0
  let judged = 0
  let cached = 0
  let unpriced = 0
  for (const r of rows) {
    if (r.score == null) continue
    if (r.judge_cached) {
      cached++
      continue
    }
    judged++
    const n = r.cost_usd == null ? NaN : Number(r.cost_usd)
    if (Number.isFinite(n)) usd += n
    else unpriced++
  }
  return { cost_usd: Math.round(usd * 1e6) / 1e6, cost: { judged, cached, unpriced } }
}
