/**
 * FILE: apps/admin/src/pages/LoginPage.tsx
 * PURPOSE: Authentication page with dual UX:
 *   - Cloud mode: clean branded login, no infrastructure details
 *   - Self-hosted mode: connection context, health indicator, diagnostics
 */

import { useState, useEffect, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Input, Btn, Tooltip } from '../components/ui'
import { isCloudMode } from '../lib/env'
import { nextPathFromLoginState } from '../lib/authRedirect'
import {
  forgetRememberedLoginEmail,
  readRememberedLoginEmail,
  rememberLoginEmail,
} from '../lib/rememberedLogin'
import { canUsePasskeys } from '../lib/passkeys'

type HealthStatus = 'checking' | 'ok' | 'error' | 'unknown'
type FormMode = 'login' | 'magic' | 'signup' | 'forgot'
type SuccessState = null | 'signup-confirm' | 'reset-sent' | 'magic-sent'

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
  const { session, signIn, signInWithMagicLink, signInWithPasskey, signUp, resetPassword } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const initialRememberedEmail = readRememberedLoginEmail()
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(initialRememberedEmail)
  const [email, setEmail] = useState(initialRememberedEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<FormMode>('login')
  const [success, setSuccess] = useState<SuccessState>(null)
  const [rememberEmail, setRememberEmail] = useState(true)
  const [health, setHealth] = useState<HealthStatus>(cloud ? 'ok' : 'checking')
  const [passkeyAvailable, setPasskeyAvailable] = useState(false)

  const supabaseHost = getSupabaseHost()
  const nextPath = nextPathFromLoginState(location.state, searchParams.get('next'))

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

  useEffect(() => {
    setPasskeyAvailable(canUsePasskeys())
  }, [])

  if (session) return <Navigate to={nextPath} replace />

  const switchMode = (next: FormMode) => {
    setMode(next)
    setError('')
    setSuccess(null)
    if (next === 'signup') setRememberEmail(false)
    if (next === 'login') setRememberEmail(true)
  }

  const clearRememberedEmail = () => {
    forgetRememberedLoginEmail()
    setRememberedEmail(null)
    setEmail('')
    setRememberEmail(false)
    setPassword('')
  }

  const persistEmailChoice = () => {
    if (rememberEmail) {
      const remembered = rememberLoginEmail(email)
      setRememberedEmail(remembered)
    } else {
      forgetRememberedLoginEmail()
      setRememberedEmail(null)
    }
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
          persistEmailChoice()
          setSuccess('reset-sent')
        }
      } else if (mode === 'magic') {
        const result = await signInWithMagicLink(email)
        if (result.error) {
          setError(classifyAuthError(result.error))
        } else {
          persistEmailChoice()
          setSuccess('magic-sent')
        }
      } else if (mode === 'signup') {
        const result = await signUp(email, password)
        if (result.error) {
          setError(classifyAuthError(result.error))
        } else if (result.needsConfirmation) {
          persistEmailChoice()
          setSuccess('signup-confirm')
        }
      } else {
        const result = await signIn(email, password)
        if (result.error) {
          setError(classifyAuthError(result.error))
        } else {
          persistEmailChoice()
        }
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

  const handlePasskeySignIn = async () => {
    setError('')
    setSuccess(null)
    setLoading(true)
    const result = await signInWithPasskey()
    if (result.error) setError(classifyAuthError(result.error))
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

        {success === 'magic-sent' && (
          <div className="overflow-hidden bg-surface border border-brand/30 rounded-md p-5 space-y-4 shadow-raised">
            <div className="relative flex items-center justify-center">
              <span className="absolute h-16 w-16 rounded-full bg-brand/15 blur-xl" aria-hidden="true" />
              <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-brand/30 bg-brand/10 text-brand">
                @
              </span>
            </div>
            <div className="space-y-1 text-center">
              <h2 className="text-sm font-semibold">Check your inbox</h2>
              <p className="text-xs text-fg-muted">
                We sent a sign-in link to <strong className="text-fg">{email}</strong>. Keep this tab open, then follow
                the email link to land in your dashboard.
              </p>
            </div>
            <div className="rounded-sm border border-edge-subtle bg-surface-raised/50 px-3 py-2">
              <p className="text-2xs text-fg-faint">
                Tip: if the link opens a new tab, every other signed-out tab will sync automatically once the session is
                active.
              </p>
            </div>
            <div className="flex gap-2">
              <Btn
                type="button"
                variant="ghost"
                onClick={() => {
                  setSuccess(null)
                  setMode('magic')
                }}
                className="flex-1 justify-center"
              >
                Send again
              </Btn>
              <Btn type="button" onClick={() => switchMode('login')} className="flex-1 justify-center">
                Use password
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

            {mode === 'login' || mode === 'magic' ? (
              <div className="grid grid-cols-2 rounded-md border border-edge-subtle bg-surface-root/40 p-1">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`rounded-sm px-2 py-1.5 text-2xs font-medium motion-safe:transition-colors ${mode === 'login' ? 'bg-surface-raised text-fg shadow-card' : 'text-fg-faint hover:text-fg-muted'}`}
                >
                  Password
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('magic')}
                  className={`rounded-sm px-2 py-1.5 text-2xs font-medium motion-safe:transition-colors ${mode === 'magic' ? 'bg-surface-raised text-fg shadow-card' : 'text-fg-faint hover:text-fg-muted'}`}
                >
                  Email link
                </button>
              </div>
            ) : null}

            {mode === 'login' && (
              <button
                type="button"
                onClick={handlePasskeySignIn}
                disabled={loading || !passkeyAvailable}
                className="group flex w-full items-center justify-between rounded-md border border-brand/30 bg-brand/10 px-3 py-2.5 text-left text-xs text-fg motion-safe:transition-all hover:border-brand/60 hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>
                  <span className="block font-semibold">Continue with passkey</span>
                  <span className="block text-2xs text-fg-muted">
                    {passkeyAvailable ? 'Touch ID, Windows Hello, or security key' : 'Use email link or password on this browser'}
                  </span>
                </span>
                <span className="text-brand motion-safe:transition-transform group-hover:translate-x-0.5" aria-hidden="true">
                  -&gt;
                </span>
              </button>
            )}

            <p className="text-xs text-fg-muted text-center">
              {mode === 'forgot'
                ? 'Enter your email to receive a password reset link'
                : mode === 'magic'
                  ? 'Email yourself a secure one-click sign-in link'
                : mode === 'signup'
                  ? 'Create your account'
                  : cloud
                    ? 'Sign in to your account'
                    : 'Sign in with your Supabase project account'}
            </p>

            {mode === 'login' && rememberedEmail && (
              <div className="rounded-sm border border-edge-subtle bg-surface-raised/40 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-2xs uppercase tracking-wider text-fg-faint">Last used email</p>
                    <p className="truncate text-xs font-medium text-fg-secondary">{rememberedEmail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearRememberedEmail}
                    className="shrink-0 text-2xs text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm motion-safe:transition-colors"
                  >
                    Not you?
                  </button>
                </div>
              </div>
            )}

            <Input
              label="Email"
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus={!rememberedEmail}
            />

            {mode !== 'forgot' && mode !== 'magic' && (
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
                autoFocus={mode === 'login' && Boolean(rememberedEmail)}
              />
            )}

            {mode !== 'signup' && (
              <label className="inline-flex items-center gap-2 text-2xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={rememberEmail}
                  onChange={(e) => setRememberEmail(e.target.checked)}
                  className="h-3.5 w-3.5 rounded-sm border-edge bg-surface-raised accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                />
                Remember this email on this device
              </label>
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
                  : mode === 'magic'
                    ? 'Send sign-in link'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Sign in'}
            </Btn>

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="block w-full text-center text-2xs text-fg-faint hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm motion-safe:transition-colors"
              >
                Forgot your password?
              </button>
            )}

            <p className="text-center text-2xs text-fg-faint">
              {mode === 'forgot' ? (
                <>
                  Remember your password?{' '}
                  <button type="button" onClick={() => switchMode('login')} className="text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm motion-safe:transition-colors">
                    Sign in
                  </button>
                </>
              ) : mode === 'magic' ? (
                <>
                  Prefer a password?{' '}
                  <button type="button" onClick={() => switchMode('login')} className="text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm motion-safe:transition-colors">
                    Use password
                  </button>
                </>
              ) : mode === 'login' ? (
                <>
                  Don't have an account?{' '}
                  <button type="button" onClick={() => switchMode('signup')} className="text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm motion-safe:transition-colors">
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button type="button" onClick={() => switchMode('login')} className="text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm motion-safe:transition-colors">
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
