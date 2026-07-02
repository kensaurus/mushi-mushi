/**
 * FILE: apps/admin/src/lib/pdcaBottleneck.ts
 * PURPOSE: Shared PDCA bottleneck chip tokens, human copy, and deep links used
 *          by ProjectsPage, ProjectSwitcher, and header status chrome.
 */

import type { PdcaStageId } from './pdca'
import { CHIP_TONE } from './chipTone'

export const PDCA_BOTTLENECK_TONE: Record<PdcaStageId, string> = {
  plan: CHIP_TONE.infoSubtle,
  do: CHIP_TONE.warnSubtle,
  check: CHIP_TONE.warnSubtle,
  act: CHIP_TONE.dangerSubtle,
}

export const PDCA_BOTTLENECK_DEEP_LINK: Record<PdcaStageId, string> = {
  plan: '/reports?status=new',
  do: '/fixes',
  check: '/judge',
  act: '/integrations/config',
}

const STAGE_LETTER: Record<PdcaStageId, 'P' | 'D' | 'C' | 'A'> = {
  plan: 'P',
  do: 'D',
  check: 'C',
  act: 'A',
}

export function bottleneckStageLetter(stage: PdcaStageId): 'P' | 'D' | 'C' | 'A' {
  return STAGE_LETTER[stage]
}

export interface BottleneckContext {
  stage: PdcaStageId
  label: string | null
  count?: number | null
}

function parseCountFromLabel(label: string | null | undefined): number | null {
  if (!label) return null
  const m = label.match(/^(\d+)\b/)
  return m ? Number(m[1]) : null
}

/** Plain-English headline for alert banners (not PDCA jargon). */
export function bottleneckHumanHeadline(ctx: BottleneckContext): string {
  const count = ctx.count ?? parseCountFromLabel(ctx.label) ?? 1
  switch (ctx.stage) {
    case 'do':
      if (ctx.label?.includes('retry')) {
        return `${count} auto-fix${count === 1 ? '' : 'es'} failed`
      }
      if (ctx.label?.includes('in flight')) {
        return `${count} fix${count === 1 ? '' : 'es'} running now`
      }
      return 'Fix queue needs attention'
    case 'plan':
      return `${count} report${count === 1 ? '' : 's'} waiting to triage`
    case 'check':
      return `${count} classifier vs judge disagreement${count === 1 ? '' : 's'}`
    case 'act':
      return 'Ship step blocked'
    default:
      return ctx.label ?? 'Pipeline needs attention'
  }
}

/** One sentence explaining what the operator should understand. */
export function bottleneckHumanHint(ctx: BottleneckContext): string {
  switch (ctx.stage) {
    case 'do':
      if (ctx.label?.includes('retry')) {
        return 'The fix agent could not finish these runs. Open each failure to read the error, then retry or hand off to Cursor.'
      }
      if (ctx.label?.includes('in flight')) {
        return 'Agents are drafting PRs for these reports. Check back here or open Fixes to watch progress.'
      }
      return 'Something in the fix pipeline needs a nudge.'
    case 'plan':
      return 'These reports landed but have not been classified yet. Triage them so auto-fix can pick them up.'
    case 'check':
      return 'The judge disagreed with how the classifier scored these reports. Review before merging fixes.'
    case 'act':
      return 'A PR or integration step is blocking the ship loop.'
    default:
      return ctx.label ?? 'Open the linked page to clear this bottleneck.'
  }
}

/** Compact label for header/switcher chips (human, not P/D/C/A). */
export function bottleneckChipLabel(ctx: BottleneckContext): string {
  const count = ctx.count ?? parseCountFromLabel(ctx.label) ?? 1
  switch (ctx.stage) {
    case 'do':
      if (ctx.label?.includes('retry')) {
        return count === 1 ? '1 fix failed' : `${count} fixes failed`
      }
      if (ctx.label?.includes('in flight')) {
        return count === 1 ? '1 fixing' : `${count} fixing`
      }
      return 'Fix queue'
    case 'plan':
      return count === 1 ? '1 to triage' : `${count} to triage`
    case 'check':
      return count === 1 ? '1 disagree' : `${count} disagree`
    case 'act':
      return 'Ship blocked'
    default:
      return 'Needs action'
  }
}

/** Primary button label on alert cards. */
export function bottleneckActionLabel(ctx: BottleneckContext): string {
  const count = ctx.count ?? parseCountFromLabel(ctx.label)
  switch (ctx.stage) {
    case 'do':
      if (ctx.label?.includes('retry')) {
        return count && count > 1 ? `Review ${count} failed fixes` : 'Review failed fix'
      }
      return 'Open fix queue'
    case 'plan':
      return count && count > 1 ? `Triage ${count} reports` : 'Triage waiting reports'
    case 'check':
      return 'Review disagreements'
    case 'act':
      return 'Open integrations'
    default:
      return 'Take action'
  }
}

/**
 * Deep link to a PDCA stage scoped to a project. Adds filters when the label
 * implies a subset (failed fixes, new reports, etc.).
 */
export function bottleneckDeepLink(stage: PdcaStageId, projectId: string, label?: string | null): string {
  const base = PDCA_BOTTLENECK_DEEP_LINK[stage]
  const params = new URLSearchParams()
  params.set('project', projectId)
  if (stage === 'do' && label?.includes('retry')) {
    params.set('status', 'failed')
  }
  const merged = new URLSearchParams(base.includes('?') ? base.split('?')[1] : '')
  for (const [key, value] of params.entries()) {
    merged.set(key, value)
  }
  const path = base.split('?')[0]
  const qs = merged.toString()
  return qs ? `${path}?${qs}` : path
}
