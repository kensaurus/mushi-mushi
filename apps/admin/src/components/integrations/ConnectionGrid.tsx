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
 *          Shapes carry every state beside its colour (StatusGlyph): ● working,
 *          ◆ needs you, ■ not tested yet, ○ not connected.
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
import { StatusGlyph, TONE_INK, type SignalTone } from '../signal/StatusGlyph'
import {
  brokenConnections,
  buildConnectionGrid,
  connectionGridSentence,
  type ConnectionGridInput,
  type GridToolId,
  type GridTile,
} from './connectionGridModel'

/** A connection state's shape tone (also the page drawer's header). */
export const CONNECTION_TONE: Record<ConnectionState, SignalTone> = {
  working: 'ok',
  attention: 'warn',
  expiring: 'warn',
  checking: 'info',
  not_connected: 'off',
}

/** A connection state in words. */
export const CONNECTION_WORD: Record<ConnectionState, string> = {
  working: 'Working',
  attention: 'Needs you',
  expiring: 'Expiring',
  checking: 'Not tested yet',
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
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

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

/** @internal One group of tiles (exported for tests; the page passes them inline). */
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
}: {
  tiles: readonly GridTile[]
  groups: readonly ConnectionGroup[]
  /** Open the tool's settings. */
  onOpen: (id: GridToolId) => void
  /** Start setting the tool up (opens its settings ready to fill in). */
  onConnect: (id: GridToolId) => void
}) {
  const broken = brokenConnections(tiles)
  const { sentence, tone } = connectionGridSentence(tiles)
  const first = broken[0]
  // One broken connection: its reason goes in the sentence. With more, each
  // gets an alert card with its own Fix, so the sentence only names them.
  const lead = broken.length === 1 && first.view.detail ? `${first.label} needs you: ${first.view.detail}` : sentence
  const alerts: SignalAlert[] =
    broken.length > 1
      ? broken.map((t) => ({
          id: t.id,
          severity: 'serious',
          label: t.view.label ?? CONNECTION_WORD[t.view.state],
          title: `${t.label} needs you`,
          detail: t.view.detail ?? 'Open its settings for the fix.',
          metric: ageMetric(t.lastAt),
          action: { label: `Fix ${t.label}`, onClick: () => onOpen(t.id) },
        }))
      : []
  const byId = new Map(tiles.map((t) => [t.id, t]))

  return (
    <section aria-label="Connections" className="space-y-3" data-testid="integrations-connection-grid">
      <PageStatus
        sentence={lead}
        tone={tone}
        ariaLabel="Connection status"
        action={
          broken.length === 1 ? (
            <Btn size="sm" variant="primary" onClick={() => onOpen(first.id)}>
              Fix {first.label}
            </Btn>
          ) : null
        }
      />
      {alerts.length > 0 && (
        <HighlightProvider>
          <AlertCards alerts={alerts} emptyText={null} label="Connections that need you" testIdPrefix="integrations" />
        </HighlightProvider>
      )}
      {/* Groups sit side by side while they fit, so the whole picture is one screen. */}
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        {groups.map((g, gi) => {
          const groupTiles = g.tools.map((id) => byId.get(id)).filter((t): t is GridTile => Boolean(t))
          if (groupTiles.length === 0) return null
          return (
            <div key={gi} id={g.id} className="flex min-w-64 max-w-full flex-col scroll-mt-chrome" data-testid="integrations-group">
              {g.heading}
              {g.lede ? <p className="-mt-1 mb-2 w-0 min-w-full text-2xs leading-snug text-fg-secondary">{g.lede}</p> : null}
              <ul className="flex flex-wrap gap-2">
                {groupTiles.map((tile, i) => (
                  <ConnectionTile key={tile.id} tile={tile} index={i} onOpen={onOpen} onConnect={onConnect} />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ConnectionTile({
  tile,
  index,
  onOpen,
  onConnect,
}: {
  tile: GridTile
  index: number
  onOpen: (id: GridToolId) => void
  onConnect: (id: GridToolId) => void
}) {
  const state = tile.view.state
  const tone = CONNECTION_TONE[state]
  const word = tile.view.label ?? CONNECTION_WORD[state]
  return (
    // The open target and Connect are siblings: a button never sits inside a button.
    <li
      className={`ci-rise flex w-40 min-w-0 flex-col overflow-hidden rounded-md border motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-px ${TILE_BOX[state]}`}
      style={{ animationDelay: `${index * 40}ms` }}
      data-testid={`integration-tile-${tile.id}`}
    >
      <button
        type="button"
        onClick={() => onOpen(tile.id)}
        aria-label={`${tile.label}: ${word}. Open its settings.`}
        data-state={state}
        title={tile.view.detail ?? undefined}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <BrandIcon brand={tile.brand} size={16} decorative />
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-fg">{tile.label}</span>
          <StatusGlyph tone={tone} />
        </span>
        <span className={`truncate text-3xs font-bold tracking-wider uppercase ${TONE_INK[tone]}`}>{word}</span>
        {state !== 'not_connected' && (
          <span className="truncate text-3xs text-fg-secondary">
            {tile.lastAt && tile.lastLabel ? (
              <>
                {tile.lastLabel} <RelativeTime value={tile.lastAt} />
              </>
            ) : (
              'Nothing yet'
            )}
          </span>
        )}
      </button>
      {state === 'not_connected' && (
        <span className="px-2.5 pb-2">
          <button type="button" className={CONNECT} onClick={() => onConnect(tile.id)} aria-label={`Connect ${tile.label}`}>
            Connect
          </button>
        </span>
      )}
    </li>
  )
}
