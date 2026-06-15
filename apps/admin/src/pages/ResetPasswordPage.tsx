/**
 * FILE: apps/admin/src/pages/ResetPasswordPage.tsx
 * PURPOSE: Password reset form shown after clicking the recovery link in email.
 *          Displayed when Supabase fires a PASSWORD_RECOVERY auth event.
 */

import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { Navigate } from 'react-router-dom'
import { Input, Btn, PageHelp, Loading } from '../components/ui'
import { ContainedBlock, InlineProof, SignalChip } from '../components/report-detail/ReportSurface'
import { detectRecoveryFromUrl } from '../lib/authRedirect'

export function ResetPasswordPage() {
  const { isPasswordRecovery, updatePassword, session, loading: authLoading } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  // Snapshot the URL on first render. supabase-js will strip the recovery
  // hash/query within a tick of mounting, so checking on every render is too
  // late. With this snapshot we keep the form mounted even if the auth
  // provider's PASSWORD_RECOVERY event arrives a beat after first render.
  const [recoveryFromUrl] = useState(detectRecoveryFromUrl)

  // Auth state isn't ready yet — show a spinner instead of bouncing to /login.
  // The previous code redirected during this tick, which destroyed the URL
  // hash containing the recovery token and broke the entire flow.
  if (authLoading && !done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-root p-4">
        <Loading text="Verifying reset link…" />
      </div>
    )
  }

  // Only redirect once we're sure: auth has loaded, the URL has no recovery
  // signal, supabase didn't fire PASSWORD_RECOVERY, and the user isn't in the
  // middle of a successful submit. If a session exists, send them home; if
  // not, send them to /login so they can request a new reset link.
  if (!isPasswordRecovery && !recoveryFromUrl && !done) {
    return <Navigate to={session ? '/' : '/login'} replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    const result = await updatePassword(password)
    if (result.error) {
      setError(result.error)
    } else {
      setDone(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-root p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold">
            <span className="text-brand">mushi</span>mushi
          </h1>
          <SignalChip tone="neutral" className="mt-1.5">admin console</SignalChip>
        </div>

        {!done && (
          <div className="mb-3">
            <PageHelp
              title="About this page"
              whatIsIt="Set a new password for your admin account. You're seeing this because you opened the password recovery link from your email."
              useCases={[
                'Choose a strong password (minimum 6 characters)',
                'Confirm the password to catch typos before submitting',
              ]}
              howToUse="Once you submit, you'll be signed in automatically and taken to the dashboard. The recovery link can only be used once."
            />
          </div>
        )}

        {done ? (
          <div className="bg-surface border border-edge rounded-md p-5 space-y-3">
            <div className="flex items-center justify-center">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-ok-muted/50 text-ok-foreground">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
            </div>
            <h2 className="text-sm font-semibold text-center">Password updated</h2>
            <ContainedBlock tone="muted">
              <InlineProof className="border-0 bg-transparent px-0 py-0 text-xs text-center">
                Your password has been changed successfully. You're now signed in.
              </InlineProof>
            </ContainedBlock>
            <div className="pt-1">
              <Btn
                type="button"
                onClick={() => window.location.replace(`${import.meta.env.BASE_URL}dashboard`)}
                className="w-full justify-center"
              >
                Go to Dashboard
              </Btn>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 bg-surface border border-edge rounded-md p-5">
            <h2 className="text-sm font-semibold text-center">Set a new password</h2>
            <ContainedBlock tone="muted" className="mb-1">
              <InlineProof className="border-0 bg-transparent px-0 py-0 text-xs text-center">
                Choose a new password for your account.
              </InlineProof>
            </ContainedBlock>

            <Input
              label="New password"
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              autoComplete="new-password"
              autoFocus
            />

            <Input
              label="Confirm password"
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              autoComplete="new-password"
            />

            {error && (
              <ContainedBlock tone="warn">
                <p className="text-xs text-danger">{error}</p>
              </ContainedBlock>
            )}

            <Btn type="submit" disabled={loading} className="w-full justify-center">
              {loading ? 'Updating...' : 'Update password'}
            </Btn>
          </form>
        )}
      </div>
    </div>
  )
}
