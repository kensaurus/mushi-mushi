/**
 * FILE: apps/admin/src/lib/intelligenceView.ts
 * PURPOSE: Pure display rules for Home → Weekly insights (round-2 sweep
 *          2026-11-18):
 *            - a digest whose text is only its own title ("Weekly digest —
 *              kensaur.us / Week of 2026-11-02") has no body to show: the
 *              card says so instead of boxing the title under the same title;
 *            - the status dot is amber while the latest summary is over a
 *              week old, not green beside "Summary is 9 days old";
 *            - one date format for a digest's week.
 */

import type { IntelligenceStats } from '../components/intelligence/IntelligenceStatsTypes'

/** A digest is stale after a week, the same rule the server's banner uses. */
export const DIGEST_STALE_DAYS = 7

/** "Week of Nov 2" for an ISO date; null when it does not parse. */
export function formatDigestWeek(iso: string | null | undefined): string | null {
  if (!iso) return null
  // A bare YYYY-MM-DD parses as UTC midnight; read it as that calendar day.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * The digest's markdown without the lines that only name it: headings,
 * "Weekly digest — <app>", "Week of <date>" and "**Label:** value" lines.
 * Empty when nothing else is written.
 */
export function digestBody(md: string | null | undefined): string {
  if (!md) return ''
  const kept = md
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/^#{1,6}\s/.test(t)) return false
      if (/^(mushi mushi\s+)?weekly (bug )?digest\b/i.test(t.replace(/[*_]/g, ''))) return false
      if (/^week of\b/i.test(t.replace(/[*_]/g, ''))) return false
      if (/^\*\*(project|app|week of)[^*]*:\*\*/i.test(t)) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return kept
}

type StatusTone = 'danger' | 'warn' | 'ok' | 'neutral'

/** The Weekly insights status dot: a failed run, a stale summary or findings to review are not green. */
export function insightsTone(
  stats: Pick<IntelligenceStats, 'topPriority' | 'pendingFindings' | 'reportCount' | 'daysSinceLastDigest'>,
): StatusTone {
  if (stats.topPriority === 'job_failed') return 'danger'
  const stale = stats.topPriority === 'stale_digest' || (stats.daysSinceLastDigest != null && stats.daysSinceLastDigest > DIGEST_STALE_DAYS)
  if (stale || stats.pendingFindings > 0) return 'warn'
  return stats.reportCount > 0 ? 'ok' : 'neutral'
}
