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
 *   2. User picks what the connection reaches (ADR 0026) and clicks Approve:
 *        - All my projects  → an account key (label 'mcp-oauth-account');
 *        - Only these       → an account key limited to the ticked projects
 *                             (label 'mcp-oauth-selected');
 *        - One project      → a project key (label 'mcp-oauth'; owner/admin
 *                             projects only get past the server gate).
 *      Account keys act with the user's own role in each project and are
 *      revocable from MCP → Account keys; project keys from the Keys page.
 *   3. POST /v1/mcp-oauth/approve mints the key and returns the client's
 *      redirect URL with the authorization code.
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
import { Btn, ErrorAlert } from '../components/ui'
import { CHIP_TONE } from '../lib/chipTone'
import {
  mcpAuthAccessPlan,
  mcpAuthApproveBody,
  mcpAuthGrantedScopes,
  type McpAuthAccess,
  type McpAuthAccessPlan,
  type McpAuthProjectRow,
} from '../lib/mcpAuthProjects'

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
  const [plan, setPlan] = useState<McpAuthAccessPlan | null>(null)
  const [projectsLoadFailed, setProjectsLoadFailed] = useState(false)
  const [access, setAccess] = useState<McpAuthAccess>('account')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
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
        // Every team, not just the active one: an account key reaches all of
        // them, so the page must show (and let the user pick from) all of them.
        apiFetch<{ projects: McpAuthProjectRow[] }>('/v1/admin/projects', { scope: 'none' }).catch(() => null),
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
      const accessPlan = mcpAuthAccessPlan(projRes)
      setProjectsLoadFailed(!projRes?.ok)
      setPlan(accessPlan)
      if (accessPlan.defaultMode) setAccess(accessPlan.defaultMode)
      if (accessPlan.connectable.length === 1) setSelectedProject(accessPlan.connectable[0].id)
      setState('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [txn])

  const approveBody = mcpAuthApproveBody(txn, access, { projectId: selectedProject, selectedIds })

  function toggleSelected(id: string) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  async function handleApprove() {
    if (!approveBody) return
    setState('approving')
    setErrorMessage(null)
    const res = await apiFetch<{ redirect_to: string }>('/v1/mcp-oauth/approve', {
      method: 'POST',
      body: JSON.stringify(approveBody),
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
        <div className="w-full max-w-md text-left">
          <ErrorAlert title="Connection failed" message={errorMessage ?? 'Something went wrong.'} />
        </div>
      </div>
    )
  }

  const grantedScopes = mcpAuthGrantedScopes(txnInfo?.granted_key_scopes ?? ['mcp:read'], access)
  const visible = plan?.visible ?? []
  const modes = plan?.modes ?? []
  const keyNote =
    access === 'project'
      ? (<>Approving mints a project API key (label <code className="font-mono">mcp-oauth</code>) that you can revoke any time from the project's Keys page.</>)
      : (<>Approving mints an account key (label <code className="font-mono">mcp-oauth-{access}</code>) that you can revoke any time from MCP → Account keys. In each project it can do only what your role there allows.</>)

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <PlugIcon />
          <h1 className="text-xl font-semibold text-fg">Connect an MCP client</h1>
          <p className="text-sm text-fg-muted">
            <strong className="text-fg">{txnInfo?.client_name ?? 'An MCP client'}</strong>{' '}
            wants to access your Mushi Mushi projects.
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
            {keyNote} After approval you'll be sent back to{' '}
            <code className="font-mono">{txnInfo?.redirect_host}</code>.
          </p>
        </div>

        {/* What the connection reaches */}
        {modes.length > 0 ? (
          <fieldset className="mb-4">
            <legend className="mb-2 block text-xs font-medium text-fg-muted">Projects this connection can reach</legend>
            <div className="space-y-2">
              {modes.map((mode) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                    access === mode ? 'border-brand bg-brand/5' : 'border-edge-subtle bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name="mcp-auth-access"
                    value={mode}
                    checked={access === mode}
                    onChange={() => setAccess(mode)}
                    className="mt-0.5 accent-brand"
                  />
                  <span>
                    <span className="block font-medium text-fg">
                      {mode === 'account' ? 'All my projects' : mode === 'selected' ? 'Only the projects I pick' : 'One project'}
                    </span>
                    <span className="block text-2xs text-fg-muted">
                      {mode === 'account'
                        ? `${visible.length} project${visible.length === 1 ? '' : 's'} now, and any project you join later.`
                        : mode === 'selected'
                          ? 'Pick projects below. Projects you join later are not included.'
                          : 'A key for a single project you own or administer.'}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {access === 'account' && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Projects included">
                {visible.map((p) => (
                  <li key={p.id} className="rounded bg-surface-overlay px-2 py-0.5 text-2xs text-fg-secondary">
                    {p.name}
                    {p.role ? <span className="ml-1 text-fg-faint">· {p.role}</span> : null}
                  </li>
                ))}
              </ul>
            )}

            {access === 'selected' && (
              <div className="mt-3 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-edge-subtle bg-surface px-3 py-2">
                {visible.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-fg">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      className="accent-brand"
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.role ? <span className="text-2xs text-fg-faint">{p.role}</span> : null}
                  </label>
                ))}
              </div>
            )}

            {access === 'project' && (
              <select
                id="mcp-auth-project"
                aria-label="Project to connect"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="mt-3 w-full rounded-lg border border-edge-subtle bg-surface px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <option value="" disabled>
                  Select a project…
                </option>
                {(plan?.connectable ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </fieldset>
        ) : projectsLoadFailed ? (
          <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${CHIP_TONE.dangerSubtle}`}>
            Could not load your projects. Check your connection, reload this page, and pick a project. The
            request stays open for 10 minutes.
          </p>
        ) : (
          <p className={`mb-4 rounded-lg px-4 py-3 text-sm ${CHIP_TONE.dangerSubtle}`}>
            No projects found. Create a project in the console first, then retry the connection from your MCP client.
          </p>
        )}

        {/* Error */}
        {errorMessage && (
          <div className="mb-4">
            <ErrorAlert title="Couldn't approve connection" message={errorMessage} />
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Btn variant="ghost" onClick={handleDeny} disabled={state === 'approving'}>
            Deny
          </Btn>
          <Btn
            onClick={handleApprove}
            disabled={!approveBody || state === 'approving'}
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
