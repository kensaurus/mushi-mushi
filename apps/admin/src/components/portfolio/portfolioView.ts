/**
 * FILE: apps/admin/src/components/portfolio/portfolioView.ts
 * PURPOSE: Pure view helpers for the Portfolio page: card order, the radar
 *          and SDK labels, and the kind label. "Never checked" reads as
 *          "Not checked yet", never as a pass, and a column the server could
 *          not read (`card.unreadable`) reads "Could not read", never as $0,
 *          "Not set" or "None yet".
 */

import type { BadgeTone } from '../ui'
import type { PortfolioCard, PortfolioRadarColumn, PortfolioReadPart, SdkSkewEntry } from '../../lib/portfolioTypes'
import type { DetectorState } from '../../lib/radarTypes'

const WORST_RANK: Record<string, number> = { error: 0, drift: 1, unknown: 2, not_connected: 3, ok: 4 }

/** Worst recipe state first, then the most open reports, then by name. */
export function sortPortfolioCards(cards: readonly PortfolioCard[]): PortfolioCard[] {
  return [...cards].sort(
    (a, b) =>
      (WORST_RANK[a.worst] ?? 2) - (WORST_RANK[b.worst] ?? 2) ||
      b.openReports - a.openReports ||
      a.name.localeCompare(b.name),
  )
}

export const COULD_NOT_READ = 'Could not read'

export function radarLabel(r: PortfolioRadarColumn, unreadable: readonly PortfolioReadPart[] = []): { text: string; tone: BadgeTone; hint: string } {
  if (unreadable.includes('gate_runs') || unreadable.includes('findings')) {
    return { text: 'Checks not fully read', tone: 'warnSubtle', hint: 'Not every check result could be read for this app, so its holes are unknown. This is not a pass.' }
  }
  if (r.status === 'never_run' || !r.checkedAt) {
    return { text: 'Not checked yet', tone: 'neutral', hint: 'The hole checks have not run for this project yet. This is not a pass.' }
  }
  if (r.status === 'nothing_to_check') {
    return { text: 'Nothing to check yet', tone: 'neutral', hint: 'The hole checks ran, but this app declares no store ids, domains or privacy link to check. Add a store block to mushi.recipe.json.' }
  }
  if (r.status === 'error') {
    const n = r.errored > 0 ? ` ${r.errored} check${r.errored === 1 ? '' : 's'} could not run.` : ''
    return { text: 'Check failed', tone: 'danger', hint: `The last hole check could not finish.${n} This is not a pass.` }
  }
  const total = r.open.error + r.open.warn
  if (r.open.error > 0) return { text: `${total} hole${total === 1 ? '' : 's'}`, tone: 'dangerSubtle', hint: `${r.open.error} serious, ${r.open.warn} to look at.` }
  if (r.open.warn > 0) return { text: `${total} to look at`, tone: 'warnSubtle', hint: `${r.open.warn} findings to look at.` }
  const extra = r.unchecked > 0 ? ` ${r.unchecked} check${r.unchecked === 1 ? '' : 's'} could not decide and ${r.unchecked === 1 ? 'is' : 'are'} not counted as passing.` : ''
  return { text: 'No holes found', tone: 'okSubtle', hint: `The last check found nothing to fix.${extra}` }
}

export function sdkLabel(entries: readonly SdkSkewEntry[], unreadable: readonly PortfolioReadPart[] = []): { text: string; tone: BadgeTone; hint: string } {
  if (unreadable.includes('sdk')) {
    return { text: 'SDK: could not read', tone: 'dangerSubtle', hint: 'The Mushi SDK versions could not be read. Refresh in a minute.' }
  }
  if (entries.length === 0 || entries.every((e) => e.status === 'unknown')) {
    return { text: 'SDK unknown', tone: 'neutral', hint: entries[0]?.reason ?? 'No Mushi SDK has reported from this project yet.' }
  }
  const behind = entries.filter((e) => e.status === 'behind')
  if (behind.length > 0) {
    return { text: `SDK ${behind[0].version} → ${behind[0].latest}`, tone: 'warnSubtle', hint: behind.map((e) => `${e.package}: ${e.reason}`).join(' ') }
  }
  const cur = entries.find((e) => e.status === 'current')!
  return { text: `SDK ${cur.version}`, tone: 'okSubtle', hint: entries.map((e) => `${e.package}: ${e.reason}`).join(' ') }
}

export function kindLabel(card: Pick<PortfolioCard, 'kind' | 'kindSource'> & { unreadable?: readonly PortfolioReadPart[] }): string {
  if (!card.kind) return card.unreadable?.includes('kind') ? 'Kind: could not read' : 'Kind unknown'
  const name = card.kind.charAt(0).toUpperCase() + card.kind.slice(1)
  return card.kindSource === 'inferred' ? `${name} (inferred)` : name
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`
}

type CardCells = Pick<PortfolioCard, 'openReports' | 'latestRelease' | 'spend' | 'unreadable'>

/** Open reports; a count cut short is shown as "at least". */
export function openReportsText(card: CardCells): string {
  return card.unreadable.includes('reports') ? `${card.openReports}+` : String(card.openReports)
}

export function releaseText(card: CardCells): string {
  if (card.latestRelease) return card.latestRelease.version
  return card.unreadable.includes('releases') ? COULD_NOT_READ : 'None yet'
}

/** Mushi's AI spend over 30 days: unknown when unread, a lower bound when cut short. */
export function spendText(card: CardCells): string {
  if (card.spend.llmUsd30d === null) return COULD_NOT_READ
  return card.spend.partial ? `at least ${formatUsd(card.spend.llmUsd30d)}` : formatUsd(card.spend.llmUsd30d)
}

export function budgetText(card: CardCells): string {
  if (!card.spend.capsKnown) return COULD_NOT_READ
  return card.spend.monthlyLlmBudgetUsd == null ? 'Not set' : formatUsd(card.spend.monthlyLlmBudgetUsd)
}

const STATE_META: Record<DetectorState, { label: string; tone: BadgeTone }> = {
  ok: { label: 'Nothing found', tone: 'okSubtle' },
  finding: { label: 'Found', tone: 'warnSubtle' },
  unknown: { label: 'Not checked', tone: 'neutral' },
  error: { label: 'Check failed', tone: 'dangerSubtle' },
}

export function radarStateMeta(state: string): { label: string; tone: BadgeTone } {
  return STATE_META[state as DetectorState] ?? STATE_META.unknown
}
