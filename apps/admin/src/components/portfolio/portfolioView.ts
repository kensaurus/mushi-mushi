/**
 * FILE: apps/admin/src/components/portfolio/portfolioView.ts
 * PURPOSE: Pure view helpers for the Portfolio page: card order, the radar
 *          and SDK labels, and the kind label. "Never checked" reads as
 *          "Not checked yet", never as a pass, and a column the server could
 *          not read (`card.unreadable`) reads "Could not read", never as $0,
 *          "Not set" or "None yet".
 */

import type { BadgeTone } from '../ui'
import type { FindingGroup, PortfolioCard, PortfolioCardProblem, PortfolioRadarColumn, PortfolioReadPart, SdkSkewEntry } from '../../lib/portfolioTypes'
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

const COULD_NOT_READ = 'Could not read'

export function radarLabel(r: PortfolioRadarColumn, unreadable: readonly PortfolioReadPart[] = []): { text: string; tone: BadgeTone; hint: string } {
  if (unreadable.includes('gate_runs') || unreadable.includes('findings')) {
    return { text: 'Risk checks: not fully read', tone: 'warnSubtle', hint: 'Not every risk check result could be read for this app, so its risks are unknown. This is not a pass. Refresh in a minute.' }
  }
  if (r.status === 'never_run' || !r.checkedAt) {
    return { text: 'Risk checks: not run yet', tone: 'neutral', hint: 'The daily risk checks (expiring domain, store rules, privacy link, unused keys) have not run for this app yet. This is not a pass. Run them from its Recipe page.' }
  }
  if (r.status === 'nothing_to_check') {
    return { text: 'Risk checks: nothing to check', tone: 'neutral', hint: 'The risk checks ran, but this app declares no store ids, domains or privacy link to check. Add a store block to the mushi.recipe.json file at your repo root.' }
  }
  if (r.status === 'error') {
    const n = r.errored > 0 ? ` ${r.errored} check${r.errored === 1 ? '' : 's'} could not run.` : ''
    return { text: 'Risk checks failed', tone: 'danger', hint: `The last risk check could not finish.${n} This is not a pass. Run it again from the Recipe page.` }
  }
  const total = r.open.error + r.open.warn
  if (r.open.error > 0) return { text: `${total} risk${total === 1 ? '' : 's'} to fix`, tone: 'dangerSubtle', hint: `${r.open.error} serious, ${r.open.warn} to look at. Open the Recipe page for each fix.` }
  if (r.open.warn > 0) return { text: `${total} risk${total === 1 ? '' : 's'} to look at`, tone: 'warnSubtle', hint: `${r.open.warn} to look at. Open the Recipe page for each fix.` }
  const extra = r.unchecked > 0 ? ` ${r.unchecked} check${r.unchecked === 1 ? '' : 's'} could not decide and ${r.unchecked === 1 ? 'is' : 'are'} not counted as passing.` : ''
  return { text: 'No risks found', tone: 'okSubtle', hint: `The last risk check found nothing to fix.${extra}` }
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

/**
 * The problems a card names next to its headline chip, worst first. A card
 * that is not OK always explains itself: when the server sent no list (an
 * older server) the headline stands alone, never with an empty "all fine".
 */
export function cardNeedsLook(card: Pick<PortfolioCard, 'needsLook'>): PortfolioCardProblem[] {
  return card.needsLook ?? []
}

/** Does this card need a look? Only when something is wrong or unconfirmed, never for "not set up" alone. */
export function needsALook(card: Pick<PortfolioCard, 'worst' | 'needsLook' | 'error'>): boolean {
  if (card.error) return true
  if (card.needsLook) return card.needsLook.length > 0
  return card.worst !== 'ok' && card.worst !== 'not_connected'
}

/** First sentence of a finding message, as a fallback title. */
function firstSentence(text: string): string {
  const t = text.trim()
  const m = /^(.+?[.!?])(\s|$)/.exec(t)
  return (m ? m[1] : t).slice(0, 160)
}

/**
 * The heading of a "Fix once" row: the rule's catalog title, else the first
 * sentence of the finding's own message (plain English from the rule), never
 * the raw rule id. The id stays available for a tooltip.
 */
export function findingGroupTitle(g: Pick<FindingGroup, 'ruleId' | 'title' | 'sampleMessage' | 'gateLabel'>): string {
  if (g.title) return g.title
  const msg = g.sampleMessage ? firstSentence(g.sampleMessage) : ''
  if (msg) return msg
  return g.gateLabel ? `${g.gateLabel} problem` : 'A problem shared by several apps'
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

const RADAR_STATE_ORDER: Record<string, number> = { finding: 0, error: 1 }

/**
 * The risk checks split for the Recipe page: problems first (Found, then
 * Check failed), then the checks that never ran and the passing ones, which
 * the panel collapses. An unknown state counts as not checked, never passing.
 */
export function groupRadarDetectors<T extends { state: string }>(detectors: readonly T[]): { problems: T[]; notChecked: T[]; passing: T[] } {
  const problems = detectors
    .filter((d) => d.state === 'finding' || d.state === 'error')
    .sort((a, b) => (RADAR_STATE_ORDER[a.state] ?? 2) - (RADAR_STATE_ORDER[b.state] ?? 2))
  return {
    problems,
    notChecked: detectors.filter((d) => d.state !== 'ok' && d.state !== 'finding' && d.state !== 'error'),
    passing: detectors.filter((d) => d.state === 'ok'),
  }
}

/**
 * A plain sentence for a check whose last run failed. The raw reason is a
 * server or JavaScript error ("fns.map is not a function"); the panel keeps it
 * behind a disclosure.
 */
export function radarErrorSentence(checkedAt: string | null, formatAgo: (iso: string) => string): string {
  const when = checkedAt ? `The last run (${formatAgo(checkedAt)}) could not finish` : 'The last run could not finish'
  return `${when}, so this risk is unknown. Run the checks again; if it keeps failing, the detail below says why.`
}
