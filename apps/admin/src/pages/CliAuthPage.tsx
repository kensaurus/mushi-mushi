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
 *   5. Page polls GET /v1/cli/auth/device/status until the CLI has actually
 *      claimed the token — only then does it declare "CLI connected!". This
 *      closes the old failure mode where the page asserted success purely on
 *      the approve POST while the terminal (polling a different or stale
 *      device_code) never resumed.
 *   6. Connected state shows large "Switch back to your terminal" banner.
 *
 * DEPENDENCIES:
 *   - apiFetch (lib/supabase)
 *   - useAuth (lib/auth)
 *   - UI primitives (components/ui)
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { CliAuthReadout } from '../components/cli-auth/CliAuthReadout'
import { Btn, ErrorAlert } from '../components/ui'

type ApproveState = 'idle' | 'approving' | 'waiting' | 'connected' | 'denied' | 'error'

/** How often the page checks whether the CLI picked the token up. */
const CLAIM_POLL_MS = 2_500
/** After this long without a claim, surface stale-tab troubleshooting help. */
const CLAIM_SLOW_AFTER_MS = 45_000

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
  const [waitingSlow, setWaitingSlow] = useState(false)

  // Use code from URL (CLI opens the page with ?code=XXXX-XXXX) or
  // fall back to the manual input (user typed it themselves).
  const userCode = (codeParam || manualCode).trim().toUpperCase()

  // After approval, verify the terminal actually claimed the token before
  // declaring success. Approval alone proves nothing to the user — the CLI
  // may be polling a different (stale) device_code, in which case the honest
  // state is "still waiting", with troubleshooting help after a while.
  useEffect(() => {
    if (approveState !== 'waiting' || !userCode) return

    let cancelled = false
    const startedAt = Date.now()

    const check = async () => {
      const res = await apiFetch<{ status: string; claimed: boolean }>(
        `/v1/cli/auth/device/status?user_code=${encodeURIComponent(userCode)}`,
        { cache: 'no-store' },
      ).catch(() => null)
      if (cancelled) return
      if (res?.ok && res.data?.claimed) {
        setApproveState('connected')
        return
      }
      if (res?.ok && res.data?.status === 'expired') {
        setApproveState('error')
        setErrorMessage(
          'This request expired before your terminal picked it up. Re-run the command and approve the newest tab.',
        )
        return
      }
      // Defensive terminal states: 'rejected' should be unreachable for a row
      // this tab just approved (reject only flips still-pending rows), but a
      // future change or edge race must not leave the spinner running
      // forever. NOT_FOUND means the polled request no longer exists.
      if (res?.ok && res.data?.status === 'rejected') {
        setApproveState('error')
        setErrorMessage('This request was denied. Run the command again to get a fresh code.')
        return
      }
      if (res && !res.ok) {
        setApproveState('error')
        setErrorMessage(
          res.error?.code === 'NOT_FOUND'
            ? 'This request could not be found — it may have expired. Re-run the command and try again.'
            : (res.error?.message ?? 'Something went wrong while checking your terminal — please try again.'),
        )
        return
      }
      if (Date.now() - startedAt >= CLAIM_SLOW_AFTER_MS) {
        setWaitingSlow(true)
      }
    }

    void check()
    const timer = setInterval(() => void check(), CLAIM_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [approveState, userCode])

  async function handleApprove() {
    if (!userCode) return
    setApproveState('approving')
    setErrorMessage(null)
    setWaitingSlow(false)

    const res = await apiFetch<{ message: string }>('/v1/cli/auth/device/approve', {
      method: 'POST',
      body: JSON.stringify({ user_code: userCode }),
    })

    if (res.ok) {
      setApproveState('waiting')
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

  // ── Waiting state: approved, verifying the terminal picked the token up ──────
  if (approveState === 'waiting') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
        <span
          className="h-12 w-12 animate-spin rounded-full border-4 border-brand/25 border-t-brand motion-reduce:animate-none"
          role="status"
          aria-label="Waiting for your terminal to connect"
        />
        <div>
          <h1 className="text-2xl font-bold text-fg">Approved — waiting for your terminal…</h1>
          <p className="mt-2 text-sm text-fg-muted">
            Keep this tab open for a moment. It will confirm as soon as your
            terminal picks up the connection (usually within a few seconds).
          </p>
        </div>
        {waitingSlow && (
          <div className="max-w-md rounded-xl border border-warn/40 bg-warn-muted/50 px-5 py-4 text-left">
            <p className="text-sm font-semibold text-fg">Terminal not continuing?</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
              <li>
                This tab may belong to an <strong className="text-fg">older run</strong> of the
                wizard. Close it, re-run{' '}
                <code className="rounded bg-surface-overlay px-1 py-0.5 font-mono text-xs">npx mushi-mushi</code>,
                and approve in the newest tab (check the code matches).
              </li>
              <li>Make sure the wizard is still running in your terminal — it waits up to 10 minutes.</li>
            </ul>
          </div>
        )}
      </div>
    )
  }

  // ── Connected state: the CLI has claimed the token ───────────────────────────
  if (approveState === 'connected') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
        <CheckCircleIcon />
        <div>
          <h1 className="text-2xl font-bold text-fg">CLI connected!</h1>
          <p className="mt-2 text-sm text-fg-muted">
            Your terminal picked up the connection. Setup is continuing there.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl px-6 py-4 bg-ok-muted/50 text-ok-foreground border border-ok/25">
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
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-muted/50 px-4 py-3">
          <span className="mt-0.5 text-warning-foreground" aria-hidden="true">⚠</span>
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
          <div className="mb-4">
            <ErrorAlert title="Couldn't approve CLI connection" message={errorMessage} />
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
