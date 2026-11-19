/**
 * FILE: apps/admin/src/components/ci/CiAlertStrip.tsx
 * PURPOSE: The first thing on /ci (2026-11-17): what is wrong, worst first, as short cards.
 *          Critical cards are red with a pulsing triangle; serious ones amber with a diamond.
 *          Pointing at a card lights the same app, job or machine in every panel below; a
 *          click pins it (the "Pinned" trail says what, Escape clears). Each card has icon
 *          actions: open the GitHub log, and jump to the evidence.
 *
 *          The cards themselves are the shared signal kit's AlertCards (2026-11-18); this file
 *          ranks the CI problems and names the pinned key. A card with a failing job behind it has
 *          "Why it failed", which opens the debug drawer (CiJobDebug.tsx, 2026-11-19).
 */

import { useMemo } from 'react'
import type { CiOverview } from '../../lib/ciTypes'
import type { CiStatus } from '../../lib/ciStatus'
import { ALERTS_SHOWN, rankCiAlerts, type CiAlert, type CiAlertBar } from '../../lib/ciAlerts'
import { useCiLink, type CiKey } from '../../lib/ciHighlight'
import { repoShortName } from '../../lib/ciView'
import { AlertCards, type SignalAlert } from '../signal/AlertCards'
import { barPct } from '../signal/BarCell'
import { StatusPill } from '../signal/StatusMark'
import { useCiDebug } from './CiJobDebug'

/** One app's bar in a grouped card; pointing at it lights that app across the page. */
function AlertBarRow({ bar, max }: { bar: CiAlertBar; max: number }) {
  const link = useCiLink([bar.key], bar.key)
  const fill = bar.severity === 'critical' ? 'bg-st-failed' : 'bg-st-waiting'
  return (
    <li {...link} className={`${link.className} grid grid-cols-subgrid col-span-3 items-center`} data-testid="ci-alert-bar">
      {/* Wraps, never cut: "the-wanting-mi…" had room to break (round 3). */}
      <span className="min-w-0 text-2xs leading-tight font-semibold wrap-break-word text-fg">{bar.label}</span>
      <span className="relative block h-2 overflow-hidden rounded-xs bg-surface-overlay" aria-hidden="true">
        <span className={`ci-grow-x absolute inset-y-0 left-0 ${fill}`} style={{ width: `${Math.max(4, barPct(bar.value, max))}%` }} />
      </span>
      <span className="text-right font-mono text-2xs font-bold text-fg tabular-nums">{bar.display}</span>
    </li>
  )
}

const LABEL_CHIP = 'rounded-sm border border-edge-subtle bg-surface-overlay px-1.5 py-px font-mono text-2xs font-bold text-fg'

/**
 * The waiting card's label gap as chips: "needs kensaurus-local · has it: overseas-ci ·
 * missing: alienware-ci, alienwarex16". The sentence stays for screen readers only.
 */
function WaitLabelChips({ alert, labels }: { alert: CiAlert; labels: NonNullable<CiAlert['labels']> }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="sr-only">{alert.detail}</span>
      <span className="flex flex-wrap items-center gap-1 text-2xs" aria-hidden="true" data-testid="ci-alert-wait-labels">
        needs
        {labels.needs.map((l) => (
          <span key={l} className={LABEL_CHIP} data-testid="ci-alert-needs">
            {l}
          </span>
        ))}
        <span className="ml-1">has it:</span>
        {labels.has.map((m) => (
          <StatusPill key={m} status="passed" label={m} className="font-mono" />
        ))}
        {/* No machine has the label: the most actionable case, so it is said, not left blank. */}
        {labels.has.length === 0 && <StatusPill status="failed" label="none" />}
        {labels.missing.length > 0 && <span className="ml-1">missing:</span>}
        {labels.missing.map((m) => (
          <StatusPill key={m} status="failed" label={m} className="font-mono" />
        ))}
      </span>
    </span>
  )
}

/** The card's picture: a bar per app for a grouped cause, one rate bar, or the waiting card's label chips. */
function AlertDetail({ alert }: { alert: CiAlert }) {
  if (alert.labels) return <WaitLabelChips alert={alert} labels={alert.labels} />
  if (alert.bars && alert.bars.length > 0) {
    const max = Math.max(...alert.bars.map((b) => b.value))
    return (
      <span className="flex flex-col gap-1">
        <ul
          // mushi-mushi-allowlist: app name / bar / value columns shared by every row (subgrid)
          className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_auto] gap-x-1.5 gap-y-0.5"
          aria-label={alert.bars.map((b) => `${b.label} ${b.display}`).join(', ')}
        >
          {alert.bars.slice(0, 6).map((b) => (
            <AlertBarRow key={b.key} bar={b} max={max} />
          ))}
        </ul>
        {alert.bars.length > 6 && <span className="text-3xs text-fg-secondary">+{alert.bars.length - 6} more</span>}
      </span>
    )
  }
  if (alert.rate != null) {
    const pct = Math.round(alert.rate * 100)
    return (
      <span className="flex flex-col gap-1">
        <span>{alert.detail}</span>
        <span className="relative block h-2 overflow-hidden rounded-xs bg-st-passed-soft" role="img" aria-label={`${pct}% of runs fail`} data-testid="ci-alert-rate">
          <span className="ci-grow-x absolute inset-y-0 left-0 bg-st-failed" style={{ width: `${Math.max(3, pct)}%` }} />
        </span>
      </span>
    )
  }
  return <>{alert.detail}</>
}

/** A readable name for a highlight key. */
function keyLabel(overview: Pick<CiOverview, 'repos'>, key: CiKey): string {
  const [kind, rest = ''] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  const app = (repo: string) => overview.repos.find((r) => r.repo === repo)?.projectName || repoShortName(repo)
  if (kind === 'repo') return app(rest)
  if (kind === 'job') {
    const [repo = '', job = ''] = [rest.slice(0, rest.indexOf('|')), rest.slice(rest.indexOf('|') + 1)]
    return `${job} · ${app(repo)}`
  }
  return rest
}

interface CiAlertStripProps {
  overview: CiOverview
  status: CiStatus
  now: number
  /** Already ranked cards (the page ranks once and files them by app); ranked here when absent. */
  alerts?: readonly CiAlert[]
  /** Shown when there is nothing to flag; null renders nothing (an app's group). */
  emptyText?: string | null
  /** `<prefix>-alerts`, `<prefix>-alert-<id>`: one strip per app needs its own. */
  testIdPrefix?: string
  /** Cards on a wide screen before "Show more" (6 on the page strip, 3 inside an app's group). */
  maxShown?: number
  columns?: 3 | 6
}

export function CiAlertStrip({ overview, status, now, alerts: given, emptyText = 'Nothing needs you', testIdPrefix = 'ci', maxShown = ALERTS_SHOWN, columns = 6 }: CiAlertStripProps) {
  const debug = useCiDebug()
  const alerts = useMemo<SignalAlert[]>(
    () =>
      (given ?? rankCiAlerts(overview, status, now)).map((a) => ({
        ...a,
        detail: <AlertDetail alert={a} />,
        hrefLabel: 'Open the log on GitHub',
        jumpLabel: 'Show the evidence',
        // "Why it failed" opens the newest job behind the card in the debug drawer (2026-11-19):
        // the log and the cause in place, GitHub only as the secondary icon link.
        ...(debug && a.debugJobId
          ? { action: { label: a.label === 'Running long' ? 'Inspect' : 'Why it failed', onClick: () => debug.open(a.debugJobId!) } }
          : {}),
      })),
    [given, overview, status, now, debug],
  )
  return (
    <AlertCards
      alerts={alerts}
      // A mark and a short label, not a sentence restating the empty strip (round 3, 390).
      emptyText={emptyText}
      maxShown={maxShown}
      columns={columns}
      testIdPrefix={testIdPrefix}
      pinWithoutKeys
      keyLabel={(key) => keyLabel(overview, key)}
    />
  )
}
