/**
 * FILE: apps/admin/src/lib/checkCardStatus.ts
 * PURPOSE: Status line for each card on /checks.
 *
 * A card may say Pass only when a finished run was read and it found nothing.
 * Zero sidebar counts are not a run. A slice that could not be read is
 * Status unavailable, never Failed. Not run yet means nothing has run.
 *
 * States: Not set up, Not run yet, Status unavailable, Pass, and a result
 * (N findings or Failed). Pass and a result include the last run time when
 * one was stored. Content issues and lesson reinforcements are not check
 * runs, so those cards never say Pass or Last run.
 */

import { relativeTime } from './setupGuideSteps'

export type CheckCardState = 'not_set_up' | 'not_checked' | 'unavailable' | 'pass' | 'findings' | 'failed'

export interface CheckCardView {
  state: CheckCardState
  chip: string
  detail: string | null
  setupTo: string | null
  tone: 'neutral' | 'okSubtle' | 'warnSubtle' | 'dangerSubtle'
}

/** One recipe / design / CI element, already reduced to the fields the card needs. */
export interface ObservedElement {
  state: string
  lastCheckedAt: string | null
  findingsCount: number
  setupTo: string
}

export interface CheckCardsInput {
  /** False while nav-meta has not answered. Slice-backed cards stay blank. */
  navReady: boolean
  qa: {
    totalStories?: number
    failingStories?: number
    pendingRuns?: number
    lastRunAt?: string | null
    topPriority?: string
  } | null
  health: {
    cronErrorCount?: number
    redCount?: number
    amberCount?: number
    lastLlmCallAt?: string | null
    lastCronAt?: string | null
    topPriority?: string
  } | null
  audit: {
    errorCount?: number
    warnCount?: number
    failedGateCount?: number
    lastRunAt?: string | null
    topPriority?: string
  } | null
  inventory: {
    hasInventory?: boolean
    openFindings?: number
    regressed?: number
    lastGateRunAt?: string | null
    topPriority?: string
  } | null
  content: {
    openCount?: number
    failedRegenCount?: number
    needsAttentionCount?: number
    latestAt?: string | null
    topPriority?: string
  } | null
  lessons: {
    criticalLessons?: number
    readyToPromote?: number
    lastLessonReinforcedAt?: string | null
    topPriority?: string
  } | null
  prompts: {
    untestedAbCount?: number
    promoteReadyCount?: number
    topPriority?: string
  } | null
  judge: {
    lastEvalAt?: string | null
    disagreementCount?: number
    totalEvaluations?: number
    topPriority?: string
  } | null
  /** loading: recipe/design/CI cards stay blank. error: those three read Status unavailable. */
  recipePhase: 'loading' | 'error' | 'ready'
  recipeElements: ObservedElement[]
  design: ObservedElement | null
  ci: ObservedElement | null
}

const FRESH_MS = 48 * 60 * 60 * 1000

const NOT_SET_UP: Omit<CheckCardView, 'setupTo'> = {
  state: 'not_set_up',
  chip: 'Not set up',
  detail: null,
  tone: 'neutral',
}

const NOT_CHECKED: CheckCardView = {
  state: 'not_checked',
  chip: 'Not run yet',
  detail: null,
  setupTo: null,
  tone: 'neutral',
}

/** The check's data could not be read. This is not a failed run. */
const UNAVAILABLE: CheckCardView = {
  state: 'unavailable',
  chip: 'Status unavailable',
  detail: null,
  setupTo: null,
  tone: 'neutral',
}

const FAILED: CheckCardView = {
  state: 'failed',
  chip: 'Failed',
  detail: null,
  setupTo: null,
  tone: 'dangerSubtle',
}

function ran(iso: string | null | undefined, now: number): string | null {
  const label = relativeTime(iso, now)
  return label ? `Last run ${label}` : null
}

function withTime(view: CheckCardView, iso: string | null | undefined, now: number): CheckCardView {
  const detail = ran(iso, now)
  return detail ? { ...view, detail } : view
}

function notSetUp(setupTo: string): CheckCardView {
  return { ...NOT_SET_UP, setupTo }
}

function findings(count: number, iso: string | null | undefined, now: number): CheckCardView {
  const n = Math.max(1, count)
  return withTime(
    {
      state: 'findings',
      chip: `${n} finding${n === 1 ? '' : 's'}`,
      detail: null,
      setupTo: null,
      tone: 'warnSubtle',
    },
    iso,
    now,
  )
}

function pass(iso: string, now: number): CheckCardView {
  const detail = ran(iso, now)
  if (!detail) return NOT_CHECKED
  return { state: 'pass', chip: 'Pass', detail, setupTo: null, tone: 'okSubtle' }
}

function failed(iso: string | null | undefined, now: number): CheckCardView {
  return withTime(FAILED, iso, now)
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? now - t : null
}

function fromQa(qa: CheckCardsInput['qa'], now: number): CheckCardView {
  if (!qa) return UNAVAILABLE
  const stories = qa.totalStories ?? 0
  const failing = qa.failingStories ?? 0
  if (qa.topPriority === 'no_stories' || stories === 0) return notSetUp('/qa-coverage')
  if (qa.topPriority === 'disabled_all') return notSetUp('/qa-coverage')
  if (failing > 0) return findings(failing, qa.lastRunAt, now)
  if (qa.topPriority === 'healthy' && qa.lastRunAt && (qa.pendingRuns ?? 0) === 0) return pass(qa.lastRunAt, now)
  return withTime(NOT_CHECKED, qa.lastRunAt, now)
}

function fromHealth(health: CheckCardsInput['health'], now: number): CheckCardView {
  if (!health) return UNAVAILABLE
  const at = health.lastCronAt ?? health.lastLlmCallAt ?? null
  if (health.topPriority === 'no_project') return NOT_CHECKED
  if ((health.cronErrorCount ?? 0) > 0 || health.topPriority === 'cron_error') return failed(at, now)
  if ((health.redCount ?? 0) > 0 || health.topPriority === 'llm_errors') {
    return findings(health.redCount || 1, health.lastLlmCallAt ?? at, now)
  }
  if ((health.amberCount ?? 0) > 0 || health.topPriority === 'cron_warn' || health.topPriority === 'cron_stale' || health.topPriority === 'llm_fallbacks') {
    return findings(health.amberCount || 1, at, now)
  }
  if (health.topPriority === 'healthy' && at) return pass(at, now)
  return withTime(NOT_CHECKED, at, now)
}

function fromAudit(audit: CheckCardsInput['audit'], now: number): CheckCardView {
  if (!audit) return UNAVAILABLE
  if (audit.topPriority === 'unknown') return UNAVAILABLE
  if (audit.topPriority === 'no_project') return NOT_CHECKED
  if ((audit.failedGateCount ?? 0) > 0) return failed(audit.lastRunAt, now)
  if ((audit.errorCount ?? 0) > 0) return findings(audit.errorCount ?? 0, audit.lastRunAt, now)
  if ((audit.warnCount ?? 0) > 0) return findings(audit.warnCount ?? 0, audit.lastRunAt, now)
  if (audit.topPriority === 'healthy' && audit.lastRunAt) return pass(audit.lastRunAt, now)
  return withTime(NOT_CHECKED, audit.lastRunAt, now)
}

function fromInventory(inv: CheckCardsInput['inventory'], now: number): CheckCardView {
  if (!inv) return UNAVAILABLE
  if (inv.hasInventory === false) return notSetUp('/inventory')
  const n = (inv.regressed ?? 0) + (inv.openFindings ?? 0)
  if (n > 0) return findings(n, inv.lastGateRunAt, now)
  if (inv.topPriority === 'clear' && inv.lastGateRunAt) return pass(inv.lastGateRunAt, now)
  return withTime(NOT_CHECKED, inv.lastGateRunAt, now)
}

function fromContent(content: CheckCardsInput['content']): CheckCardView {
  if (!content) return UNAVAILABLE
  // latestAt is the newest issue edit, not a scan. Open issues and a failed
  // regen are still real; neither time is a check run, so no Pass or Last run.
  if ((content.failedRegenCount ?? 0) > 0) return FAILED
  const open = content.needsAttentionCount ?? content.openCount ?? 0
  if (open > 0) return findings(open, null, 0)
  return NOT_CHECKED
}

function fromLessons(lessons: CheckCardsInput['lessons']): CheckCardView {
  if (!lessons) return UNAVAILABLE
  if (lessons.topPriority === 'no_data') return notSetUp('/lessons')
  const n = (lessons.criticalLessons ?? 0) + (lessons.readyToPromote ?? 0)
  if (n > 0) return findings(n, null, 0)
  // lastLessonReinforcedAt is when a lesson was reinforced, not a check run.
  return NOT_CHECKED
}

function fromPrompts(prompts: CheckCardsInput['prompts']): CheckCardView {
  if (!prompts) return UNAVAILABLE
  if (prompts.topPriority === 'no_project') return NOT_CHECKED
  if (prompts.topPriority === 'no_dataset') return notSetUp('/judge')
  const n = (prompts.untestedAbCount ?? 0) + (prompts.promoteReadyCount ?? 0)
  if (n > 0) return findings(n, null, 0)
  // Prompt lab stats have no run timestamp, so a quiet lab is not a pass.
  return NOT_CHECKED
}

function fromJudge(judge: CheckCardsInput['judge'], now: number): CheckCardView {
  if (!judge) return UNAVAILABLE
  const evals = judge.totalEvaluations ?? 0
  if (judge.topPriority === 'no_project') return NOT_CHECKED
  if (judge.topPriority === 'no_evals' || evals === 0) return notSetUp('/judge')
  const disagreements = judge.disagreementCount ?? 0
  if (disagreements > 0) return findings(disagreements, judge.lastEvalAt, now)
  if (judge.topPriority === 'low_score' || judge.topPriority === 'drifting') return failed(judge.lastEvalAt, now)
  const age = ageMs(judge.lastEvalAt, now)
  if (judge.lastEvalAt && age != null && age <= FRESH_MS && judge.topPriority === 'healthy') return pass(judge.lastEvalAt, now)
  return withTime(NOT_CHECKED, judge.lastEvalAt, now)
}

const RANK: Record<string, number> = { error: 5, drift: 4, unknown: 3, not_connected: 2, ok: 1 }

function newest(elements: ObservedElement[]): string | null {
  let best: string | null = null
  for (const el of elements) {
    if (!el.lastCheckedAt) continue
    if (best === null || el.lastCheckedAt > best) best = el.lastCheckedAt
  }
  return best
}

/** Recipe, design, or CI: the element's own last check, never a pass without a time. */
export function statusFromElements(elements: ObservedElement[], fallbackSetup: string, now: number): CheckCardView {
  if (elements.length === 0) return NOT_CHECKED
  if (elements.every((el) => el.state === 'not_connected')) return notSetUp(elements[0]?.setupTo || fallbackSetup)
  let worst = elements[0]!
  for (const el of elements) {
    const rank = RANK[el.state] ?? RANK.unknown
    const worstRank = RANK[worst.state] ?? RANK.unknown
    if (rank > worstRank) worst = el
  }
  const at = newest(elements.filter((el) => (RANK[el.state] ?? 0) === (RANK[worst.state] ?? 0))) ?? newest(elements)
  if (worst.state === 'error') return failed(at, now)
  if (worst.state === 'drift') {
    const n = elements.reduce((sum, el) => sum + (el.state === 'drift' || el.state === 'error' ? el.findingsCount : 0), 0)
    return findings(n, at, now)
  }
  if (worst.state === 'not_connected') return notSetUp(worst.setupTo || fallbackSetup)
  if (worst.state === 'ok') {
    const ok = elements.filter((el) => el.state === 'ok')
    const when = newest(ok)
    if (when && ok.every((el) => el.lastCheckedAt) && ok.every((el) => el.findingsCount === 0)) return pass(when, now)
    return withTime(NOT_CHECKED, when, now)
  }
  return withTime(NOT_CHECKED, at, now)
}

/** One view per checks-page path. Null while that card's read has not finished. */
export function buildCheckCardViews(input: CheckCardsInput, now = Date.now()): Record<string, CheckCardView | null> {
  const pending = input.recipePhase === 'loading'
  const recipeUnread = input.recipePhase === 'error'
  const slice = <T>(value: T | null, map: (value: T | null) => CheckCardView): CheckCardView | null =>
    input.navReady ? map(value) : null
  return {
    '/qa-coverage': slice(input.qa, (qa) => fromQa(qa, now)),
    '/health': slice(input.health, (health) => fromHealth(health, now)),
    '/ci': pending ? null : recipeUnread ? UNAVAILABLE : statusFromElements(input.ci ? [input.ci] : [], '/ci', now),
    '/fullstack-audit': slice(input.audit, (audit) => fromAudit(audit, now)),
    '/inventory': slice(input.inventory, (inv) => fromInventory(inv, now)),
    '/recipe': pending ? null : recipeUnread ? UNAVAILABLE : statusFromElements(input.recipeElements, '/recipe', now),
    '/design': pending ? null : recipeUnread ? UNAVAILABLE : statusFromElements(input.design ? [input.design] : [], '/design', now),
    '/content': slice(input.content, (content) => fromContent(content)),
    '/judge': slice(input.judge, (judge) => fromJudge(judge, now)),
    '/lessons': slice(input.lessons, (lessons) => fromLessons(lessons)),
    '/prompt-lab': slice(input.prompts, (prompts) => fromPrompts(prompts)),
  }
}
