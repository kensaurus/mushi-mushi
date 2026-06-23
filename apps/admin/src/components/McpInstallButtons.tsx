/**
 * FILE: apps/admin/src/components/McpInstallButtons.tsx
 * PURPOSE: Back-compat "Add to Cursor / VS Code" buttons used by McpPage.
 *
 * OVERVIEW:
 * - Thin wrapper around ClientConnectButton for the two original clients (Cursor
 *   and VS Code). Preserved so McpPage keeps working without any import changes.
 * - New surfaces (ConnectStudio, public docs) should use ClientConnectButton
 *   directly with the full MCP_CLIENTS registry.
 *
 * DEPENDENCIES:
 * - ClientConnectButton (registry-driven button)
 * - @mushi-mushi/mcp/clients (getMcpClient)
 * - apps/admin/src/lib/env (RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL)
 *
 * USAGE:
 *   <McpInstallButtons projectId="..." projectName="..." />
 */

import { getMcpClient } from '@mushi-mushi/mcp/clients'
import { ClientConnectButton } from './ClientConnectButton'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL } from '../lib/env'

interface Props {
  projectId: string
  projectName: string
  /** When true, renders smaller buttons suitable for a sidebar or list row. */
  compact?: boolean
}

export function McpInstallButtons({ projectId, projectName, compact = false }: Props) {
  const size = compact ? ('sm' as const) : ('md' as const)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ClientConnectButton
        client={getMcpClient('cursor')}
        projectId={projectId}
        projectName={projectName}
        endpoint={RESOLVED_EXTERNAL_API_URL}
        mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
        variant="primary"
        size={size}
      />
      <ClientConnectButton
        client={getMcpClient('vscode')}
        projectId={projectId}
        projectName={projectName}
        endpoint={RESOLVED_EXTERNAL_API_URL}
        mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
        variant="ghost"
        size={size}
      />
    </div>
  )
}
