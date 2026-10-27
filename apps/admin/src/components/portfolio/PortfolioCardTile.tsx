/**
 * FILE: apps/admin/src/components/portfolio/PortfolioCardTile.tsx
 * PURPOSE: One app on the Portfolio page (owner, 2026-10-14: "more
 *          graphical, less verbose; tell apps apart by their icon"):
 *          - header: app icon, name, kind, live release and when it shipped;
 *          - one row of status chips (bugs, checks, SDK, release), each a link
 *            to the page that fixes it, the full sentence in its tooltip;
 *          - at most one "Next step" link;
 *          - a muted footer: links into the app's pages and when the checks ran.
 *          Healthy apps render as a compact row (`PortfolioCompactRow`).
 */

import { Link } from 'react-router-dom'
import { Card, RelativeTime, Tooltip } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import { setActiveProjectIdSnapshot } from '../../lib/activeProject'
import type { PortfolioCard } from '../../lib/portfolioTypes'
import type { ProjectFaviconSource } from '@mushi-mushi/core'
import { ProjectFavicon } from '../ProjectFavicon'
import { RecipeStateChip } from '../recipe/RecipeStateChip'
import { budgetText, cardNextStep, cardStatusChips, kindLabel, spendText, type CardStatusChip } from './portfolioView'

interface Props {
  card: PortfolioCard
  /** Icon source (SDK origin, repo) from the team's project list. */
  favicon: ProjectFaviconSource
  showSpend: boolean
}

/** The app's own pages, in cycle order. */
const APP_LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/reports', label: 'Bugs' },
  { to: '/fixes', label: 'Fixes' },
  { to: '/releases', label: 'Releases' },
  { to: '/recipe', label: 'Blueprint' },
]

function StatusChip({ chip, onOpen }: { chip: CardStatusChip; onOpen: () => void }) {
  return (
    <Tooltip content={chip.hint}>
      <Link
        to={chip.to}
        onClick={onOpen}
        className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-medium leading-tight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${CHIP_TONE[chip.tone]}`}
      >
        {chip.text}
      </Link>
    </Tooltip>
  )
}

export function PortfolioCardTile({ card, favicon, showSpend }: Props) {
  const open = () => setActiveProjectIdSnapshot(card.projectId)
  const chips = cardStatusChips(card)
  const next = cardNextStep(card)
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <ProjectFavicon {...favicon} size={32} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg">
            <Link to="/recipe" onClick={open} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              {card.name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-2xs text-fg-faint">
            {kindLabel(card)}
            {card.latestRelease?.publishedAt ? (
              <>
                {' · shipped '}
                <RelativeTime value={card.latestRelease.publishedAt} />
              </>
            ) : null}
          </p>
        </div>
        <RecipeStateChip state={card.worst} className="shrink-0" />
      </div>

      {card.error && <p className="text-xs text-danger" role="status">{card.error}</p>}

      <div className="flex flex-wrap gap-1.5" aria-label="Status">
        {chips.map((chip) => (
          <StatusChip key={chip.key} chip={chip} onOpen={open} />
        ))}
      </div>

      {next && (
        // Neutral text: red is for errors, and this is a suggestion. A plain
        // title, not <Tooltip>: its inline anchor stops `truncate` shrinking
        // the line, which pushed the card wider than a phone screen.
        <Link
          to="/recipe"
          onClick={open}
          title={next.more > 0 ? `${next.reason} (+${next.more} more on the App blueprint page)` : next.reason}
          className="block min-w-0 truncate text-xs text-fg-secondary hover:text-fg hover:underline"
        >
          <span className="font-medium text-fg">Next step: {next.label}</span> — {next.reason} →
        </Link>
      )}

      {showSpend && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs text-fg-muted">
          <dt>Mushi AI spend (30 days)</dt>
          <dd className="text-right text-fg">{spendText(card)}</dd>
          <dt>Monthly AI budget</dt>
          <dd className="text-right text-fg">{budgetText(card)}</dd>
        </dl>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge pt-2 text-2xs text-fg-muted">
        {APP_LINKS.map((l) => (
          <Link key={l.to} to={l.to} onClick={open} className="hover:text-fg hover:underline">
            {l.label}
          </Link>
        ))}
        <span className="ml-auto text-fg-faint">
          {card.radar.checkedAt ? (
            <>
              Checked <RelativeTime value={card.radar.checkedAt} />
            </>
          ) : (
            'Not checked yet'
          )}
        </span>
      </div>
    </Card>
  )
}

/** A healthy app: one line with its icon, name and chips. */
export function PortfolioCompactRow({ card, favicon }: Omit<Props, 'showSpend'>) {
  const open = () => setActiveProjectIdSnapshot(card.projectId)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <ProjectFavicon {...favicon} size={20} className="shrink-0" />
      <Link to="/recipe" onClick={open} className="min-w-0 truncate text-sm font-medium text-fg hover:underline">
        {card.name}
      </Link>
      <span className="text-2xs text-fg-faint">{kindLabel(card)}</span>
      <div className="ml-auto flex flex-wrap gap-1.5">
        {cardStatusChips(card).map((chip) => (
          <StatusChip key={chip.key} chip={chip} onOpen={open} />
        ))}
      </div>
    </li>
  )
}
