/**
 * FILE: apps/admin/src/components/McpAccountKeyCard.tsx
 * PURPOSE: Mint an org-scoped (account-level) MCP key and install it in Cursor/VS Code
 *          with one click. The key grants access to ALL projects owned by the current
 *          user — equivalent to a Supabase Personal Access Token.
 *
 * Usage:
 *   <McpAccountKeyCard accountLabel="my-org" />
 */

import { useState } from 'react'
import { Btn, Tooltip } from './ui'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { buildCursorOrgDeeplink, buildVsCodeOrgDeeplink } from '../lib/cursorDeeplink'
import { RESOLVED_API_URL } from '../lib/env'

interface Props {
  /** A short label for the MCP server name — appears as `mushi-{label}` in Cursor's server list. */
  /** Label used as the server name; defaults to "account" */
  accountLabel?: string
  /** When true, renders smaller buttons suitable for a sidebar or list row. */
  compact?: boolean
}

type Ide = 'cursor' | 'vscode'

export function McpAccountKeyCard({ accountLabel = 'account', compact = false }: Props) {
  const toast = useToast()
  const [minting, setMinting] = useState<Ide | null>(null)

  async function openOrgDeeplink(ide: Ide, writeScope: boolean) {
    setMinting(ide)
    try {
      const res = await apiFetch<{ key: string }>('/v1/admin/mcp/mint-org-key', {
        method: 'POST',
        body: JSON.stringify({
          scopes: writeScope ? ['mcp:write'] : ['mcp:read'],
          label: `${accountLabel}-org-mcp`,
        }),
      })
      if (!res.ok || !res.data?.key) {
        toast.error('Key mint failed', 'Could not mint an account key. Check your plan limits.')
        return
      }
      const deeplink =
        ide === 'cursor'
          ? buildCursorOrgDeeplink(accountLabel, res.data.key, RESOLVED_API_URL)
          : buildVsCodeOrgDeeplink(accountLabel, res.data.key, RESOLVED_API_URL)
      window.open(deeplink, '_self')
      toast.success(
        `${ide === 'cursor' ? 'Cursor' : 'VS Code'} install launched`,
        `Server "mushi-${accountLabel}" gives access to all your projects.`,
      )
    } finally {
      setMinting(null)
    }
  }

  const size = compact ? ('sm' as const) : ('md' as const)

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Account key (all projects)</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          One server entry that covers every project you own. Use this when you work across multiple apps.
          Run{' '}
          <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">get_account_overview</code>
          {' '}in the MCP chat to see all projects at a glance.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content="Mint an org-scoped mcp:read key — no MUSHI_PROJECT_ID, accesses all your projects" side="top">
          <Btn
            size={size}
            variant="primary"
            loading={minting === 'cursor'}
            disabled={minting !== null}
            onClick={() => void openOrgDeeplink('cursor', false)}
            aria-label="Add account MCP server to Cursor"
          >
            ＋ Cursor (all projects)
          </Btn>
        </Tooltip>
        <Tooltip content="Same key, VS Code install" side="top">
          <Btn
            size={size}
            variant="ghost"
            loading={minting === 'vscode'}
            disabled={minting !== null}
            onClick={() => void openOrgDeeplink('vscode', false)}
            aria-label="Add account MCP server to VS Code"
          >
            ＋ VS Code (all projects)
          </Btn>
        </Tooltip>
      </div>
    </div>
  )
}
