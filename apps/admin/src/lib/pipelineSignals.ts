/**
 * FILE: apps/admin/src/lib/pipelineSignals.ts
 * PURPOSE: /pipeline as signals (2026-11-18). Six of eight stages used to be pink, so the
 *          colour said nothing. These pure rules decide what earns a colour and a picture:
 *
 *  - stageTones: only the jam takes a colour. The stage holding the most stuck work that
 *    needs a person is the bottleneck (▲ red; the earlier stage wins a tie); at most ONE
 *    runner-up is ◆ amber, and only when it holds at least half as much, so single-digit
 *    counts never paint most of the bar again. Triaged is never coloured: its "stuck" items are the backlog
 *    waiting for a fix, not a person's to-do (owner's fresh-user review, 2026-11-16).
 *    Every other stage prints its stuck number in neutral ink.
 *  - stuckAges: the age bar for stuck work, [0–3 d, 3–7 d, 7–30 d, 30 d+], from the server's
 *    per-group `ages` (counted before the item list is cut) or, on an older server or a group
 *    built without them, from the listed items. A cut list's rest (the 765-report backlog on a
 *    server without `ages`, preview of #1166) is counted apart as `unlisted`, never as "no time
 *    in a stage". Intake rejections (one item per app, counting reports) have no time in a
 *    stage: their count is `unaged` instead of being bucketed wrong. "Need you" leaves the
 *    backlog out, so buckets + unaged + unlisted match the status line's "Need you".
 *  - primaryAction: each group or item gets ONE button; the rest go in a "More" menu. The
 *    primary is the first action the server would take for at least one item that does not
 *    close or remove anything; closing is never the one-click default.
 */

import type { SignalTone } from '../components/signal/StatusGlyph'
import { actionableIds, type PipelineAction, type PipelineGroup, type PipelineItem, type PipelineStage } from './pipeline'

export type AgeBuckets = [number, number, number, number]

/** Bar segment names, in order. */
export const AGE_BUCKET_LABELS = ['0–3 d', '3–7 d', '7–30 d', '30 d+'] as const

const DAY = 86_400_000

/** Bucket listed items by time in stage (the fallback when a group has no `ages`). */
function bucketItems(items: readonly Pick<PipelineItem, 'since'>[], now: number): AgeBuckets {
  const out: AgeBuckets = [0, 0, 0, 0]
  for (const i of items) {
    const t = Date.parse(i.since)
    const age = Number.isFinite(t) ? now - t : 0
    out[age < 3 * DAY ? 0 : age < 7 * DAY ? 1 : age < 30 * DAY ? 2 : 3]++
  }
  return out
}

function add(a: AgeBuckets, b: readonly number[]): AgeBuckets {
  return [a[0] + (b[0] ?? 0), a[1] + (b[1] ?? 0), a[2] + (b[2] ?? 0), a[3] + (b[3] ?? 0)]
}

export interface StuckAges {
  needYou: AgeBuckets
  waiting: AgeBuckets
  /** Stuck items with no time in a stage (intake rejections), counted apart. */
  unaged: { needYou: number; waiting: number }
  /**
   * Items past a cut list (the server lists the oldest 100) from a server that sent no `ages`:
   * each is no older than the newest listed one, but its bucket is unknown, so it is counted
   * apart instead of as "no time in a stage". Zero once the server sends `ages`.
   */
  unlisted: { needYou: number; waiting: number }
}

/** The intake group lists one item per app while it counts reports: its items carry no time in a stage. */
const NO_TIME_IN_STAGE = new Set(['intake_rejected'])

/** Stuck work by age: what needs a person, and the backlog waiting for a fix. */
export function stuckAges(stages: readonly PipelineStage[], now: number): StuckAges {
  let needYou: AgeBuckets = [0, 0, 0, 0]
  let waiting: AgeBuckets = [0, 0, 0, 0]
  const unaged = { needYou: 0, waiting: 0 }
  const unlisted = { needYou: 0, waiting: 0 }
  for (const s of stages) {
    const side = s.id === 'triaged' ? 'waiting' : 'needYou'
    for (const g of s.groups) {
      if (g.tone !== 'stuck') continue
      let buckets: readonly number[]
      if (Array.isArray(g.ages) && g.ages.length === 4) {
        buckets = g.ages
      } else if (NO_TIME_IN_STAGE.has(g.id) || g.items.length === 0) {
        unaged[side] += g.count
        continue
      } else {
        // Listed items oldest first (the server sorts before it cuts): bucket them, count the rest apart.
        buckets = bucketItems(g.items, now)
        unlisted[side] += Math.max(0, g.count - g.items.length)
      }
      if (side === 'waiting') waiting = add(waiting, buckets)
      else needYou = add(needYou, buckets)
    }
  }
  return { needYou, waiting, unaged, unlisted }
}

/**
 * Every stuck group that needs a person, biggest first: the rule Home's "Needs you" uses
 * (server `_shared/project-home.ts` buildNeedsYou: tone stuck, count > 0), so /home, /pipeline
 * and /inbox count the same items. It includes the triaged backlog's stuck group ("triaged over
 * 3 days ago, no fix started"): Home listed it under Needs you while /pipeline said "Nothing
 * needs you now" (round-2 review, 2026-11-18).
 */
export function needsYouGroups(stages: readonly PipelineStage[]): PipelineGroup[] {
  return stages.flatMap((s) => s.groups.filter((g) => g.tone === 'stuck' && g.count > 0)).sort((a, b) => b.count - a.count)
}

/** How many items need a person: the sum of `needsYouGroups`, and how many of them failed (not the waiting backlog). */
export function needsYouCount(stages: readonly PipelineStage[]): { total: number; backlog: number; failing: number } {
  let total = 0
  let backlog = 0
  for (const g of needsYouGroups(stages)) {
    total += g.count
    if (g.stage === 'triaged') backlog += g.count
  }
  return { total, backlog, failing: total - backlog }
}

/**
 * The age bar as one "Need you" row that adds up to `needsYouCount().total`: the backlog's
 * buckets join it, so the bar, the status line and Home never give three different counts
 * (and the backlog row's impossible "0–3 d 0" bucket, on items stuck over 3 days, is gone).
 */
export function needYouAges(ages: StuckAges): StuckAges {
  return {
    needYou: add(ages.needYou, ages.waiting),
    waiting: [0, 0, 0, 0],
    unaged: { needYou: ages.unaged.needYou + ages.unaged.waiting, waiting: 0 },
    unlisted: { needYou: ages.unlisted.needYou + ages.unlisted.waiting, waiting: 0 },
  }
}

/** The colour each stage earns: the bottleneck danger, a near-equal second warn, the rest none. */
export function stageTones(stages: readonly PipelineStage[]): Partial<Record<PipelineStage['id'], SignalTone>> {
  const counted = stages.filter((s) => s.id !== 'triaged' && s.stuck > 0)
  const worst = Math.max(0, ...counted.map((s) => s.stuck))
  const out: Partial<Record<PipelineStage['id'], SignalTone>> = {}
  if (worst === 0) return out
  const [first, second] = [...counted].sort((a, b) => b.stuck - a.stuck)
  if (first) out[first.id] = 'danger'
  if (second && second.stuck * 2 >= worst) out[second.id] = 'warn'
  return out
}

/** Actions that close or remove something: never the one-click default. */
const CLOSING: ReadonlySet<PipelineAction> = new Set(['close', 'dismiss', 'remove'])

/**
 * The one action to show as a button, from the actions a group or item offers (already
 * filtered to the ones its items can be asked for): the first that can run and closes
 * nothing; else the first that closes nothing (shown disabled with its reason); else the
 * first that can run; else the first.
 */
export function primaryAction(actions: readonly PipelineAction[], items: readonly PipelineItem[]): PipelineAction | null {
  const open = actions.filter((a) => !CLOSING.has(a))
  const runs = (a: PipelineAction) => actionableIds(items, a).length > 0
  return open.find(runs) ?? open[0] ?? actions.find(runs) ?? actions[0] ?? null
}

/** The actions a group's items can be asked for at all: report actions need a report, the rest a PR. */
export function offeredActions(actions: readonly PipelineAction[], items: readonly PipelineItem[]): PipelineAction[] {
  return actions.filter((a) => items.some((i) => (a === 'dismiss' || a === 'mark_fixed' || a === 'requeue' ? i.reportId : i.prUrl)))
}

/** The status line's action for a group: its primary, only when the server would take it. */
export function groupPrimary(group: Pick<PipelineGroup, 'actions' | 'items'>): { action: PipelineAction; ids: string[] } | null {
  const action = primaryAction(offeredActions(group.actions, group.items), group.items)
  if (!action) return null
  const ids = actionableIds(group.items, action)
  return ids.length > 0 ? { action, ids } : null
}
