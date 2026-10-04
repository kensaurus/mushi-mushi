/**
 * FILE: apps/admin/src/components/McpAccountKeyCard.tsx
 * PURPOSE: Mint an org-scoped (account-level) MCP key and install it in Cursor/VS Code
 *          with one click. The key grants access to ALL projects owned by the current
 *          user — equivalent to a Supabase Personal Access Token.
 *
 * Usage:
 *   <McpAccountKeyCard accountLabel="my-org" />
 */

import { useRef, useState } from 'react'
import { Btn, Tooltip } from './ui'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { buildCursorOrgDeeplink, buildVsCodeOrgDeeplink } from '../lib/cursorDeeplink'
import { RESOLVED_EXTERNAL_API_URL } from '../lib/env'
import { describeActionError } from '../lib/actionError'

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
  // One account key per page visit, shared by both buttons: each click used
  // to mint another key while the tooltip said "Same key" (QA bug 126).
  const mintedKey = useRef<string | null>(null)

  async function openOrgDeeplink(ide: Ide, writeScope: boolean) {
    setMinting(ide)
    try {
      if (!mintedKey.current) {
        const res = await apiFetch<{ key: string }>('/v1/admin/mcp/mint-org-key', {
          method: 'POST',
          body: JSON.stringify({
            scopes: writeScope ? ['mcp:write'] : ['mcp:read'],
            label: `${accountLabel}-org-mcp`,
          }),
          idempotencyKey: crypto.randomUUID(),
        })
        if (!res.ok || !res.data?.key) {
          // The real reason (e.g. "Create a project before minting an account key."), not "plan limits".
          toast.error('Could not create an account key', describeActionError(res.error, 'Try again in a moment.'))
          return
        }
        mintedKey.current = res.data.key
      }
      const key = mintedKey.current
      const deeplink =
        ide === 'cursor'
          ? buildCursorOrgDeeplink(accountLabel, key, RESOLVED_EXTERNAL_API_URL)
          : buildVsCodeOrgDeeplink(accountLabel, key, RESOLVED_EXTERNAL_API_URL)
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
    <div className="rounded-lg border border-edge-subtle p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-fg">Account key (all projects)</p>
        <p className="text-xs text-fg-muted mt-0.5">
          One server entry that covers every project you can open. Use this when you work across multiple apps.
          Run{' '}
          <code className="font-mono bg-surface-raised text-fg px-1 rounded">get_account_overview</code>
          {' '}in the MCP chat to see all projects at a glance.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content="Creates one read-only account key (no MUSHI_PROJECT_ID) that reaches every project you can open" side="top">
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
        <Tooltip content="Same account key as the Cursor button, installed in VS Code" side="top">
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
