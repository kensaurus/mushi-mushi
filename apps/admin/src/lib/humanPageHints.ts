/**
 * FILE: apps/admin/src/lib/humanPageHints.ts
 * PURPOSE: Plain-language hints + CTA labels for page status banners when the
 *          backend omits topPriorityLabel or for client-side fallbacks.
 */

import type { PdcaStageId } from './pdca'
import {
  bottleneckActionLabel,
  bottleneckHumanHeadline,
  bottleneckHumanHint,
  type BottleneckContext,
} from './pdcaBottleneck'

export function scopedHref(base: string, projectId: string | null | undefined): string {
  if (!projectId) return base
  const [path, qs = ''] = base.split('?')
  const params = new URLSearchParams(qs)
  params.set('project', projectId)
  const merged = params.toString()
  return merged ? `${path}?${merged}` : path
}

export function fixesFailedHint(count: number): string {
  return count === 1
    ? 'The fix agent could not finish this run. Open it to read the error, then retry or hand off to Cursor.'
    : 'The fix agent could not finish these runs. Open each failure to read the error, then retry or hand off to Cursor.'
}

export function fixesFailedAction(count: number): string {
  return count === 1 ? 'Review failed fix' : `Review ${count} failed fixes`
}

export function triageBacklogHint(count: number): string {
  return count === 1
    ? 'This report has been waiting over an hour. Triage it so auto-fix can pick it up.'
    : 'These reports have been waiting over an hour. Triage the oldest first so auto-fix can pick them up.'
}

export function judgeDisagreementHint(ratePct: number): string {
  return `The judge disagreed with the classifier on ${ratePct}% of recent grades. Review mismatches before merging fixes.`
}

export function integrationIssuesHint(count: number): string {
  return count === 1
    ? 'A GitHub, webhook, or Sentry connection is failing — fixes may not land until this is green.'
    : `${count} integrations are failing health checks — fixes may not land until connections recover.`
}

export function llmErrorsHint(ratePct: number): string {
  return `${ratePct}% of AI calls failed recently. Check your API keys in Settings or inspect the failing model on the LLM tab.`
}

export function cronErrorsHint(count: number): string {
  return count === 1
    ? 'A scheduled background job failed. Open Cron to see which job broke and when it last ran.'
    : `${count} scheduled jobs failed. Open Cron to see which jobs broke and when they last ran.`
}

export function qaFailingHint(count: number): string {
  return count === 1
    ? 'One user-story test is failing on schedule. Open the run to see screenshots and assertion errors.'
    : `${count} user-story tests are failing. Open the failing runs to see screenshots and assertion errors.`
}

export function deadLetterHint(count: number): string {
  return count === 1
    ? 'One report hit the dead-letter queue after retries were exhausted. Inspect before replaying.'
    : `${count} reports hit the dead-letter queue. Inspect each before replaying — they will not retry automatically.`
}

export function bottleneckFromSnapshot(ctx: BottleneckContext & { projectId?: string | null }) {
  return {
    headline: bottleneckHumanHeadline(ctx),
    hint: bottleneckHumanHint(ctx),
    actionLabel: bottleneckActionLabel(ctx),
  }
}

export type { BottleneckContext, PdcaStageId }
