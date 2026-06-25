/**
 * FILE: apps/admin/src/pages/CliAuthPage.tsx
 * PURPOSE: RFC 8628 Device Authorization Grant approval page.
 *
 * OVERVIEW:
 *   Route: /cli-auth?code=XXXX-XXXX
 *   Opened by `mushi login` — the CLI prints this URL and opens the browser.
 *   The page shows a 3-step guide alongside the verification code so users
 *   understand the flow (approve here → return to terminal) and an explicit
 *   anti-paste warning ("do not type this in your terminal").
 *
 * FLOW:
 *   1. CLI runs `mushi login`, opens browser to this URL.
 *   2. User is already signed into the console (ProtectedRoute handles
 *      redirect-to-login if not, then comes back here).
 *   3. Page shows a numbered 3-step guide + code + Approve / Deny buttons.
 *   4. On Approve → POST /v1/cli/auth/device/approve with { user_code }.
 *   5. Backend mints CLI token; CLI poll endpoint returns it; wizard resumes.
 *   6. Approved state shows large "Switch back to your terminal" banner.
 *
 * DEPENDENCIES:
 *   - apiFetch (lib/supabase)
 *   - useAuth (lib/auth)
 *   - UI primitives (components/ui)
 */

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { CliAuthReadout } from '../components/cli-auth/CliAuthReadout'
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

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'h-12 w-12 text-ok'} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
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

function ArrowLeftIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  )
}

const STEPS = [
  { n: '1', text: 'Verify the code below matches what your terminal printed' },
  { n: '2', text: 'Click "Approve CLI connection" below' },
  { n: '3', text: 'Switch back to your terminal — setup continues automatically' },
]

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

  // ── Approved state: big "return to terminal" prompt ──────────────────────────
  if (approveState === 'approved') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
        <CheckCircleIcon />
        <div>
          <h1 className="text-2xl font-bold text-fg">CLI connected!</h1>
          <p className="mt-2 text-sm text-fg-muted">
            Setup is continuing automatically in your terminal.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-6 py-4 text-ok">
          <ArrowLeftIcon />
          <span className="font-medium">Switch back to your terminal now</span>
        </div>
        <p className="max-w-xs text-xs text-fg-muted">
          You can close this tab. The wizard will finish installing the SDK and
          writing your <code className="font-mono">.env.local</code> file.
        </p>
      </div>
    )
  }

  // ── Denied state ─────────────────────────────────────────────────────────────
  if (approveState === 'denied') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <XCircleIcon />
        <h1 className="text-xl font-semibold text-fg">Access denied</h1>
        <p className="max-w-sm text-sm text-fg-muted">
          The CLI request was denied. Run{' '}
          <code className="rounded bg-surface-overlay px-1 py-0.5 font-mono text-xs">
            mushi login
          </code>{' '}
          again in your terminal if you want to try again.
        </p>
      </div>
    )
  }

  // ── Main approval page ────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="w-full max-w-lg">
        <CliAuthReadout userCode={userCode || null} />

        {/* Header */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <TerminalIcon />
          <h1 className="text-xl font-semibold text-fg">Connect your CLI</h1>
          <p className="text-sm text-fg-muted">
            Your terminal is waiting. Follow the steps below — no typing required.
          </p>
        </div>

        {/* 3-step guide */}
        <ol className="mb-6 space-y-2">
          {STEPS.map((step) => (
            <li key={step.n} className="flex items-start gap-3 rounded-lg border border-edge-subtle bg-surface-raised px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                {step.n}
              </span>
              <span className="text-sm text-fg">{step.text}</span>
            </li>
          ))}
        </ol>

        {/* User code display */}
        <div className="mb-4 rounded-xl border border-edge-subtle bg-surface-overlay px-6 py-5">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-muted">
            Verification code — confirm it matches your terminal
          </p>
          <p className="font-mono text-3xl font-bold tracking-[0.15em] text-fg select-all">
            {userCode || <span className="text-fg-muted opacity-40">XXXX-XXXX</span>}
          </p>
          <p className="mt-2 text-2xs text-fg-muted">
            Expires in 10 minutes. If it doesn't match, close this tab and run{' '}
            <code className="font-mono">mushi login</code> again.
          </p>
        </div>

        {/* Anti-paste warning */}
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
          <span className="mt-0.5 text-warning" aria-hidden="true">⚠</span>
          <p className="text-sm text-fg-muted">
            <strong className="text-fg">Do not paste or type this code into your terminal.</strong>{' '}
            It belongs here in the browser. The terminal waits automatically.
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
              className="w-full rounded-lg border border-edge-subtle bg-surface px-3 py-2 font-mono text-sm uppercase tracking-widest text-fg placeholder:text-fg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
          Only approve if you just ran{' '}
          <code className="font-mono">mushi login</code> or{' '}
          <code className="font-mono">npx mushi-mushi</code> in your terminal.
          Never approve a request you didn't initiate.
        </p>
      </div>
    </div>
  )
}
