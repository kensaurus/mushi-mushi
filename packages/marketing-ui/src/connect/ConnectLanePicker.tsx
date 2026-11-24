/**
 * FILE: connect/ConnectLanePicker.tsx
 * PURPOSE: Shared client picker + three-lane setup shell for Connect surfaces.
 *
 * OVERVIEW:
 * - Renders 9-client chip row and MCP / CLI / Skills lane tabs.
 * - Lane body is supplied by the host via `renderLane`.
 * - Styling uses `--mushi-*` editorial tokens (see styles.css).
 *
 * USAGE:
 * - Admin ConnectStudio: real key mint via renderLane('mcp', …).
 * - Docs /connect: placeholder keys + console CTA in renderLane.
 */

import type { ReactNode } from 'react'
import type { McpClientDef, McpClientId } from '@mushi-mushi/mcp/clients'
import { CONNECT_LANE_OPTIONS, type ConnectLane } from './types'
import { getConnectClientEmoji } from './clientEmoji'

export interface ConnectLanePickerProps {
  clients: readonly McpClientDef[]
  selectedId: McpClientId
  onSelectClient: (id: McpClientId) => void
  activeLane: ConnectLane
  onLaneChange: (lane: ConnectLane) => void
  renderLane: (lane: ConnectLane, client: McpClientDef) => ReactNode
  /** Override default emoji chip icon (admin uses SVG icons). */
  renderClientIcon?: (id: McpClientId) => ReactNode
  clientSectionLabel?: string
  className?: string
  /** When true, wraps picker + panel in a bordered card shell (docs default). */
  bordered?: boolean
  /**
   * `editorial` — docs/marketing `--mushi-vermillion` accents (default).
   * `operator` — admin console maps selections to `@theme` brand micro-indicators.
   */
  surface?: 'editorial' | 'operator'
  /**
   * The lanes offered as tabs; default all three. With one lane the panel
   * renders without a tab row (the admin console leads with MCP and offers
   * CLI and Skills as its own secondary disclosure, ADR 0069).
   */
  lanes?: readonly ConnectLane[]
  /** Rendered after the client chips, e.g. an "Other editors" toggle. */
  afterClients?: ReactNode
}

function joinClasses(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function DefaultClientChip({
  client,
  selected,
  onClick,
  icon,
}: {
  client: McpClientDef
  selected: boolean
  onClick: () => void
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={joinClasses(
        'mushi-connect-chip',
        selected && 'mushi-connect-chip--selected',
      )}
    >
      <span className="mushi-connect-chip-icon" aria-hidden>
        {icon}
      </span>
      <span>{client.label}</span>
    </button>
  )
}

export function ConnectLanePicker({
  clients,
  selectedId,
  onSelectClient,
  activeLane,
  onLaneChange,
  renderLane,
  renderClientIcon,
  clientSectionLabel = 'Your AI client',
  className,
  bordered = true,
  surface = 'editorial',
  lanes,
  afterClients,
}: ConnectLanePickerProps) {
  const laneOptions = lanes ? CONNECT_LANE_OPTIONS.filter((o) => lanes.includes(o.id)) : CONNECT_LANE_OPTIONS
  const singleLane = laneOptions.length === 1
  const lanePanelLabel =
    CONNECT_LANE_OPTIONS.find((o) => o.id === activeLane)?.label ?? 'Setup'

  const pickerBody = (
    <>
      <div className="mushi-connect-clients">
        <p className="mushi-connect-section-label">{clientSectionLabel}</p>
        <div
          role="radiogroup"
          aria-label="Select your AI coding client"
          className="mushi-connect-chip-row"
        >
          {clients.map((c) => (
            <DefaultClientChip
              key={c.id}
              client={c}
              selected={c.id === selectedId}
              onClick={() => onSelectClient(c.id)}
              icon={
                renderClientIcon?.(c.id) ?? (
                  <span>{getConnectClientEmoji(c.id)}</span>
                )
              }
            />
          ))}
        </div>
        {afterClients}
      </div>

      <div className="mushi-connect-lanes">
        {singleLane ? null : (
        <div role="tablist" aria-label="Setup method" className="mushi-connect-tablist">
          {laneOptions.map((lane) => (
            <button
              key={lane.id}
              type="button"
              role="tab"
              aria-selected={activeLane === lane.id}
              onClick={() => onLaneChange(lane.id)}
              className={joinClasses(
                'mushi-connect-tab',
                activeLane === lane.id && 'mushi-connect-tab--selected',
              )}
            >
              {lane.label}
            </button>
          ))}
        </div>
        )}

        <div
          role={singleLane ? undefined : 'tabpanel'}
          aria-label={singleLane ? undefined : lanePanelLabel}
          className="mushi-connect-panel"
        >
          {renderLane(
            activeLane,
            clients.find((c) => c.id === selectedId) ?? clients[0]!,
          )}
        </div>
      </div>
    </>
  )

  const rootClass = joinClasses(
    'mushi-connect-root',
    bordered && 'mushi-connect-card',
    className,
  )
  const surfaceAttr = surface === 'operator' ? 'operator' : undefined

  return (
    <div className={rootClass} data-connect-surface={surfaceAttr}>
      {pickerBody}
    </div>
  )
}
