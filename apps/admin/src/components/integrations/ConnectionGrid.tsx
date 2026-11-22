/**
 * FILE: apps/admin/src/components/integrations/ConnectionGrid.tsx
 * PURPOSE: Integrations IS this grid (owner, 2026-11-18: "the tile grid becomes
 *          the page"). One status sentence with the fix for the first broken
 *          connection; when more than one is broken, an alert card each, worst
 *          first; then every tool as a small tile, grouped the way a solo
 *          builder wires them (code, alerts, fix agent, trackers, monitoring).
 *          A tile opens that tool's settings (the page's drawer); a tile that
 *          is not set up has its own Connect button beside it, never "Set it up
 *          below". The verdicts come from connectionGridModel.ts, which reuses
 *          each card's own rules.
 *
 *          Every state is a StatusMark (colour plus glyph): ✓ checked and
 *          working, ✕ needs you, ⧗ expiring, ◷ still loading, ○ not connected
 *          or connected and never checked (with a "Check now" beside it). A
 *          green ✓ only means a check ran and passed (round-2 review
 *          2026-11-18: "✓ NOT CHECKED" on the GitHub tile).
 */

import type { ReactNode } from 'react'
import { BrandIcon } from '../ui/BrandIcon'
import { Btn, PageStatus, RelativeTime } from '../ui'
import type { ConnectionState } from '../ui/ConnectionStatus'
import { usePageData } from '../../lib/usePageData'
import type { InboundDeliveryLike } from '../../lib/integrationConnection'
import { sentryConfiguredFromPlatform } from '../../lib/useSentryConnection'
import { AlertCards, type SignalAlert } from '../signal/AlertCards'
import { HighlightProvider } from '../signal/linkedHighlight'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
import { StatusGlyph } from '../signal/StatusGlyph'
import {
  alertChannelGap,
  brokenConnections,
  buildConnectionGrid,
  connectionGridSentence,
  connectionTally,
  type ConnectionGridInput,
  type GridToolId,
  type GridTile,
} from './connectionGridModel'

const CONNECTION_STATUS: Record<ConnectionState, RunStatus> = {
  working: 'passed',
  attention: 'failed',
  expiring: 'slow',
  // Still loading (Slack settings, Sentry deliveries). Set up and never
  // checked is relabelled in the model and reads as connected below.
  checking: 'waiting',
  not_connected: 'idle',
}

/** A tile's status mark (also the page drawer's header). Never checked is hollow ○, never ✓. */
export function tileRunStatus(tile: Pick<GridTile, 'view' | 'neverChecked'>): RunStatus {
  return tile.neverChecked ? 'idle' : CONNECTION_STATUS[tile.view.state]
}

/** A connection state in words. */
export const CONNECTION_WORD: Record<ConnectionState, string> = {
  working: 'Working',
  attention: 'Needs you',
  expiring: 'Expiring',
  checking: 'Checking',
  not_connected: 'Not connected',
}

const TILE_BOX: Record<ConnectionState, string> = {
  working: 'border-edge bg-surface-raised',
  checking: 'border-edge bg-surface-raised',
  attention: 'border-warn/55 bg-warn-muted',
  expiring: 'border-warn/55 bg-warn-muted',
  not_connected: 'border-dashed border-edge-subtle bg-surface',
}

const CONNECT =
  'inline-flex h-6 items-center rounded-sm border border-edge bg-surface-raised px-2 text-2xs font-semibold text-fg ' +
  'motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-px hover:border-accent hover:text-accent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'

/** "12 min ago", "5 h ago", "3 d ago" as the alert card's big number. */
function ageMetric(iso: string | null, now = Date.now()): { value: string; unit: string } {
  const at = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(at)) return { value: '—', unit: 'never checked' }
  const min = Math.max(0, Math.round((now - at) / 60_000))
  if (min < 60) return { value: String(min), unit: 'min since check' }
  const h = Math.round(min / 60)
  if (h < 48) return { value: String(h), unit: 'h since check' }
  return { value: String(Math.round(h / 24)), unit: 'd since check' }
}

/** One group of tiles. */
export interface ConnectionGroup {
  /** Anchor id on the group, for links that point at a whole section. */
  id?: string
  /** The group's heading (a PanelSectionLabel). */
  heading: ReactNode
  /** One plain line under the heading. */
  lede?: ReactNode
  tools: readonly GridToolId[]
}

/** The tiles for the page, with the Sentry deliveries the Sentry card also reads (cached). */
export function useConnectionTiles(props: Omit<ConnectionGridInput, 'sentryDeliveries' | 'sentryDeliveriesFailed'>): GridTile[] {
  const sentryConfigured = sentryConfiguredFromPlatform(props.platform)
  const deliveries = usePageData<{ deliveries?: InboundDeliveryLike[] }>(
    sentryConfigured ? '/v1/admin/integrations/inbound-deliveries?source=sentry' : null,
  )
  return buildConnectionGrid({
    ...props,
    sentryDeliveries: sentryConfigured ? (deliveries.data?.deliveries ?? null) : [],
    sentryDeliveriesFailed: Boolean(deliveries.error),
  })
}

export function ConnectionGrid({
  tiles,
  groups,
  onOpen,
  onConnect,
  onCheck,
  checkingId = null,
  alertEventsOn = null,
}: {
  tiles: readonly GridTile[]
  groups: readonly ConnectionGroup[]
  /** Open the tool's settings. */
  onOpen: (id: GridToolId) => void
  /** Start setting the tool up (opens its settings ready to fill in). */
  onConnect: (id: GridToolId) => void
  /** Run the tool's read-only check (a connected tool nobody has checked yet). */
  onCheck?: (tile: GridTile) => void
  /** The tool whose check is running now. */
  checkingId?: GridToolId | null
  /** Alert events switched on (null while the prefs load). With no channel connected they go nowhere. */
  alertEventsOn?: number | null
}) {
  const broken = brokenConnections(tiles)
  const { sentence, tone } = connectionGridSentence(tiles)
  const first = broken[0]
  // One broken connection: its reason goes in the sentence. With more, each
  // gets an alert card with its own Fix, so the sentence only names them.
  const tally = connectionTally(tiles)
  const gap = alertChannelGap(tiles, alertEventsOn)
  const gapText = `No alert channel: ${alertEventsOn ?? 0} alert ${alertEventsOn === 1 ? 'event goes' : 'events go'} nowhere`
  const showTally = broken.length === 0 && !gap && tally.working + tally.unchecked > 0
  // Nothing broken: the counts as marks, not a sentence. The status row's own
  // dot is the first mark (green when something works), so the tally never
  // draws a second dot beside it ("● ● 1 working", round-2 review).
  const lead: ReactNode =
    broken.length === 1 && first.view.detail ? (
      `${first.label} needs you: ${first.view.detail}`
    ) : broken.length === 0 && gap ? (
      <span data-testid="integrations-channel-gap">{gapText}</span>
    ) : showTally ? (
      <span className="inline-flex flex-wrap items-center gap-x-1.5" data-testid="integrations-tally">
        {tally.working > 0 && <span>{tally.working} working</span>}
        {tally.working > 0 && tally.unchecked > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <StatusGlyph tone="off" />
          </>
        )}
        {tally.unchecked > 0 && <span>{tally.unchecked} not checked</span>}
      </span>
    ) : (
      sentence
    )
  const leadTone = broken.length === 0 && gap ? 'warn' : showTally ? (tally.working > 0 ? 'ok' : 'neutral') : tone
  const gapAlert: SignalAlert = {
    id: 'alert-channel-gap',
    severity: 'serious',
    label: 'No channel',
    title: gapText,
    detail: 'Slack, Discord and Teams are all not connected. One channel is enough.',
    metric: { value: String(alertEventsOn ?? 0), unit: 'events on' },
    action: { label: 'Connect Slack', onClick: () => onConnect('slack') },
  }
  const alerts: SignalAlert[] = [
    ...(broken.length > 1
      ? broken.map((t): SignalAlert => ({
          id: t.id,
          severity: 'serious',
          label: t.view.label ?? CONNECTION_WORD[t.view.state],
          title: `${t.label} needs you`,
          detail: t.view.detail ?? 'Open its settings for the fix.',
          metric: ageMetric(t.lastAt),
          action: { label: `Fix ${t.label}`, onClick: () => onOpen(t.id) },
        }))
      : []),
    // With a broken tool leading the status row, the gap gets its own card.
    ...(gap && broken.length > 0 ? [gapAlert] : []),
  ]
  const byId = new Map(tiles.map((t) => [t.id, t]))

  return (
    <section aria-label="Connections" className="space-y-3" data-testid="integrations-connection-grid">
      <PageStatus
        sentence={lead}
        tone={leadTone}
        ariaLabel="Connection status"
        action={
          broken.length === 1 ? (
            <Btn size="sm" variant="primary" onClick={() => onOpen(first.id)}>
              Fix {first.label}
            </Btn>
          ) : broken.length === 0 && gap ? (
            <Btn size="sm" variant="primary" onClick={() => onConnect('slack')} data-testid="integrations-channel-gap-connect">
              Connect Slack
            </Btn>
          ) : null
        }
      />
      {alerts.length > 0 && (
        <HighlightProvider>
          <AlertCards alerts={alerts} emptyText={null} label="Connections that need you" testIdPrefix="integrations" />
        </HighlightProvider>
      )}
      {/* Groups sit on one grid, so every heading starts on a shared column line
          (a wrapping flex row left ERRORS at a different x than FIX AGENT). */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g, gi) => {
          const groupTiles = g.tools.map((id) => byId.get(id)).filter((t): t is GridTile => Boolean(t))
          if (groupTiles.length === 0) return null
          // Connected tools are tiles; the ones not set up share one compact
          // row of logo + Connect chips (ten identical dashed cards before).
          const live = groupTiles.filter((t) => t.view.state !== 'not_connected')
          const off = groupTiles.filter((t) => t.view.state === 'not_connected')
          const lone = groupTiles.length === 1
          return (
            <div
              key={gi}
              id={g.id}
              className="flex min-w-0 max-w-full flex-col scroll-mt-chrome"
              data-testid="integrations-group"
            >
              {g.heading}
              {g.lede ? <p className="-mt-1 mb-2 w-0 min-w-full text-2xs leading-snug text-fg-secondary">{g.lede}</p> : null}
              {live.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {live.map((tile, i) => (
                    <ConnectionTile
                      key={tile.id}
                      tile={tile}
                      index={i}
                      lone={lone}
                      onOpen={onOpen}
                      onCheck={onCheck}
                      checkRunning={checkingId === tile.id}
                    />
                  ))}
                </ul>
              )}
              {off.length > 0 && (
                <ul
                  className={`flex flex-wrap gap-1.5 ${live.length > 0 ? 'mt-2' : ''}`}
                  aria-label={`Not connected: ${off.map((t) => t.label).join(', ')}`}
                >
                  {off.map((tile) => (
                    <OffChip key={tile.id} tile={tile} onOpen={onOpen} onConnect={onConnect} />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** A tool that is not set up: logo, name and its own Connect, on one line. */
function OffChip({
  tile,
  onOpen,
  onConnect,
}: {
  tile: GridTile
  onOpen: (id: GridToolId) => void
  onConnect: (id: GridToolId) => void
}) {
  const word = tile.view.label ?? CONNECTION_WORD.not_connected
  return (
    // The open target and Connect are siblings: a button never sits inside a button.
    // No box round the pair: Connect is the only bordered thing (a button in a dashed chip read as chip-in-chip).
    <li
      className="inline-flex h-7 min-w-0 items-center gap-1.5 whitespace-nowrap pr-1"
      data-testid={`integration-tile-${tile.id}`}
    >
      <button
        type="button"
        onClick={() => onOpen(tile.id)}
        aria-label={`${tile.label}: ${word}. Open its settings.`}
        data-state={tile.view.state}
        data-status="idle"
        title={word}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-sm text-xs text-fg-secondary hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {/* No hollow mark: it read as a radio button, and Connect beside it says it (2026-11-19). */}
        <BrandIcon brand={tile.brand} size={14} decorative />
        <span className="truncate font-semibold">{tile.label}</span>
      </button>
      <button type="button" className={`${CONNECT} !h-5 !px-1.5`} onClick={() => onConnect(tile.id)} aria-label={`Connect ${tile.label}`}>
        Connect
      </button>
    </li>
  )
}

function ConnectionTile({
  tile,
  index,
  lone = false,
  onOpen,
  onCheck,
  checkRunning,
}: {
  tile: GridTile
  index: number
  /** The group's only tool: the tile takes the row on a phone. */
  lone?: boolean
  onOpen: (id: GridToolId) => void
  onCheck?: (tile: GridTile) => void
  checkRunning: boolean
}) {
  const state = tile.view.state
  const status: RunStatus = checkRunning ? 'running' : tileRunStatus(tile)
  const fullWord = checkRunning ? 'Checking now…' : (tile.view.label ?? CONNECTION_WORD[state])
  // "Connected · not checked yet" truncated to "CONNECTED · NOT …": the tile
  // shows the short word, the full one is its tooltip.
  const word = !checkRunning && tile.neverChecked ? 'Not checked' : fullWord
  const canCheck = Boolean(tile.neverChecked && tile.checkKind && onCheck)
  return (
    // The open target and Check now are siblings: a button never sits inside a button.
    <li
      className={`ci-rise flex min-w-0 flex-col overflow-hidden rounded-md border motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-px ${lone ? 'w-full sm:w-44' : 'w-40'} ${TILE_BOX[state]}`}
      style={{ animationDelay: `${index * 40}ms` }}
      data-testid={`integration-tile-${tile.id}`}
    >
      <button
        type="button"
        onClick={() => onOpen(tile.id)}
        aria-label={`${tile.label}: ${fullWord}. Open its settings.`}
        data-state={state}
        data-status={status}
        title={tile.view.detail ?? (word !== fullWord ? fullWord : undefined)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <BrandIcon brand={tile.brand} size={16} decorative />
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-fg">{tile.label}</span>
        </span>
        {/* The state is one pill (mark + word), not a mark plus a separate uppercase caption. */}
        <span className="flex min-w-0">
          <StatusPill status={status} label={word} className="max-w-full truncate" />
        </span>
        {tile.lastAt && tile.lastLabel && state !== 'not_connected' ? (
          <span className="truncate text-3xs text-fg-secondary">
            {tile.lastLabel} <RelativeTime value={tile.lastAt} />
          </span>
        ) : null}
      </button>
      {canCheck && (
        <span className="px-2.5 pb-2">
          <button
            type="button"
            className={CONNECT}
            onClick={() => onCheck!(tile)}
            disabled={checkRunning}
            aria-label={`Check ${tile.label} now`}
            data-testid={`integration-check-${tile.id}`}
          >
            {checkRunning ? 'Checking…' : 'Check now'}
          </button>
        </span>
      )}
    </li>
  )
}
