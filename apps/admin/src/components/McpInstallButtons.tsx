/**
 * FILE: apps/admin/src/components/McpInstallButtons.tsx
 * PURPOSE: Reusable "Add to Cursor / VS Code" deeplink buttons extracted from
 *          McpPage so the ConnectPage hub and any future surface can provide
 *          the same one-click MCP install without copy-pasting the logic.
 *
 * Usage:
 *   <McpInstallButtons projectId="..." projectName="..." />
 */

import { useState } from 'react'
import { Btn, Tooltip } from './ui'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { buildCursorDeeplink, buildVsCodeDeeplink, projectServerName } from '../lib/cursorDeeplink'
import { RESOLVED_MCP_HTTP_URL } from '../lib/env'

const MUSHI_CLOUD_API =
  typeof RESOLVED_MCP_HTTP_URL !== 'undefined' ? RESOLVED_MCP_HTTP_URL : ''

async function mintMcpKey(
  scopes: string[],
  projectId: string,
): Promise<string | null> {
  const res = await apiFetch<{ key: string }>('/v1/admin/mcp/mint-key', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, scopes }),
  })
  if (!res.ok || !res.data?.key) return null
  return res.data.key
}

interface Props {
  projectId: string
  projectName: string
  /** When true, renders smaller buttons suitable for a sidebar or list row. */
  compact?: boolean
}

export function McpInstallButtons({ projectId, projectName, compact = false }: Props) {
  const toast = useToast()
  const [mintingIde, setMintingIde] = useState<'cursor' | 'vscode' | null>(null)

  async function openDeeplink(ide: 'cursor' | 'vscode', writeScope: boolean) {
    setMintingIde(ide)
    try {
      const key = await mintMcpKey(writeScope ? ['mcp:write'] : ['mcp:read'], projectId)
      if (!key) {
        toast.error('Key mint failed', 'Could not mint an MCP key — check your plan limits.')
        return
      }
      const deeplink =
        ide === 'cursor'
          ? buildCursorDeeplink(projectId, projectName, key, MUSHI_CLOUD_API)
          : buildVsCodeDeeplink(projectId, projectName, key, MUSHI_CLOUD_API)
      window.open(deeplink, '_self')
      toast.success(
        `${ide === 'cursor' ? 'Cursor' : 'VS Code'} install launched`,
        `Server "${projectServerName(projectId, projectName)}" has been configured.`,
      )
    } finally {
      setMintingIde(null)
    }
  }

  const size = compact ? ('sm' as const) : ('md' as const)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip
        content={`Mint a mcp:read key and open Cursor's install dialog — no copy-paste needed`}
        side="top"
      >
        <Btn
          size={size}
          variant="primary"
          loading={mintingIde === 'cursor'}
          disabled={mintingIde !== null}
          onClick={() => void openDeeplink('cursor', false)}
          aria-label="Add MCP server to Cursor"
        >
          ⚡ Add to Cursor
        </Btn>
      </Tooltip>
      <Tooltip
        content="Mint a mcp:read key and open VS Code's MCP extension install dialog"
        side="top"
      >
        <Btn
          size={size}
          variant="ghost"
          loading={mintingIde === 'vscode'}
          disabled={mintingIde !== null}
          onClick={() => void openDeeplink('vscode', false)}
          aria-label="Add MCP server to VS Code"
        >
          Add to VS Code
        </Btn>
      </Tooltip>
    </div>
  )
}
