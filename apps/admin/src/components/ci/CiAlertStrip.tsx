/**
 * FILE: apps/admin/src/components/ci/CiAlertStrip.tsx
 * PURPOSE: The first thing on /ci (2026-11-17): what is wrong, worst first, as short cards.
 *          Critical cards are red with a pulsing triangle; serious ones amber with a diamond.
 *          Pointing at a card lights the same app, job or machine in every panel below; a
 *          click pins it (the "Pinned" trail says what, Escape clears). Each card has icon
 *          actions: open the GitHub log, and jump to the evidence.
 *
 *          The cards themselves are the shared signal kit's AlertCards (2026-11-18); this file
 *          ranks the CI problems and names the pinned key.
 */

import { useMemo } from 'react'
import type { CiOverview } from '../../lib/ciTypes'
import type { CiStatus } from '../../lib/ciStatus'
import { ALERTS_SHOWN, rankCiAlerts } from '../../lib/ciAlerts'
import type { CiKey } from '../../lib/ciHighlight'
import { repoShortName } from '../../lib/ciView'
import { AlertCards, type SignalAlert } from '../signal/AlertCards'

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

export function CiAlertStrip({ overview, status, now }: { overview: CiOverview; status: CiStatus; now: number }) {
  const alerts = useMemo<SignalAlert[]>(
    () =>
      rankCiAlerts(overview, status, now).map((a) => ({
        ...a,
        hrefLabel: 'Open the log on GitHub',
        jumpLabel: 'Show the evidence',
      })),
    [overview, status, now],
  )
  return (
    <AlertCards
      alerts={alerts}
      emptyText="Nothing needs you: no failing jobs, nothing stuck, no machine down."
      maxShown={ALERTS_SHOWN}
      columns={6}
      testIdPrefix="ci"
      keyLabel={(key) => keyLabel(overview, key)}
    />
  )
}
