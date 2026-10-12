/**
 * FILE: apps/admin/src/components/mcp/McpAccountKeysList.tsx
 * PURPOSE: The signed-in user's account keys — keys with no project of their
 *          own, minted by "All my projects" / "Only the projects I pick" on
 *          the MCP consent page or by the Account key card — and a revoke
 *          button for each (ADR 0026). No project's Keys page lists them.
 *
 * API: GET /v1/admin/mcp/account-keys, DELETE /v1/admin/mcp/account-keys/:id
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Btn, ErrorAlert } from '../ui'
import { ConfirmDialog } from '../ConfirmDialog'

export interface AccountKeyRow {
  id: string
  prefix: string | null
  label: string | null
  scopes: string[]
  created_at: string
  last_seen_at: string | null
  all_projects: boolean
  projects: Array<{ id: string; name: string }>
}

/**
 * What one account key reaches, in words.
 * @internal Exported for tests only.
 */
export function accountKeyReach(key: Pick<AccountKeyRow, 'all_projects' | 'projects'>): string {
  if (key.all_projects) return 'All your projects, including ones you join later'
  if (key.projects.length === 0) return 'No projects you can still reach'
  return key.projects.map((p) => p.name).join(', ')
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function McpAccountKeysList() {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<{ keys: AccountKeyRow[] }>('/v1/admin/mcp/account-keys', {
    scope: 'none',
  })
  const [confirming, setConfirming] = useState<AccountKeyRow | null>(null)
  const [revoking, setRevoking] = useState(false)

  async function revoke(key: AccountKeyRow) {
    setRevoking(true)
    const res = await apiFetch(`/v1/admin/mcp/account-keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' })
    setRevoking(false)
    setConfirming(null)
    if (res.ok) {
      toast.success('Account key revoked', 'Any MCP client using it is disconnected.')
    } else {
      toast.error('Could not revoke the key', res.error?.message ?? 'Refresh the list and try again.')
    }
    reload()
  }

  if (loading) return <p className="text-xs text-fg-muted">Loading account keys…</p>
  if (error) return <ErrorAlert message={`Could not load account keys: ${error}`} onRetry={reload} />

  const keys = data?.keys ?? []
  if (keys.length === 0) {
    return (
      <p className="text-xs text-fg-muted" data-testid="mcp-account-keys-empty">
        No account keys. Connecting an MCP client with “All my projects” or “Only the projects I pick” creates one here.
      </p>
    )
  }

  return (
    <>
      <ul className="divide-y divide-edge-subtle rounded-lg border border-edge-subtle" data-testid="mcp-account-keys">
        {keys.map((key) => (
          <li key={key.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">
                {key.label ?? 'Account key'}
                <code className="ml-2 font-mono text-2xs text-fg-muted">{key.prefix}…</code>
              </p>
              <p className="text-2xs text-fg-muted">
                {accountKeyReach(key)} · {key.scopes.join(', ') || 'no scopes'} · created {shortDate(key.created_at)}
              </p>
            </div>
            <Btn variant="ghost" size="sm" onClick={() => setConfirming(key)} aria-label={`Revoke ${key.label ?? 'account key'} ${key.prefix ?? ''}`}>
              Revoke
            </Btn>
          </li>
        ))}
      </ul>

      {confirming && (
        <ConfirmDialog
          title="Revoke this account key?"
          body="MCP clients using it lose access to every project it reaches. Reconnect from the client to get a new one."
          details={<code className="font-mono text-2xs">{confirming.prefix}… · {accountKeyReach(confirming)}</code>}
          confirmLabel="Revoke"
          tone="danger"
          loading={revoking}
          onConfirm={() => void revoke(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  )
}
