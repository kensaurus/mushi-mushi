/**
 * FILE: apps/admin/src/pages/CliAuthPage.tsx
 * PURPOSE: RFC 8628 Device Authorization Grant approval page.
 *
 * OVERVIEW:
 *   Route: /cli-auth?code=XXXX-XXXX
 *   Opened by `mushi login` — the CLI prints this URL and opens the browser.
 *   The page reads the user_code from the query param, shows it prominently
 *   so the user can verify it matches what the CLI printed, then lets them
 *   approve (or deny) with a single click. On approval, the CLI poll loop
 *   receives the token and finishes setup automatically.
 *
 * FLOW:
 *   1. CLI runs `mushi login`, opens browser to this URL.
 *   2. User is already signed into the console (ProtectedRoute handles
 *      redirect-to-login if not, then comes back here).
 *   3. Page shows user_code, expiry countdown, and Approve / Deny buttons.
 *   4. On Approve → POST /v1/cli/auth/device/approve with { user_code }.
 *   5. Backend mints CLI token; CLI poll endpoint returns it; wizard resumes.
 *
 * DEPENDENCIES:
 *   - apiFetch (lib/supabase)
 *   - useAuth (lib/auth)
 *   - UI primitives (components/ui)
 */

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { Btn } from '../components/ui'

type ApproveState = 'idle' | 'approving' | 'approved' | 'denied' | 'error'

function TerminalIcon() {
  return (
    <svg
      className="h-8 w-8 text-brand"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg className="h-12 w-12 text-ok" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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

export function CliAuthPage() {
  const [params] = useSearchParams()
  const codeParam = params.get('code') ?? ''
  const [manualCode, setManualCode] = useState('')
  const [approveState, setApproveState] = useState<ApproveState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Use code from URL (CLI opens the page with ?code=XXXX-XXXX) or
  // fall back to the manual input (user typed it themselves).
  const userCode = (codeParam || manualCode).trim().toUpperCase()

  async function handleApprove() {
    if (!userCode) return
    setApproveState('approving')
    setErrorMessage(null)

    const res = await apiFetch<{ message: string }>('/v1/cli/auth/device/approve', {
      method: 'POST',
      body: JSON.stringify({ user_code: userCode }),
    })

    if (res.ok) {
      setApproveState('approved')
    } else {
      setApproveState('error')
      setErrorMessage(res.error?.message ?? 'Something went wrong — please try again.')
    }
  }

  async function handleDeny() {
    // Tell the backend so the CLI's next poll returns access_denied immediately
    // instead of hanging until the code expires. Best-effort: the UI flips to
    // the denied state regardless (a network blip shouldn't trap the user).
    if (userCode) {
      await apiFetch('/v1/cli/auth/device/reject', {
        method: 'POST',
        body: JSON.stringify({ user_code: userCode }),
      }).catch(() => {})
    }
    setApproveState('denied')
  }

  if (approveState === 'approved') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <CheckCircleIcon />
        <h1 className="text-xl font-semibold text-fg">CLI connected!</h1>
        <p className="max-w-sm text-sm text-fg-muted">
          Your terminal will finish setting up in a moment. You can close this tab.
        </p>
      </div>
    )
  }

  if (approveState === 'denied') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <XCircleIcon />
        <h1 className="text-xl font-semibold text-fg">Access denied</h1>
        <p className="max-w-sm text-sm text-fg-muted">
          The CLI request was denied. Run <code className="font-mono text-xs bg-surface-overlay px-1 py-0.5 rounded">mushi login</code> again in your terminal if you want to try again.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <TerminalIcon />
          <h1 className="text-xl font-semibold text-fg">Connect your CLI</h1>
          <p className="text-sm text-fg-muted">
            Your terminal is waiting for you to approve this connection.
            Make sure the code below matches what was printed in your terminal.
          </p>
        </div>

        {/* User code display */}
        <div className="mb-6 rounded-xl border border-border bg-surface-overlay px-6 py-5">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-muted">
            Confirmation code
          </p>
          <p className="font-mono text-3xl font-bold tracking-[0.15em] text-fg select-all">
            {userCode || <span className="text-fg-muted opacity-40">XXXX-XXXX</span>}
          </p>
          <p className="mt-2 text-2xs text-fg-muted">
            This code expires in 10 minutes. If it doesn't match, close this tab and run <code className="font-mono">mushi login</code> again.
          </p>
        </div>

        {/* Manual code input (if no code in URL) */}
        {!codeParam && (
          <div className="mb-4">
            <label htmlFor="cli-code" className="mb-1 block text-xs font-medium text-fg-muted">
              Enter the code shown in your terminal
            </label>
            <input
              id="cli-code"
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              maxLength={9}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm uppercase tracking-widest text-fg placeholder:text-fg-muted/40 focus:outline-none focus:ring-2 focus:ring-brand"
              autoComplete="off"
              autoFocus
            />
          </div>
        )}

        {/* Error */}
        {approveState === 'error' && errorMessage && (
          <div className="mb-4 rounded-lg border border-danger/40 bg-danger-muted/30 px-4 py-3 text-sm text-danger">
            {errorMessage}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Btn
            variant="ghost"
            onClick={handleDeny}
            disabled={approveState === 'approving'}
          >
            Deny
          </Btn>
          <Btn
            onClick={handleApprove}
            disabled={!userCode || approveState === 'approving'}
            loading={approveState === 'approving'}
          >
            {approveState === 'approving' ? 'Connecting…' : 'Approve CLI connection'}
          </Btn>
        </div>

        {/* Security note */}
        <p className="mt-4 text-center text-2xs text-fg-muted">
          Only approve if you just ran <code className="font-mono">mushi login</code> in your terminal.
          Never approve a request you didn't initiate.
        </p>
      </div>
    </div>
  )
}
