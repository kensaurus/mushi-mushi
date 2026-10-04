/**
 * FILE: apps/admin/src/components/fixes/FixRecommendation.tsx
 * PURPOSE: Picks the single most actionable banner for the user given the
 *          current state of fixes/dispatches. Returns null when nothing
 *          interesting is happening — silence is fine.
 *
 * Counts are per report from its current state (lib/fixReportTruth.ts), and
 * the advice for stopped fixes comes from their actual causes — not a fixed
 * list of guesses. Before 2026-10-04 this read "8 recent fix attempts failed"
 * over 4 reports already fixed by merged PRs.
 */

import { RecommendedAction } from '../ui'
import { credentialAdvice, failureCause, failureHeadline, fixCauseLabel, needsAttention, openPrReports } from '../../lib/fixReportTruth'
import { pluralizeWithCount } from '../../lib/format'
import type { DispatchJob, FixAttempt } from './types'

interface Props {
  fixes: FixAttempt[]
  dispatches: DispatchJob[]
}

/** The cause groups behind the still-unfixed reports, most common first, each with its fix. */
function stoppedFixAdvice(fixes: FixAttempt[]): Array<{ cause: string; label: string; count: number; advice: string }> {
  const groups = new Map<string, { count: number; advice: string }>()
  for (const f of fixes) {
    if (!needsAttention(f)) continue
    const cause = failureCause(f)
    const advice = credentialAdvice(f)?.message ?? failureHeadline(f)?.hint ?? 'Open the attempt to read the error.'
    const g = groups.get(cause)
    if (g) g.count += 1
    else groups.set(cause, { count: 1, advice })
  }
  return [...groups.entries()]
    .map(([cause, g]) => ({ cause, label: fixCauseLabel(cause), count: g.count, advice: g.advice }))
    .sort((a, b) => b.count - a.count)
}

export function FixRecommendation({ fixes, dispatches }: Props) {
  const inFlight = dispatches.filter((d) => d.status === 'queued' || d.status === 'running').length
  if (inFlight > 0) {
    return (
      <RecommendedAction
        tone="info"
        title={`${inFlight} fix ${inFlight === 1 ? 'job is' : 'jobs are'} running`}
        description="The LLM agent is generating a structured patch and opening a draft PR. Cards refresh every 5s — no action needed."
      />
    )
  }

  const groups = stoppedFixAdvice(fixes)
  const stopped = groups.reduce((n, g) => n + g.count, 0)
  if (stopped > 0) {
    const top = groups[0]
    const others = groups.slice(1).map((g) => `${g.label} (${g.count})`)
    return (
      <RecommendedAction
        tone="urgent"
        title={`Auto-fix stopped on ${pluralizeWithCount(stopped, 'report')}`}
        description={`Most common cause: ${top.label}${top.count > 1 ? ` (${top.count})` : ''}. ${top.advice}${others.length ? ` Also: ${others.join(', ')}.` : ''}`}
        meta={groups.slice(0, 4).map((g) => ({ label: g.label, value: String(g.count), tone: 'danger' as const }))}
      />
    )
  }

  const open = openPrReports(fixes)
  if (open.length > 0) {
    const firstPr = open[0]
    return (
      <RecommendedAction
        tone="success"
        title={`${open.length} ${open.length === 1 ? 'PR is' : 'PRs are'} ready for review`}
        description="Auto-fix completed and pushed a draft branch. Read the rationale + diff before marking the PR ready — the agent flags low-confidence fixes for extra scrutiny."
        cta={firstPr?.pr_url ? { label: 'Open latest PR', href: firstPr.pr_url } : undefined}
      />
    )
  }

  return null
}
