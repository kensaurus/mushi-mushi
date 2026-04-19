/**
 * FILE: apps/admin/src/components/fixes/FixRecommendation.tsx
 * PURPOSE: Picks the single most actionable banner for the user given the
 *          current state of fixes/dispatches. Returns null when nothing
 *          interesting is happening — silence is fine.
 */

import { RecommendedAction } from '../ui'
import type { DispatchJob, FixAttempt } from './types'

interface Props {
  fixes: FixAttempt[]
  dispatches: DispatchJob[]
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

  const recentFailed = fixes.filter((f) => f.status === 'failed').length
  if (recentFailed >= 3) {
    return (
      <RecommendedAction
        tone="urgent"
        title={`${recentFailed} recent fix attempts failed`}
        description="A pattern of failures usually means a brittle agent prompt, missing GitHub credentials, or an unsupported bug category. Open the failed cards and click Langfuse to see the raw LLM output."
      />
    )
  }

  const openPRs = fixes.filter((f) => f.pr_url && f.status === 'completed').length
  if (openPRs > 0) {
    const firstPr = fixes.find((f) => f.pr_url && f.status === 'completed')
    return (
      <RecommendedAction
        tone="success"
        title={`${openPRs} ${openPRs === 1 ? 'PR is' : 'PRs are'} ready for review`}
        description="Auto-fix completed and pushed a draft branch. Read the rationale + diff before marking the PR ready — the agent flags low-confidence fixes for extra scrutiny."
        cta={firstPr?.pr_url ? { label: 'Open latest PR', href: firstPr.pr_url } : undefined}
      />
    )
  }

  return null
}
