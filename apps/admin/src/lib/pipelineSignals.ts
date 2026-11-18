/**
 * FILE: apps/admin/src/lib/pipelineSignals.ts
 * PURPOSE: /pipeline as signals (2026-11-18). Six of eight stages used to be pink, so the
 *          colour said nothing. These pure rules decide what earns a colour and a picture:
 *
 *  - stageTones: only the jam takes a colour. The stage holding the most stuck work that
 *    needs a person is the bottleneck (▲ red); another stage is ◆ amber only when it holds
 *    at least half as much. Triaged is never coloured: its "stuck" items are the backlog
 *    waiting for a fix, not a person's to-do (owner's fresh-user review, 2026-11-16).
 *    Every other stage prints its stuck number in neutral ink.
 *  - stuckAges: the age bar for stuck work, [0–3 d, 3–7 d, 7–30 d, 30 d+], from the server's
 *    per-group `ages` (counted before the item list is cut) or, on an older server or a group
 *    built without them, from the listed items. "Need you" leaves the backlog out, so its
 *    total matches the status line's "Need you".
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

/** Stuck work by age: what needs a person, and the backlog waiting for a fix. */
export function stuckAges(stages: readonly PipelineStage[], now: number): { needYou: AgeBuckets; waiting: AgeBuckets } {
  let needYou: AgeBuckets = [0, 0, 0, 0]
  let waiting: AgeBuckets = [0, 0, 0, 0]
  for (const s of stages) {
    for (const g of s.groups) {
      if (g.tone !== 'stuck') continue
      const buckets = Array.isArray(g.ages) && g.ages.length === 4 ? g.ages : bucketItems(g.items, now)
      if (s.id === 'triaged') waiting = add(waiting, buckets)
      else needYou = add(needYou, buckets)
    }
  }
  return { needYou, waiting }
}

/** The colour each stage earns: the bottleneck danger, a near-equal second warn, the rest none. */
export function stageTones(stages: readonly PipelineStage[]): Partial<Record<PipelineStage['id'], SignalTone>> {
  const counted = stages.filter((s) => s.id !== 'triaged' && s.stuck > 0)
  const worst = Math.max(0, ...counted.map((s) => s.stuck))
  const out: Partial<Record<PipelineStage['id'], SignalTone>> = {}
  if (worst === 0) return out
  let bottleneck = false
  for (const s of [...counted].sort((a, b) => b.stuck - a.stuck)) {
    if (!bottleneck) {
      out[s.id] = 'danger'
      bottleneck = true
    } else if (s.stuck * 2 >= worst) {
      out[s.id] = 'warn'
    }
  }
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
