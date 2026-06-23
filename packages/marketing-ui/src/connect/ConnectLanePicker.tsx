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
}: ConnectLanePickerProps) {
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
      </div>

      <div className="mushi-connect-lanes">
        <div role="tablist" aria-label="Setup method" className="mushi-connect-tablist">
          {CONNECT_LANE_OPTIONS.map((lane) => (
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

        <div
          role="tabpanel"
          aria-label={lanePanelLabel}
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

  if (!bordered) {
    return <div className={joinClasses('mushi-connect-root', className)}>{pickerBody}</div>
  }

  return (
    <div className={joinClasses('mushi-connect-root mushi-connect-card', className)}>
      {pickerBody}
    </div>
  )
}
