/**
 * FILE: apps/admin/src/components/content-quality/contentQualityLead.ts
 * PURPOSE: The Content checks page's lead (owner, 2026-11-19: the page was "No open content
 *          issues · none reported yet" with nothing to press). Nothing is scanned on a
 *          schedule: the app itself sends a note when a piece of AI-written content scores
 *          low, gets flagged or gets bad ratings. So the first step is the request the app
 *          sends, copyable in one click. Pure: no React.
 */

import type { PageStatusMetric, PageStatusTone } from '../ui/page-status'
import type { ContentQualityStats } from './ContentQualityStatsTypes'

/** The request an app sends for one piece of content (POST /v1/content-quality, project API key). */
export function contentIngestRequest(apiBase: string): string {
  const body = {
    content_ref: 'lesson-42',
    content_type: 'lesson_story',
    content_key: 'lesson-42:en',
    reason: 'user_flag',
    flag_count: 3,
    source: 'my-app',
    source_deeplink: 'https://your-app.com/lessons/42',
  }
  return [
    `curl -X POST ${apiBase.replace(/\/$/, '')}/v1/content-quality \\`,
    `  -H "X-Mushi-Api-Key: $MUSHI_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${JSON.stringify(body)}'`,
    '',
    '# reason: low_judge_score (send judge_score 0-1), user_flag (flag_count), low_star_rating (avg_star 0-5) or high_downvote_ratio (downvote_ratio 0-1).',
  ].join('\n')
}

interface ContentLead {
  tone: PageStatusTone
  sentence: string
  metrics: PageStatusMetric[]
  /** `flags` → the list narrowed to what users flagged. */
  next: 'flags' | null
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

/** Null when nothing is open: the page then shows its all-clear line or its first step. */
export function contentLead(stats: ContentQualityStats): ContentLead | null {
  const { openCount: open, userFlagOpenCount: flags, failedRegenCount: failed } = stats
  if (open + failed === 0) return null
  const parts = [
    open > 0 ? `${plural(open, 'piece')} of content ${open === 1 ? 'needs' : 'need'} a look` : null,
    flags > 0 ? `${flags.toLocaleString()} flagged by your users` : null,
    failed > 0 ? `${plural(failed, 'regeneration')} failed` : null,
  ].filter(Boolean)
  const metrics: PageStatusMetric[] = []
  if (open > 0) metrics.push({ label: 'Open', value: open, tone: 'warn' })
  if (flags > 0) metrics.push({ label: 'Flagged by users', value: flags, tone: 'warn', to: '/content?reason=user_flag' })
  if (failed > 0) metrics.push({ label: 'Regeneration failed', value: failed, tone: 'danger' })
  return {
    tone: failed > 0 ? 'danger' : 'warn',
    sentence: `${parts.join(', ')}. Open one to regenerate it, or dismiss the noise in bulk.`,
    metrics,
    next: flags > 0 ? 'flags' : null,
  }
}
