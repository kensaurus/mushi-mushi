/**
 * FILE: apps/admin/src/pages/AuthConfirmPage.tsx
 * PURPOSE: /auth/confirm — the confirmation email's link lands here on the
 *          console's own domain, verifies the token hash, and opens setup
 *          (or the invite / deep link the sign-up came from). An expired or
 *          used link explains itself and offers sign-in or a new link.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Btn, Input, Loading } from '../components/ui'
import { supabase } from '../lib/supabase'
import { authRedirectUrl } from '../lib/authRedirect'
import { confirmErrorMessage, confirmLandingPath, readConfirmParams } from '../lib/authConfirm'
import { emailFormatProblem } from '../lib/loginSubmit'

type State =
  | { kind: 'verifying' }
  | { kind: 'failed'; message: string }
  | { kind: 'resent'; email: string }

export function AuthConfirmPage() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'verifying' })
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    // A token hash works once: never verify twice (StrictMode, re-render).
    if (ran.current) return
    ran.current = true
    const { tokenHash, type, redirectTo } = readConfirmParams(search)
    const landing = confirmLandingPath(redirectTo, window.location.origin, import.meta.env.BASE_URL)
    void (async () => {
      if (!tokenHash) {
        const { data } = await supabase.auth.getSession()
        if (data.session) return navigate(landing, { replace: true })
        return setState({ kind: 'failed', message: confirmErrorMessage('invalid') })
      }
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      if (!error) return navigate(landing, { replace: true })
      // Opened twice (email scanners pre-open links): already signed in is fine.
      const { data } = await supabase.auth.getSession()
      if (data.session) return navigate(landing, { replace: true })
      setState({ kind: 'failed', message: confirmErrorMessage(error.message) })
    })()
  }, [search, navigate])

  const resend = async (e: FormEvent) => {
    e.preventDefault()
    const problem = emailFormatProblem(email)
    if (problem || !email.trim()) return setResendError(problem ?? 'Enter the email you signed up with.')
    setSending(true)
    setResendError(null)
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: authRedirectUrl('/onboarding') },
    })
    setSending(false)
    if (error) {
      const lower = error.message.toLowerCase()
      return setResendError(
        lower.includes('rate') || lower.includes('seconds')
          ? 'A link was sent a moment ago. Wait a minute, then try again.'
          : 'Could not send a new link. Check the address, or sign in if you already confirmed.',
      )
    }
    setState({ kind: 'resent', email: email.trim() })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-root p-4">
      <div className="w-full max-w-sm space-y-4">
        <p className="text-center text-lg font-semibold text-fg">Mushi Mushi</p>
        {state.kind === 'verifying' && <Loading text="Confirming your email…" />}
        {state.kind === 'failed' && (
          <div className="rounded-md border border-edge-subtle bg-surface-raised p-5 space-y-4" role="alert">
            <p className="text-sm text-fg">{state.message}</p>
            <Btn to="/login" variant="primary" size="sm">Sign in</Btn>
            <form onSubmit={resend} className="space-y-2 border-t border-edge-subtle pt-4">
              <Input
                label="Send a new link to"
                id="resend-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                error={resendError ?? undefined}
              />
              <Btn type="submit" variant="ghost" size="sm" loading={sending} disabled={sending}>Send a new link</Btn>
            </form>
          </div>
        )}
        {state.kind === 'resent' && (
          <div className="rounded-md border border-edge-subtle bg-surface-raised p-5 space-y-2" role="status">
            <p className="text-sm text-fg">A new link is on its way to <strong>{state.email}</strong>.</p>
            <p className="text-xs text-fg-muted">It can take a minute. Check spam if it does not arrive.</p>
            <Link to="/login" className="text-xs underline underline-offset-2">Back to sign in</Link>
          </div>
        )}
      </div>
    </div>
  )
}
