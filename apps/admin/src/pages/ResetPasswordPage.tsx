/**
 * FILE: apps/admin/src/pages/ResetPasswordPage.tsx
 * PURPOSE: Password reset form shown after clicking the recovery link in email.
 *          Displayed when Supabase fires a PASSWORD_RECOVERY auth event.
 */

import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { Navigate } from 'react-router-dom'
import { Input, Btn, PageHelp } from '../components/ui'

export function ResetPasswordPage() {
  const { isPasswordRecovery, updatePassword, session } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  if (!isPasswordRecovery && !done) {
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
          <p className="text-2xs text-fg-muted mt-0.5">admin console</p>
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
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-ok/10 text-ok">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
            </div>
            <h2 className="text-sm font-semibold text-center">Password updated</h2>
            <p className="text-xs text-fg-muted text-center">
              Your password has been changed successfully. You're now signed in.
            </p>
            <div className="pt-1">
              <Btn
                type="button"
                onClick={() => window.location.replace(import.meta.env.BASE_URL)}
                className="w-full justify-center"
              >
                Go to Dashboard
              </Btn>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 bg-surface border border-edge rounded-md p-5">
            <h2 className="text-sm font-semibold text-center">Set a new password</h2>
            <p className="text-xs text-fg-muted text-center">
              Choose a new password for your account.
            </p>

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
              <div className="rounded-sm border border-danger/30 bg-danger-muted/10 px-3 py-2">
                <p className="text-xs text-danger">{error}</p>
              </div>
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
