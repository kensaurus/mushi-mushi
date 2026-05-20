/**
 * FILE: apps/admin/src/components/mcp/McpStatusBanner.tsx
 * PURPOSE: Top-level MCP readiness summary for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { McpStats } from './types'

interface Props {
  stats: McpStats
  projectName: string | null
}

export function McpStatusBanner({ stats, projectName }: Props) {
  if (stats.endpointMismatch) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">MCP key talking to a different backend</p>
            <p className="text-2xs text-fg-muted">
              Last heartbeat hit{' '}
              <span className="font-mono text-fg-secondary">{stats.lastSeenEndpointHost}</span> — check{' '}
              <span className="font-mono text-fg-secondary">MUSHI_API_ENDPOINT</span> in your snippet.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (stats.mcpReadKeyCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {projectName ? `No MCP keys for ${projectName} yet` : 'No MCP keys yet'}
            </p>
            <p className="text-2xs text-fg-muted">
              Generate an <span className="font-mono text-fg-secondary">mcp:read</span> key on /projects, paste the
              snippet below, then ask your agent to list Mushi tools.
            </p>
          </div>
        </div>
        <Link to="/projects">
          <Btn size="sm" variant="ghost">Generate key</Btn>
        </Link>
      </div>
    )
  }

  if (stats.neverConnectedCount > 0 && stats.connectedKeyCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.neverConnectedCount} MCP key{stats.neverConnectedCount === 1 ? '' : 's'} minted but never connected
            </p>
            <p className="text-2xs text-fg-muted">
              Copy the <span className="font-mono text-fg-secondary">.cursor/mcp.json</span> block, restart your IDE,
              then run <span className="font-mono text-fg-secondary">list mushi tools</span> to confirm the handshake.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (stats.connectedKeyCount > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
          <div>
            <p className="text-xs font-medium text-ok">Agent access live</p>
            <p className="text-2xs text-fg-muted">
              {stats.mcpReadKeyCount} read · {stats.mcpWriteKeyCount} write · {stats.connectedKeyCount} connected
              {projectName ? ` · ${projectName}` : ''}
            </p>
          </div>
        </div>
        {stats.lastSeenAt && (
          <span className="font-mono text-3xs text-fg-faint shrink-0">
            Last heartbeat {new Date(stats.lastSeenAt).toLocaleString()}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-edge-subtle bg-surface-raised/40 px-3 py-2.5">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
      <p className="text-2xs text-fg-muted">
        MCP keys exist — finish pasting the snippet and restart your IDE to complete setup.
      </p>
    </div>
  )
}
