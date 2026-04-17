/**
 * FILE: apps/admin/src/pages/LoginPage.tsx
 * PURPOSE: Authentication page with dual UX:
 *   - Cloud mode: clean branded login, no infrastructure details
 *   - Self-hosted mode: connection context, health indicator, diagnostics
 */

import { useState, useEffect, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { Navigate } from 'react-router-dom'
import { Input, Btn, Tooltip } from '../components/ui'
import { isCloudMode } from '../lib/env'

type HealthStatus = 'checking' | 'ok' | 'error' | 'unknown'
type FormMode = 'login' | 'signup' | 'forgot'
type SuccessState = null | 'signup-confirm' | 'reset-sent'

const cloud = isCloudMode()

function getSupabaseHost(): string {
  const url = import.meta.env.VITE_SUPABASE_URL ?? ''
  try { return new URL(url).host } catch { return url || 'not configured' }
}

function classifyAuthError(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('invalid login') || lower.includes('invalid_credentials'))
    return 'Invalid email or password. Check your credentials and try again.'
  if (lower.includes('email not confirmed'))
    return 'Please confirm your email address first. Check your inbox for a verification link.'
  if (lower.includes('rate limit') || lower.includes('too many'))
    return 'Too many attempts. Wait a moment and try again.'
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('failed'))
    return cloud
      ? 'Cannot reach the server. Please check your network connection and try again.'
      : 'Cannot reach the Supabase server. Check your .env configuration and network connection.'
  if (lower.includes('user already registered'))
    return 'An account with this email already exists. Try signing in instead.'
  return raw
}

export function LoginPage() {
  const { session, signIn, signUp, resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<FormMode>('login')
  const [success, setSuccess] = useState<SuccessState>(null)
  const [health, setHealth] = useState<HealthStatus>(cloud ? 'ok' : 'checking')

  const supabaseHost = getSupabaseHost()

  useEffect(() => {
    if (cloud) return

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
    if (!supabaseUrl) { setHealth('unknown'); return }

    const controller = new AbortController()
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
    fetch(`${supabaseUrl}/auth/v1/health`, {
      signal: controller.signal,
      headers: anonKey ? { apikey: anonKey } : {},
    })
      .then((res) => setHealth(res.ok || res.status === 401 ? 'ok' : 'error'))
      .catch(() => setHealth('error'))
    return () => controller.abort()
  }, [])

  if (session) return <Navigate to="/" replace />

  const switchMode = (next: FormMode) => {
    setMode(next)
    setError('')
    setSuccess(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(null)
    setLoading(true)

    try {
      if (mode === 'forgot') {
        const result = await resetPassword(email)
        if (result.error) {
          setError(classifyAuthError(result.error))
        } else {
          setSuccess('reset-sent')
        }
      } else if (mode === 'signup') {
        const result = await signUp(email, password)
        if (result.error) {
          setError(classifyAuthError(result.error))
        } else if (result.needsConfirmation) {
          setSuccess('signup-confirm')
        }
      } else {
        const result = await signIn(email, password)
        if (result.error) setError(classifyAuthError(result.error))
      }
    } catch {
      setError(
        cloud
          ? 'Cannot reach the server. Please try again later.'
          : 'Cannot reach the authentication server. Is your Supabase URL correct?',
      )
    }
    setLoading(false)
  }

  const healthDot = {
    checking: 'bg-fg-faint animate-pulse',
    ok: 'bg-ok',
    error: 'bg-danger',
    unknown: 'bg-warn',
  }[health]

  const healthLabel = {
    checking: 'Checking connection…',
    ok: 'Connected',
    error: 'Cannot reach server',
    unknown: 'Not configured',
  }[health]

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-root p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold">
            <span className="text-brand">mushi</span>mushi
          </h1>
          <p className="text-2xs text-fg-faint mt-0.5">admin console</p>
        </div>

        {/* Success: signup confirmation */}
        {success === 'signup-confirm' && (
          <div className="bg-surface border border-edge rounded-md p-5 space-y-3">
            <div className="flex items-center justify-center">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-ok/10 text-ok">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </span>
            </div>
            <h2 className="text-sm font-semibold text-center">Check your email</h2>
            <p className="text-xs text-fg-muted text-center">
              We sent a confirmation link to <strong className="text-fg">{email}</strong>.
              Click the link to activate your account, then come back here to sign in.
            </p>
            <p className="text-2xs text-fg-faint text-center">
              Didn't receive it? Check your spam folder or{' '}
              <button
                type="button"
                onClick={() => { switchMode('signup'); setEmail(email) }}
                className="text-brand hover:text-brand-hover"
              >
                try again
              </button>.
            </p>
            <div className="pt-1">
              <Btn
                type="button"
                onClick={() => switchMode('login')}
                className="w-full justify-center"
              >
                Back to sign in
              </Btn>
            </div>
          </div>
        )}

        {/* Success: password reset email sent */}
        {success === 'reset-sent' && (
          <div className="bg-surface border border-edge rounded-md p-5 space-y-3">
            <div className="flex items-center justify-center">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-ok/10 text-ok">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
            </div>
            <h2 className="text-sm font-semibold text-center">Reset link sent</h2>
            <p className="text-xs text-fg-muted text-center">
              If an account exists for <strong className="text-fg">{email}</strong>,
              you'll receive a password reset link shortly.
            </p>
            <div className="pt-1">
              <Btn
                type="button"
                onClick={() => switchMode('login')}
                className="w-full justify-center"
              >
                Back to sign in
              </Btn>
            </div>
          </div>
        )}

        {/* Main form (login / signup / forgot) */}
        {!success && (
          <form onSubmit={handleSubmit} className="space-y-3 bg-surface border border-edge rounded-md p-5">
            {!cloud && (
              <div className="flex items-center justify-between pb-2 border-b border-edge-subtle">
                <Tooltip content={`Supabase: ${supabaseHost}`} side="bottom">
                  <span className="text-2xs text-fg-faint truncate max-w-[200px] cursor-default">
                    {supabaseHost}
                  </span>
                </Tooltip>
                <Tooltip content={healthLabel} side="bottom">
                  <span className="flex items-center gap-1.5 text-2xs text-fg-faint cursor-default">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${healthDot}`} />
                    {healthLabel}
                  </span>
                </Tooltip>
              </div>
            )}

            <p className="text-xs text-fg-muted text-center">
              {mode === 'forgot'
                ? 'Enter your email to receive a password reset link'
                : mode === 'signup'
                  ? 'Create your account'
                  : cloud
                    ? 'Sign in to your account'
                    : 'Sign in with your Supabase project account'}
            </p>

            <Input
              label="Email"
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              autoComplete="email"
            />

            {mode !== 'forgot' && (
              <Input
                label="Password"
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            )}

            {error && (
              <div className="rounded-sm border border-danger/30 bg-danger-muted/10 px-3 py-2">
                <p className="text-xs text-danger">{error}</p>
              </div>
            )}

            {!cloud && health === 'error' && !error && (
              <div className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2">
                <p className="text-xs text-warn">
                  Cannot connect to <code className="text-2xs bg-surface-raised px-1 rounded">{supabaseHost}</code>.
                  Verify your <code className="text-2xs bg-surface-raised px-1 rounded">VITE_SUPABASE_URL</code> and
                  make sure the Supabase project is running.
                </p>
              </div>
            )}

            <Btn type="submit" disabled={loading} className="w-full justify-center">
              {loading
                ? 'Please wait...'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Sign in'}
            </Btn>

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="block w-full text-center text-2xs text-fg-faint hover:text-brand"
              >
                Forgot your password?
              </button>
            )}

            <p className="text-center text-2xs text-fg-faint">
              {mode === 'forgot' ? (
                <>
                  Remember your password?{' '}
                  <button type="button" onClick={() => switchMode('login')} className="text-brand hover:text-brand-hover">
                    Sign in
                  </button>
                </>
              ) : mode === 'login' ? (
                <>
                  Don't have an account?{' '}
                  <button type="button" onClick={() => switchMode('signup')} className="text-brand hover:text-brand-hover">
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button type="button" onClick={() => switchMode('login')} className="text-brand hover:text-brand-hover">
                    Sign in
                  </button>
                </>
              )}
            </p>

            {mode === 'signup' && (
              <p className="text-center text-2xs text-fg-faint">
                {cloud
                  ? 'Create a free account to get started with Mushi Mushi.'
                  : (
                    <>
                      This creates an account on your Supabase project.
                      You can also create users from the{' '}
                      <a
                        href="https://supabase.com/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:text-brand-hover underline"
                      >
                        Supabase dashboard
                      </a>.
                    </>
                  )}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
