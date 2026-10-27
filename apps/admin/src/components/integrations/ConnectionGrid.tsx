/**
 * FILE: apps/admin/src/components/integrations/ConnectionGrid.tsx
 * PURPOSE: Top of Integrations: one status sentence with the fix for the
 *          first broken connection, a grid of the six tools (logo, state dot,
 *          last event), and one "needs you" line per broken connection. Each
 *          tile jumps to its card below. The verdicts come from
 *          connectionGrid.ts, which reuses each card's own rules.
 */

import { BrandIcon } from '../ui/BrandIcon'
import { Btn, PageStatus, RelativeTime } from '../ui'
import type { ConnectionState } from '../ui/ConnectionStatus'
import { usePageData } from '../../lib/usePageData'
import type { InboundDeliveryLike } from '../../lib/integrationConnection'
import { sentryConfiguredFromPlatform } from '../../lib/useSentryConnection'
import {
  brokenConnections,
  buildConnectionGrid,
  connectionGridSentence,
  type ConnectionGridInput,
  type GridTile,
} from './connectionGrid'

const DOT: Record<ConnectionState, string> = {
  working: 'bg-ok',
  attention: 'bg-warn',
  expiring: 'bg-warn',
  checking: 'bg-info',
  not_connected: 'bg-fg-faint',
}

const STATE_WORD: Record<ConnectionState, string> = {
  working: 'Working',
  attention: 'Needs you',
  expiring: 'Expiring',
  checking: 'Not tested yet',
  not_connected: 'Not connected',
}

/** Scroll to a card and put its id in the address bar, without a router navigation. */
function jumpTo(anchor: string) {
  const el = document.getElementById(anchor)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  try {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${anchor}`)
  } catch {
    // History blocked (sandboxed preview): the scroll still happened.
  }
}

type ConnectionGridProps = Omit<ConnectionGridInput, 'sentryDeliveries' | 'sentryDeliveriesFailed'>

export function ConnectionGrid(props: ConnectionGridProps) {
  // The same request the Sentry card makes (cached), only once Sentry is set up.
  const sentryConfigured = sentryConfiguredFromPlatform(props.platform)
  const deliveries = usePageData<{ deliveries?: InboundDeliveryLike[] }>(
    sentryConfigured ? '/v1/admin/integrations/inbound-deliveries?source=sentry' : null,
  )
  const tiles = buildConnectionGrid({
    ...props,
    sentryDeliveries: sentryConfigured ? (deliveries.data?.deliveries ?? null) : [],
    sentryDeliveriesFailed: Boolean(deliveries.error),
  })
  const broken = brokenConnections(tiles)
  const { sentence, tone } = connectionGridSentence(tiles)
  const first = broken[0]

  return (
    <section aria-label="Connections" className="space-y-2" data-testid="integrations-connection-grid">
      <PageStatus
        sentence={sentence}
        tone={tone}
        ariaLabel="Connection status"
        action={
          first ? (
            <Btn size="sm" variant="primary" onClick={() => jumpTo(first.anchor)}>
              Fix {first.label}
            </Btn>
          ) : null
        }
      />
      <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <ConnectionTile key={tile.id} tile={tile} />
        ))}
      </ul>
      {broken.length > 0 ? (
        <ul aria-label="Connections that need you" className="space-y-1">
          {broken.map((tile) => (
            <li key={tile.id} className="flex min-w-0 items-start gap-2 text-xs text-fg-secondary">
              <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tile.view.state]}`} />
              <span className="min-w-0 flex-1 text-pretty">
                <strong className="font-medium text-fg">{tile.label}:</strong> {tile.view.detail ?? 'Open its card for the fix.'}
              </span>
              <button
                type="button"
                onClick={() => jumpTo(tile.anchor)}
                className="shrink-0 text-2xs font-medium text-accent-foreground underline underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
              >
                Fix →
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ConnectionTile({ tile }: { tile: GridTile }) {
  const state = tile.view.state
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => jumpTo(tile.anchor)}
        aria-label={`${tile.label}: ${STATE_WORD[state]}. Open its card.`}
        data-state={state}
        className="flex h-full w-full min-w-0 flex-col gap-1.5 rounded-md border border-edge-subtle bg-surface-raised px-3 py-2.5 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <BrandIcon brand={tile.brand} size={16} decorative />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{tile.label}</span>
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[state]}`} />
        </span>
        <span className={`text-2xs ${state === 'attention' || state === 'expiring' ? 'text-warn' : 'text-fg-muted'}`}>{STATE_WORD[state]}</span>
        <span className="text-3xs text-fg-faint">
          {tile.lastAt && tile.lastLabel ? (
            <>
              {tile.lastLabel} <RelativeTime value={tile.lastAt} />
            </>
          ) : state === 'not_connected' ? (
            'Set it up below'
          ) : (
            'Nothing yet'
          )}
        </span>
      </button>
    </li>
  )
}
