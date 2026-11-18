/**
 * FILE: apps/admin/src/lib/checkSignals.ts
 * PURPOSE: /checks as signals, not sentences (2026-11-18, the CI page's visual language rolled
 *          out): how stale each check's last run is (graded on the red ramp, with a shape), how
 *          its count moved since your last visit ("▲ +3"), and the ranked alert cards on top.
 *
 * Rules (kept from lib/checkCardStatus.ts): a check Mushi could not read, has not run, or is not
 * set up is never an alert, never Failed and never stale; "Watching" has no run time, so it is
 * never stale either. Failed is critical; findings and a run older than STALE_DAYS are serious.
 *
 * The change is client-only: nav-meta keeps no history, so the page remembers each check's
 * count per app in localStorage at the end of a full read and compares the next visit with it.
 * No remembered count, no change shown (never a made-up "+0").
 */

import type { SignalAlert } from '../components/signal/AlertCards'
import { badnessClass } from '../components/signal/scale'
import type { SignalTone } from '../components/signal/StatusGlyph'
import type { CheckCardState, CheckCardView } from './checkCardStatus'

const DAY = 24 * 60 * 60 * 1000

/** A run older than this is stale: a serious alert and the darkest steps of the age ramp. */
export const STALE_DAYS = 7
/** The age ramp tops out here (darkest red). */
const AGE_TOP_DAYS = 14

/** States whose run time means something (a result was read). */
const HAS_RESULT: ReadonlySet<CheckCardState> = new Set(['pass', 'findings', 'failed'])

interface Staleness {
  /** Whole days since the run (0 under a day). */
  days: number
  /** The cell class: neutral until STALE_DAYS (an age is not a failure), then the red ramp up to AGE_TOP_DAYS. */
  cellClass: string
  /** ● until STALE_DAYS, ▲ past it. */
  tone: SignalTone
  /** "now", "5h", "3d", "14d". */
  short: string
  stale: boolean
}

/** How stale a run is, or null when there is no usable run time. */
export function staleness(lastRunAt: string | null | undefined, now: number): Staleness | null {
  if (!lastRunAt) return null
  const t = Date.parse(lastRunAt)
  if (!Number.isFinite(t)) return null
  const ms = Math.max(0, now - t)
  const days = Math.floor(ms / DAY)
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const short = hours < 1 ? 'now' : days < 1 ? `${hours}h` : `${days}d`
  const stale = days >= STALE_DAYS
  return {
    days,
    // 2026-11-18: a red "◆4d" read as a failure. Only a stale run takes colour.
    cellClass: stale ? badnessClass(days, AGE_TOP_DAYS) : 'ci-cell-0',
    tone: stale ? 'danger' : 'ok',
    short,
    stale,
  }
}

/** @internal The number a check's state counts, for the "since your last visit" change; null = not a result (exported for tests). */
export function signalCount(view: CheckCardView | null): number | null {
  if (!view) return null
  if (view.state === 'failed') return Math.max(1, view.count ?? 0)
  if (view.state === 'findings') return Math.max(1, view.count ?? 0)
  if (view.state === 'pass' || view.state === 'watching') return 0
  return null
}

export type CheckBaseline = Record<string, number>

/** "▲ +3" (worse), "▼ −2" (better), or null for no change or no remembered count. */
export function countChange(path: string, view: CheckCardView | null, baseline: CheckBaseline | null): { text: string; worse: boolean } | null {
  const now = signalCount(view)
  const before = baseline?.[path]
  if (now == null || typeof before !== 'number') return null
  const d = now - before
  if (d === 0) return null
  return d > 0 ? { text: `▲ +${d}`, worse: true } : { text: `▼ −${-d}`, worse: false }
}

/**
 * The counts to remember, or null while the read is incomplete: a card still loading or one
 * Mushi could not read would otherwise reset the baseline and hide a real change next time.
 */
export function baselineSnapshot(cards: ReadonlyArray<{ path: string; view: CheckCardView | null }>): CheckBaseline | null {
  const out: CheckBaseline = {}
  for (const c of cards) {
    if (!c.view || c.view.state === 'unavailable') return null
    const n = signalCount(c.view)
    if (n != null) out[c.path] = n
  }
  return out
}

const BASELINE_KEY = (projectId: string) => `mushi:checks-baseline:${projectId}`

export function readBaseline(projectId: string | null): CheckBaseline | null {
  if (!projectId) return null
  try {
    const raw = window.localStorage.getItem(BASELINE_KEY(projectId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const out: CheckBaseline = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    return out
  } catch {
    return null
  }
}

export function writeBaseline(projectId: string | null, snapshot: CheckBaseline): void {
  if (!projectId) return
  try {
    window.localStorage.setItem(BASELINE_KEY(projectId), JSON.stringify(snapshot))
  } catch {
    // Storage unavailable (private window): no change is shown next time.
  }
}

interface CheckSignalInput {
  path: string
  label: string
  description: string
  view: CheckCardView | null
}

/** The alert cards, worst first: failed, then findings (biggest first), then stale runs (oldest first). */
export function checkAlerts(cards: readonly CheckSignalInput[], baseline: CheckBaseline | null, now: number): SignalAlert[] {
  const failed: SignalAlert[] = []
  const found: Array<{ alert: SignalAlert; n: number }> = []
  const stale: Array<{ alert: SignalAlert; days: number }> = []
  for (const c of cards) {
    const v = c.view
    if (!v || !HAS_RESULT.has(v.state)) continue
    const age = staleness(v.lastRunAt, now)
    const change = countChange(c.path, v, baseline)
    const when = age ? (age.short === 'now' ? 'Last run just now' : `Last run ${age.short} ago`) : null
    const keys = [`check:${c.path}`]
    const action = { label: 'Open', to: c.path }
    if (v.state === 'failed') {
      failed.push({
        id: c.path.slice(1),
        severity: 'critical',
        label: 'Failed',
        title: `${c.label} failed`,
        detail: [change ? `${change.text} since your last visit` : null, when ?? c.description].filter(Boolean).join(' · '),
        metric: { value: '✕', unit: change ? `failed · ${change.text}` : 'failed' },
        keys,
        action,
      })
      continue
    }
    if (v.state === 'findings') {
      const n = signalCount(v) ?? 1
      found.push({
        n,
        alert: {
          id: c.path.slice(1),
          severity: 'serious',
          label: change?.worse ? 'Getting worse' : 'Findings',
          title: `${c.label}: ${n} to fix`,
          detail: [change ? `${change.text} since your last visit` : null, when ?? c.description].filter(Boolean).join(' · '),
          metric: { value: String(n), unit: `${n === 1 ? 'finding' : 'findings'}${change ? ` · ${change.text}` : ''}` },
          keys,
          action,
        },
      })
      continue
    }
    if (age?.stale) {
      stale.push({
        days: age.days,
        alert: {
          id: c.path.slice(1),
          severity: 'serious',
          label: `Stale ${age.short}`,
          title: `${c.label} has not run in ${age.days} days`,
          detail: 'Its last run passed, but that result is old. Run it again to trust it.',
          metric: { value: age.short, unit: 'since last run' },
          keys,
          action,
        },
      })
    }
  }
  return [...failed, ...found.sort((a, b) => b.n - a.n).map((x) => x.alert), ...stale.sort((a, b) => b.days - a.days).map((x) => x.alert)]
}
