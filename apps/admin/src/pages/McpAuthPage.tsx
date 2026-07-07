/**
 * FILE: apps/admin/src/pages/McpAuthPage.tsx
 * PURPOSE: OAuth consent page for MCP client login (`claude mcp login mushi`,
 *          Cursor, VS Code — any client speaking the MCP auth spec).
 *
 * OVERVIEW:
 *   Route: /mcp-auth?txn=<uuid>
 *   The hosted MCP's /oauth/authorize endpoint validates the client's request,
 *   records a pending transaction, and 302s the user's browser here.
 *
 * FLOW:
 *   1. Page loads the transaction (GET /v1/mcp-oauth/request?txn=…) — shows
 *      the client name and what access it asked for.
 *   2. User picks which project to connect (owner/admin projects only get
 *      past the server gate) and clicks Approve.
 *   3. POST /v1/mcp-oauth/approve mints a project API key (label 'mcp-oauth',
 *      revocable from the Keys page) and returns the client's redirect URL
 *      with the authorization code.
 *   4. The browser navigates to that redirect — usually the MCP client's
 *      localhost callback — and the terminal/IDE finishes the login itself.
 *
 * DEPENDENCIES:
 *   - apiFetch (lib/supabase)
 *   - UI primitives (components/ui)
 *   - Sibling page: CliAuthPage.tsx (RFC 8628 device flow for `mushi login`)
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { Btn } from '../components/ui'
import { CHIP_TONE } from '../lib/chipTone'

type TxnInfo = {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  client_name: string
  granted_key_scopes: string[]
  redirect_host: string
}

// Defense-in-depth mirror of the server's isAllowedRedirectUri denylist —
// custom schemes (cursor://, vscode://) are legitimate MCP callbacks, so only
// the actively dangerous schemes are blocked here.
const DANGEROUS_REDIRECT_SCHEME = /^\s*(javascript|data|file|blob|vbscript):/i

function assignRedirect(url: string): boolean {
  if (DANGEROUS_REDIRECT_SCHEME.test(url)) return false
  window.location.assign(url)
  return true
}

type ProjectOption = { id: string; name: string }

type PageState = 'loading' | 'ready' | 'approving' | 'redirecting' | 'denied' | 'error'

function PlugIcon() {
  return (
    <svg className="h-8 w-8 text-brand" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  )
}

function XCircleIcon() {
  return (
    <svg className="h-12 w-12 text-danger" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'mcp:read': 'Read reports, inventory, docs, and triage data',
  'mcp:write': 'Dispatch fixes, transition reports, and run admin tools',
  'report:write': 'Submit bug reports on your behalf',
}

export function McpAuthPage() {
  const [params] = useSearchParams()
  const txn = (params.get('txn') ?? '').trim()

  const [state, setState] = useState<PageState>('loading')
  const [txnInfo, setTxnInfo] = useState<TxnInfo | null>(null)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!txn) {
      setState('error')
      setErrorMessage('Missing transaction id. Restart the connection from your MCP client (e.g. `claude mcp login mushi`).')
      return
    }
    let cancelled = false
    void (async () => {
      const [txnRes, projRes] = await Promise.all([
        apiFetch<TxnInfo>(`/v1/mcp-oauth/request?txn=${encodeURIComponent(txn)}`, { cache: 'no-store' }).catch(() => null),
        apiFetch<{ projects: ProjectOption[] }>('/v1/admin/projects').catch(() => null),
      ])
      if (cancelled) return
      if (!txnRes?.ok || !txnRes.data) {
        setState('error')
        setErrorMessage(
          txnRes?.error?.code === 'NOT_FOUND'
            ? 'This authorization request could not be found — it may have expired. Restart the connection from your MCP client.'
            : (txnRes?.error?.message ?? 'Could not load the authorization request.'),
        )
        return
      }
      if (txnRes.data.status !== 'pending') {
        setState('error')
        setErrorMessage(
          txnRes.data.status === 'expired'
            ? 'This authorization request expired (10-minute limit). Restart the connection from your MCP client.'
            : 'This authorization request was already handled. Restart the connection from your MCP client if it did not complete.',
        )
        return
      }
      setTxnInfo(txnRes.data)
      const list = projRes?.ok ? (projRes.data?.projects ?? []) : []
      setProjects(list.map((p) => ({ id: p.id, name: p.name })))
      if (list.length === 1) setSelectedProject(list[0].id)
      setState('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [txn])

  async function handleApprove() {
    if (!selectedProject) return
    setState('approving')
    setErrorMessage(null)
    const res = await apiFetch<{ redirect_to: string }>('/v1/mcp-oauth/approve', {
      method: 'POST',
      body: JSON.stringify({ txn, project_id: selectedProject }),
    })
    if (res.ok && res.data?.redirect_to) {
      if (assignRedirect(res.data.redirect_to)) {
        setState('redirecting')
        return
      }
    }
    setState('ready')
    setErrorMessage(
      res.error?.code === 'FORBIDDEN'
        ? 'You need owner or admin access on that project to connect an MCP client to it.'
        : (res.error?.message ?? 'Something went wrong — please try again.'),
    )
  }

  async function handleDeny() {
    const res = await apiFetch<{ redirect_to: string }>('/v1/mcp-oauth/deny', {
      method: 'POST',
      body: JSON.stringify({ txn }),
    }).catch(() => null)
    // Best-effort: send the client its access_denied callback so the terminal
    // stops waiting; the page shows the denied state regardless.
    if (res?.ok && res.data?.redirect_to && assignRedirect(res.data.redirect_to)) {
      return
    }
    setState('denied')
  }

  if (state === 'loading') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <span
          className="h-10 w-10 animate-spin rounded-full border-4 border-brand/25 border-t-brand motion-reduce:animate-none"
          role="status"
          aria-label="Loading authorization request"
        />
        <p className="text-sm text-fg-muted">Loading authorization request…</p>
      </div>
    )
  }

  if (state === 'redirecting') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <span
          className="h-10 w-10 animate-spin rounded-full border-4 border-brand/25 border-t-brand motion-reduce:animate-none"
          role="status"
          aria-label="Returning to your MCP client"
        />
        <h1 className="text-xl font-semibold text-fg">Approved — returning to your MCP client…</h1>
        <p className="max-w-sm text-sm text-fg-muted">
          If nothing happens, switch back to your terminal or editor — the connection may already be complete.
        </p>
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <XCircleIcon />
        <h1 className="text-xl font-semibold text-fg">Access denied</h1>
        <p className="max-w-sm text-sm text-fg-muted">
          The MCP client was not connected. You can close this tab. Retry the login from your client if this was a mistake.
        </p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <XCircleIcon />
        <h1 className="text-xl font-semibold text-fg">Can't complete this connection</h1>
        <p className={`max-w-md rounded-lg px-4 py-3 text-sm ${CHIP_TONE.dangerSubtle}`}>{errorMessage}</p>
      </div>
    )
  }

  const grantedScopes = txnInfo?.granted_key_scopes ?? ['mcp:read']

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <PlugIcon />
          <h1 className="text-xl font-semibold text-fg">Connect an MCP client</h1>
          <p className="text-sm text-fg-muted">
            <strong className="text-fg">{txnInfo?.client_name ?? 'An MCP client'}</strong>{' '}
            wants to access your Mushi Mushi project.
          </p>
        </div>

        {/* Access summary */}
        <div className="mb-4 rounded-xl border border-edge-subtle bg-surface-raised px-5 py-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
            This connection will be able to
          </p>
          <ul className="space-y-1.5">
            {grantedScopes.map((scope) => (
              <li key={scope} className="flex items-start gap-2 text-sm text-fg">
                <span className="mt-0.5 text-ok" aria-hidden="true">✓</span>
                <span>
                  {SCOPE_DESCRIPTIONS[scope] ?? scope}
                  <code className="ml-1.5 rounded bg-surface-overlay px-1 py-0.5 font-mono text-2xs text-fg-muted">{scope}</code>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-2xs text-fg-muted">
            Approving mints a project API key (label <code className="font-mono">mcp-oauth</code>) that you can
            revoke any time from the project's Keys page. After approval you'll be sent back to{' '}
            <code className="font-mono">{txnInfo?.redirect_host}</code>.
          </p>
        </div>

        {/* Project picker */}
        <div className="mb-4">
          <label htmlFor="mcp-auth-project" className="mb-1 block text-xs font-medium text-fg-muted">
            Project to connect
          </label>
          {projects.length > 0 ? (
            <select
              id="mcp-auth-project"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full rounded-lg border border-edge-subtle bg-surface px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <option value="" disabled>
                Select a project…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <p className={`rounded-lg px-4 py-3 text-sm ${CHIP_TONE.dangerSubtle}`}>
              No projects found. Create a project in the console first, then retry the connection from your MCP client.
            </p>
          )}
        </div>

        {/* Error */}
        {errorMessage && (
          <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${CHIP_TONE.dangerSubtle}`}>{errorMessage}</div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Btn variant="ghost" onClick={handleDeny} disabled={state === 'approving'}>
            Deny
          </Btn>
          <Btn
            onClick={handleApprove}
            disabled={!selectedProject || state === 'approving'}
            loading={state === 'approving'}
          >
            {state === 'approving' ? 'Connecting…' : 'Approve connection'}
          </Btn>
        </div>

        {/* Security note */}
        <p className="mt-4 text-center text-2xs text-fg-muted">
          Only approve if you just started an MCP login from your own terminal or editor
          (e.g. <code className="font-mono">claude mcp login mushi</code>).
          Never approve a request you didn't initiate.
        </p>
      </div>
    </div>
  )
}
