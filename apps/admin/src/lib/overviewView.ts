/**
 * FILE: apps/admin/src/lib/overviewView.ts
 * PURPOSE: Home → Overview card states: which state a project card is in,
 *          its badge word and colour, and the order cards sort in. Pure, so
 *          the page's states are tested without rendering it.
 */

import type { BadgeTone } from '../components/ui'
import { heartbeatStateFromTimestamp } from './heartbeat'

/** The counts a card's state is read from (the portfolio RPC row). */
export interface OverviewCardCounts {
  critical_reports: number
  open_reports: number
  sessions_7d: number
  /** `undefined` = an older RPC without the column; `null` = never seen. */
  last_seen_at?: string | null
}

export type HealthTone = 'critical' | 'not-connected' | 'silent' | 'warn' | 'quiet' | 'ok'

/**
 * A project with no heartbeat used to fall through to `ok` and render a green
 * "Healthy" badge — the never-connected case looked identical to the perfectly
 * healthy one. Connectivity is now checked before the quiet-and-fine path.
 *
 * Critical reports still outrank connectivity: a project with live critical
 * bugs is the more urgent thing to say, and reports only exist if something
 * connected at some point anyway.
 */
export function healthToneFor(card: OverviewCardCounts): HealthTone {
  if (card.critical_reports > 0) return 'critical'

  const heartbeat = heartbeatStateFromTimestamp(card.last_seen_at)
  if (heartbeat === 'never') return 'not-connected'
  if (heartbeat === 'dead') return 'silent'

  if (card.open_reports > 5) return 'warn'
  // No user sessions this week is not evidence of health: a project nobody
  // used for 7 days rendered the same green "Healthy" as a busy one.
  if (card.sessions_7d === 0) return 'quiet'
  return 'ok'
}

/** Tones that need nothing from the user right now. */
export function isCalmTone(tone: HealthTone): boolean {
  return tone === 'ok' || tone === 'quiet'
}

export const HEALTH_RANK: Record<HealthTone, number> = {
  critical: 0,
  'not-connected': 1,
  silent: 2,
  warn: 3,
  quiet: 4,
  ok: 5,
}

/**
 * One name and one colour per state (round-2 sweep 2026-11-18). "Silent"
 * (amber) and "Quiet" (grey) read as the same thing; an open-bug count in
 * amber read as a warning. Now: a stopped SDK is the only amber, a count is
 * neutral, and "no sessions" is said once, in the card's stats row, so the
 * quiet card carries no badge.
 */
export const HEALTH_BADGE_TONE: Record<HealthTone, BadgeTone> = {
  critical: 'dangerSubtle',
  'not-connected': 'neutral',
  silent: 'warnSubtle',
  warn: 'neutral',
  quiet: 'neutral',
  ok: 'okSubtle',
}

/** `null` = no badge (the stats row says it). */
export function healthBadgeLabel(card: Pick<OverviewCardCounts, 'critical_reports' | 'open_reports'>, tone: HealthTone): string | null {
  switch (tone) {
    case 'critical':
      return `${card.critical_reports} critical`
    case 'not-connected':
      return 'Not connected'
    case 'silent':
      return 'SDK stopped'
    case 'warn':
      return `${card.open_reports} open`
    case 'quiet':
      return null
    case 'ok':
      return 'Healthy'
  }
}

/**
 * Cards with sessions this week, and the ones without. Four full cards each
 * saying "No sessions this week" left ~70 px of empty space apiece (round-3
 * sweep 2026-11-19); the quiet ones now share one list, still in rank order.
 */
export function splitBySessions<T extends Pick<OverviewCardCounts, 'sessions_7d'>>(cards: readonly T[]): { active: T[]; idle: T[] } {
  const active: T[] = []
  const idle: T[] = []
  for (const c of cards) (c.sessions_7d > 0 ? active : idle).push(c)
  return { active, idle }
}
