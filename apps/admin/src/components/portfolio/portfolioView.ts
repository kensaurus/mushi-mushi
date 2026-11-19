/**
 * FILE: apps/admin/src/components/portfolio/portfolioView.ts
 * PURPOSE: Pure view helpers for the Portfolio page: card order, the radar
 *          and SDK labels, and the kind label. "Never checked" reads as
 *          "Not checked yet", never as a pass, and a column the server could
 *          not read (`card.unreadable`) reads "Could not read", never as $0,
 *          "Not set" or "None yet".
 */

import type { BadgeTone } from '../ui'
import type { FindingGroup, PortfolioCard, PortfolioCardProblem, PortfolioFindingsResponse, PortfolioRadarColumn, PortfolioReadPart, SdkSkewEntry } from '../../lib/portfolioTypes'
import type { RecipeElementKey } from '../../lib/recipeTypes'
import type { DetectorState } from '../../lib/radarTypes'
import { isPublicDemo } from '../../lib/publicDemo'
import { fixOnceRows, groupAcrossApps, groupHoles, groupSdkSkew, sortProblemRows, type FixOnceRow } from '../../lib/groupAppFindings'

const COULD_NOT_READ = 'Could not read'

/** @internal Exported for unit tests only; cards render it through cardStatusChips. */
export function radarLabel(r: PortfolioRadarColumn, unreadable: readonly PortfolioReadPart[] = []): { text: string; tone: BadgeTone; hint: string } {
  if (unreadable.includes('gate_runs') || unreadable.includes('findings')) {
    return { text: 'Risk checks: not fully read', tone: 'warnSubtle', hint: 'Not every risk check result could be read for this app, so its risks are unknown. This is not a pass. Refresh in a minute.' }
  }
  if (r.status === 'never_run' || !r.checkedAt) {
    return { text: 'Risk checks: not run yet', tone: 'neutral', hint: 'The daily risk checks (expiring domain, store rules, privacy link, unused keys) have not run for this app yet. This is not a pass. Run them from its App blueprint page.' }
  }
  if (r.status === 'nothing_to_check') {
    return { text: 'Risk checks: nothing to check', tone: 'neutral', hint: 'The risk checks ran, but this app declares no store ids, domains or privacy link to check. Add a store block to the mushi.recipe.json file at your repo root.' }
  }
  if (r.status === 'error') {
    const n = r.errored > 0 ? ` ${r.errored} check${r.errored === 1 ? '' : 's'} could not run.` : ''
    return { text: 'Risk checks failed', tone: 'danger', hint: `The last risk check could not finish.${n} This is not a pass. Run it again from the App blueprint page.` }
  }
  const total = r.open.error + r.open.warn
  if (r.open.error > 0) return { text: `${total} risk${total === 1 ? '' : 's'} to fix`, tone: 'dangerSubtle', hint: `${r.open.error} serious, ${r.open.warn} to look at. Open the App blueprint page for each fix.` }
  if (r.open.warn > 0) return { text: `${total} risk${total === 1 ? '' : 's'} to look at`, tone: 'warnSubtle', hint: `${r.open.warn} to look at. Open the App blueprint page for each fix.` }
  const extra = r.unchecked > 0 ? ` ${r.unchecked} check${r.unchecked === 1 ? '' : 's'} could not decide and ${r.unchecked === 1 ? 'is' : 'are'} not counted as passing.` : ''
  return { text: 'No risks found', tone: 'okSubtle', hint: `The last risk check found nothing to fix.${extra}` }
}

/** @internal Exported for unit tests only; cards render it through cardStatusChips. */
export function sdkLabel(entries: readonly SdkSkewEntry[], unreadable: readonly PortfolioReadPart[] = []): { text: string; tone: BadgeTone; hint: string } {
  if (unreadable.includes('sdk')) {
    return { text: 'SDK: could not read', tone: 'dangerSubtle', hint: 'The Mushi Mushi SDK versions could not be read. Refresh in a minute.' }
  }
  if (entries.length === 0 || entries.every((e) => e.status === 'unknown')) {
    return { text: 'SDK unknown', tone: 'neutral', hint: entries[0]?.reason ?? 'No Mushi Mushi SDK has reported from this project yet.' }
  }
  const behind = entries.filter((e) => e.status === 'behind')
  if (behind.length > 0) {
    return { text: `SDK ${behind[0].version} → ${behind[0].latest}`, tone: 'warnSubtle', hint: behind.map((e) => `${e.package}: ${e.reason}`).join(' ') }
  }
  const cur = entries.find((e) => e.status === 'current')!
  return { text: `SDK ${cur.version}`, tone: 'okSubtle', hint: entries.map((e) => `${e.package}: ${e.reason}`).join(' ') }
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
 * @internal Exported for tests.
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

/**
 * Open reports; a count cut short is shown as "at least".
 * @internal Exported for unit tests only; cards render it through cardStatusChips.
 */
export function openReportsText(card: CardCells): string {
  return card.unreadable.includes('reports') ? `${card.openReports}+` : String(card.openReports)
}

/** @internal Exported for unit tests only; cards render it through cardStatusChips. */
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

const SERIOUS_SEVERITY = new Set(['critical', 'error', 'high'])

/**
 * The badge on a risk check, from its worst finding's severity: the rejected key read amber
 * "Found" here and red ERROR on Full-stack audit (2026-11-18). A serious finding is red "Error",
 * the rest amber "Warning"; other states keep their state badge.
 */
export function radarBadge(d: { state: string; findings: ReadonlyArray<{ severity: string }> }): { label: string; tone: BadgeTone } {
  if (d.state !== 'finding') return radarStateMeta(d.state)
  return d.findings.some((f) => SERIOUS_SEVERITY.has(f.severity.toLowerCase()))
    ? { label: 'Error', tone: 'dangerSubtle' }
    : { label: 'Warning', tone: 'warnSubtle' }
}

/**
 * The worst risk check, for the App blueprint's Overall (round 3, 2026-11-19: Overall read amber
 * "Needs attention" while a risk check right below it said red "Error"). Same words and tone as
 * each check's own badge; null when no check found anything.
 */
export function radarOverall(detectors: ReadonlyArray<{ state: string; findings: ReadonlyArray<{ severity: string }> }>): { tone: 'danger' | 'warn'; label: string } | null {
  const found = detectors.filter((d) => d.state === 'finding')
  if (found.length === 0) return null
  return found.some((d) => radarBadge(d).tone === 'dangerSubtle') ? { tone: 'danger', label: 'Error' } : { tone: 'warn', label: 'Warning' }
}

/**
 * A check's name says what passing looks like ("No known holes in your dependencies"). When it
 * found something, the same name next to "Found" contradicted itself (fresh-eyes 2026-11-18), so
 * the title says the condition is not met.
 */
export function radarTitle(d: { title: string; state: string }): string {
  return d.state === 'finding' ? `Not met: ${d.title}` : d.title
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

/**
 * One small status chip on a Portfolio card: a short label, a tone that
 * carries the meaning, the full sentence as a tooltip, and the page that
 * fixes it. Replaces the prose problem lines (owner, 2026-10-14).
 */
export interface CardStatusChip {
  key: 'bugs' | 'checks' | 'sdk' | 'release'
  text: string
  tone: BadgeTone
  hint: string
  to: string
}

export function cardStatusChips(card: PortfolioCard): CardStatusChip[] {
  const bugs = openReportsText(card)
  const radar = radarLabel(card.radar, card.unreadable)
  const sdk = sdkLabel(card.sdk, card.unreadable)
  const release = releaseText(card)
  return [
    {
      key: 'bugs',
      text: `${bugs} ${card.openReports === 1 ? 'bug' : 'bugs'}`,
      tone: card.openReports > 0 ? 'warnSubtle' : 'okSubtle',
      hint: card.openReports > 0 ? `${bugs} open bug ${card.openReports === 1 ? 'report' : 'reports'}. Open Bugs to triage them.` : 'No open bug reports.',
      to: '/reports',
    },
    { key: 'checks', text: radar.text.replace(/^Risk checks: /, 'Checks: '), tone: radar.tone, hint: radar.hint, to: '/recipe' },
    { key: 'sdk', text: sdk.text, tone: sdk.tone, hint: sdk.hint, to: '/connect' },
    {
      key: 'release',
      text: card.latestRelease ? `v${release.replace(/^v/, '')}` : release === 'None yet' ? 'No release' : release,
      tone: 'neutral',
      hint: card.latestRelease ? `Latest release ${card.latestRelease.version}.` : 'No release recorded for this app yet.',
      to: '/releases',
    },
  ]
}


// ── urgency (console journeys 2026-10-27) ────────────────────────────────────
//
// Every card used to say "Needs attention" with the same next step, "Mushi
// setup check (no spend cap)… on the Recipe page", so the chip carried no
// signal and the step was a chore on Mushi's side, not the app's problem.
// Now each card names its own top problem, and the cards sort by it.

/**
 * Mushi's own setup checks (an autofix spend cap, a webhook secret) reach the
 * card as an "Automated checks" problem whose only open gate is the setup
 * check. That is a chore, never an app's top problem.
 */
// The server's sentence. It may say the product's full name once it is renamed there too.
const SETUP_ONLY_REASON = /^\d+ problems? to fix: (?:Mushi )?Mushi setup checks? \(\d+\)\./

function isMushiSetupChore(p: Pick<PortfolioCardProblem, 'element' | 'reason'>): boolean {
  return p.element === 'gates' && SETUP_ONLY_REASON.test(p.reason)
}

/** Where each recipe part is fixed. */
const ELEMENT_PAGE: Partial<Record<RecipeElementKey, string>> = {
  gates: '/fullstack-audit',
  ci: '/ci',
  design: '/design',
  routes: '/inventory',
  integrations: '/integrations/config',
}

/** A label inside a sentence: lower case, except acronyms ("CI", "SDK") stay as they are. */
function inSentence(label: string): string {
  return label
    .split(' ')
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(' ')
}

/** Most urgent first: broken, bugs waiting, a part to fix, SDK behind, chores, clear. */
type UrgencyLevel = 'broken' | 'bugs' | 'fix' | 'behind' | 'chores' | 'clear'

const URGENCY_RANK: Record<UrgencyLevel, number> = { broken: 0, bugs: 1, fix: 2, behind: 3, chores: 4, clear: 5 }

export interface AppUrgency {
  level: UrgencyLevel
  /** A two-to-four-word chip that differs between apps ("CI failing", "Bugs to fix"). */
  chip: { text: string; tone: BadgeTone }
  /** The top problem in a few words, for the page's status sentence. */
  short: string
  /** The one next step and the page that fixes it; null when the app is clear. */
  next: { text: string; to: string; more: number } | null
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function appUrgency(card: PortfolioCard): AppUrgency {
  const problems = card.needsLook ?? []
  const chores = problems.filter(isMushiSetupChore)
  const appProblems = problems.filter((p) => !isMushiSetupChore(p))
  const pageFor = (p: PortfolioCardProblem) => ELEMENT_PAGE[p.element] ?? '/recipe'
  const others = (shown: number) => Math.max(0, problems.length - shown)

  if (card.error) {
    return { level: 'broken', chip: { text: 'Could not read', tone: 'danger' }, short: 'its blueprint could not be read', next: { text: 'Open the App blueprint to see why', to: '/recipe', more: others(0) } }
  }
  const failing = appProblems.find((p) => p.state === 'error')
  if (failing) {
    return {
      level: 'broken',
      chip: { text: `${failing.label} failing`, tone: 'danger' },
      short: `${inSentence(failing.label)} failing`,
      next: { text: `${failing.label}: ${failing.reason}`, to: pageFor(failing), more: others(1) },
    }
  }
  if (card.openReports > 0) {
    const n = openReportsText(card)
    const bugs = card.openReports === 1 ? 'bug' : 'bugs'
    return {
      level: 'bugs',
      chip: { text: 'Bugs to fix', tone: 'warn' },
      short: `${n} open ${bugs}`,
      next: { text: card.openReports === 1 ? 'Fix the open bug' : `Fix the worst of ${n} open bugs`, to: '/reports', more: problems.length },
    }
  }
  // An older server sends no problem list: fall back to the headline state.
  if (card.needsLook === undefined && (card.worst === 'drift' || card.worst === 'error')) {
    return { level: 'fix', chip: { text: 'Needs a look', tone: 'warnSubtle' }, short: 'a part to fix', next: { text: 'Open the App blueprint to see what to fix', to: '/recipe', more: 0 } }
  }
  const drift = appProblems.find((p) => p.state === 'drift')
  if (drift) {
    return {
      level: 'fix',
      chip: { text: `${drift.label} to fix`, tone: 'warnSubtle' },
      short: `${inSentence(drift.label)} to fix`,
      next: { text: `${drift.label}: ${drift.reason}`, to: pageFor(drift), more: others(1) },
    }
  }
  const behind = card.unreadable.includes('sdk') ? undefined : card.sdk.find((e) => e.status === 'behind')
  if (behind) {
    return {
      level: 'behind',
      chip: { text: 'SDK update', tone: 'infoSubtle' },
      short: `SDK ${behind.version} → ${behind.latest}`,
      next: { text: `Update the Mushi Mushi SDK from ${behind.version} to ${behind.latest}`, to: '/connect', more: others(0) },
    }
  }
  const stale = appProblems[0]
  if (stale || chores.length > 0) {
    const first = stale ?? chores[0]
    return {
      level: 'chores',
      chip: { text: stale ? 'Re-run checks' : 'Mushi Mushi setup', tone: 'neutral' },
      short: stale ? 'checks to re-run' : 'Mushi Mushi setup to finish',
      next: { text: stale ? `${stale.label}: ${stale.reason}` : `Mushi Mushi setup: ${plural(chores.length, 'small fix', 'small fixes')} on the App blueprint page`, to: stale ? pageFor(first) : '/recipe', more: others(1) },
    }
  }
  if (!card.radar.checkedAt) {
    return { level: 'chores', chip: { text: 'Not checked yet', tone: 'neutral' }, short: 'not checked yet', next: null }
  }
  return { level: 'clear', chip: { text: 'All clear', tone: 'okSubtle' }, short: 'all clear', next: null }
}

/** The app's own problems: its needsLook list without Mushi Mushi's setup chores. */
export function appProblems(card: Pick<PortfolioCard, 'needsLook'>): PortfolioCardProblem[] {
  return (card.needsLook ?? []).filter((p) => !isMushiSetupChore(p))
}

/** The Worst-first order's first key: 0 broken, 1 bugs, 2 a part to fix, 3 SDK behind, 4 chores, 5 clear. */
export function urgencyRank(card: PortfolioCard): number {
  return URGENCY_RANK[appUrgency(card).level]
}

/** Does this app need its owner? Broken, bugs waiting, or a part to fix. Chores and SDK updates do not. */
export function needsALook(card: PortfolioCard): boolean {
  return URGENCY_RANK[appUrgency(card).level] <= URGENCY_RANK.fix
}

/**
 * The team's own apps, and the public demo apart (it powers the docs try-it
 * page, has no repo or real users on purpose, and is never an app that needs
 * you). The page shows it as one muted line, outside the cards and counts.
 */
export function splitPublicDemo(cards: readonly PortfolioCard[]): { apps: PortfolioCard[]; demo: PortfolioCard[] } {
  const apps: PortfolioCard[] = []
  const demo: PortfolioCard[] = []
  for (const c of cards) (isPublicDemo(c) ? demo : apps).push(c)
  return { apps, demo }
}

export type PortfolioSort = 'worst' | 'name'

/**
 * Worst first (the default): broken, then the most open bugs, then a part to
 * fix, then chores; ties by name. Or by name (the Apps page toggle, owner's
 * walkthrough 2026-11-17: "which app is worst" needed one look).
 */
export function sortPortfolioCards(cards: readonly PortfolioCard[], by: PortfolioSort = 'worst'): PortfolioCard[] {
  if (by === 'name') return [...cards].sort((a, b) => a.name.localeCompare(b.name))
  const rank = new Map(cards.map((c) => [c, URGENCY_RANK[appUrgency(c).level]]))
  return [...cards].sort(
    (a, b) => (rank.get(a) ?? 5) - (rank.get(b) ?? 5) || b.openReports - a.openReports || a.name.localeCompare(b.name),
  )
}

/**
 * Fix once rows open in exactly the same apps, with the same severity and the same one action,
 * as ONE row ("A connected key stopped working · AI key rejected", 9 apps): two rows with the
 * same nine dots and the same "Fix key" said the same thing twice (2026-11-18 sweep). Order is
 * kept (the first row of a merge holds its place); the fix prompts and explanations are joined.
 * @internal Exported for tests.
 */
export function mergeSameAppRows(rows: readonly FixOnceRow[]): FixOnceRow[] {
  const out: FixOnceRow[] = []
  const at = new Map<string, number>()
  for (const r of rows) {
    const key = `${r.severity}|${r.action}|${[...r.projectIds].sort().join(',')}`
    const i = at.get(key)
    if (i === undefined) {
      at.set(key, out.length)
      out.push({ ...r, projectIds: [...r.projectIds] })
      continue
    }
    const m = out[i]!
    out[i] = {
      ...m,
      ruleId: `${m.ruleId}+${r.ruleId}`,
      title: `${m.title} · ${r.title}`,
      fullTitle: `${m.fullTitle}\n${r.fullTitle}`,
      explanation: `${m.explanation} ${r.explanation}`,
      fix: `${m.fix}\n\n${r.fix}`,
    }
  }
  return out
}

/**
 * The Apps tab's ONE problem list (2026-11-18 round 2: "Fix once", "Across your apps",
 * "Mushi Mushi SDK versions" and "Missing setups" were four cards holding one list). Every
 * problem shared by apps is a row: a severity mark, a short title, a dot per app and one
 * action. Worst first across all of them. The "Fix once" metric in the page's status strip is
 * this list's length, so the two never disagree (it counted the server's groups, 9, beside 8
 * rows once two rows with the same apps and action had merged).
 */
export function appProblemList(data: PortfolioFindingsResponse, nameOf: (projectId: string) => string): FixOnceRow[] {
  const fixOnce = mergeSameAppRows(fixOnceRows(data.groups, findingGroupTitle))
  const across = groupAcrossApps(data.crossProject, nameOf).map(
    (g): FixOnceRow => ({
      ruleId: `across:${g.key}`,
      severity: g.severity,
      title: g.title,
      fullTitle: g.detail,
      action: g.fix ? g.action : '',
      projectIds: g.projectIds,
      gateLabel: null,
      explanation: g.detail,
      fix: g.fix ?? '',
    }),
  )
  const sdk = groupSdkSkew(data.sdkSkew).map((g): FixOnceRow => {
    const behind = g.status === 'behind'
    const pkg = g.pkg ?? 'Mushi Mushi SDK'
    const title = behind ? `${pkg} behind${g.latest ? ` → ${g.latest}` : ''}` : `${pkg}: ${g.title}`
    return {
      ruleId: `sdk:${g.key}`,
      // Behind is a warning (amber); a version it could not read is a note, never a failure.
      severity: behind ? 'warn' : 'info',
      title,
      fullTitle: title,
      action: behind ? 'Upgrade' : '',
      projectIds: g.apps.map((a) => a.projectId),
      gateLabel: null,
      explanation: behind ? `These apps run an older ${pkg}. Open Connect to create an upgrade PR.` : g.apps[0]?.reason ?? g.title,
      fix: '',
      to: behind ? '/connect' : undefined,
      appTitles: Object.fromEntries(g.apps.map((a) => [a.projectId, a.version ? `${nameOf(a.projectId)} · on ${a.version}` : `${nameOf(a.projectId)} · ${a.reason}`.trim()])),
    }
  })
  const holes = groupHoles(data.holes).map(
    (h): FixOnceRow => ({
      ruleId: `hole:${h.integration}`,
      severity: 'info',
      title: h.title,
      fullTitle: h.detail,
      action: 'Connect',
      projectIds: h.projectIds,
      gateLabel: null,
      explanation: h.detail,
      fix: '',
      to: '/integrations',
    }),
  )
  return sortProblemRows([...fixOnce, ...across, ...sdk, ...holes])
}
