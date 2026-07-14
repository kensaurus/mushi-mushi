/**
 * FILE: apps/admin/src/pages/LoginPage.tsx
 * PURPOSE: Authentication page with dual UX:
 *   - Cloud mode: clean branded login, no infrastructure details
 *   - Self-hosted mode: connection context, health indicator, diagnostics
 */

import { useState, useEffect, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Input, Btn, Tooltip, HelpBanner } from '../components/ui'
import { isCloudMode, RESOLVED_SUPABASE_URL } from '../lib/env'
import { nextPathFromLoginState } from '../lib/authRedirect'
import {
  forgetRememberedLoginEmail,
  readRememberedLoginEmail,
  rememberLoginEmail,
} from '../lib/rememberedLogin'
import { LOGIN_HERO } from '../lib/public-copy-shared'
import { canUsePasskeys } from '../lib/passkeys'
import { useEnabledAuthProviders } from '../lib/authProviders'
import { CHIP_TONE, LINK_ACCENT } from '../lib/chipTone'

type HealthStatus = 'checking' | 'ok' | 'error' | 'unknown'
type FormMode = 'login' | 'magic' | 'signup' | 'forgot'
type SuccessState = null | 'signup-confirm' | 'reset-sent' | 'magic-sent'
/** Which portal flow led the user to this login page. */
type LoginTrack = 'tester' | 'console'

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
  const { session, signIn, signInWithMagicLink, signInWithGitHub, signInWithGoogle, signInWithPasskey, signUp, resetPassword } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const initialRememberedEmail = readRememberedLoginEmail()
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(initialRememberedEmail)
  const [email, setEmail] = useState(initialRememberedEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const initialTrack: LoginTrack = searchParams.get('as') === 'tester' ? 'tester' : 'console'
  // Bare /signup (linked from docs/pricing.mdx) lands directly on the signup
  // form instead of the default password/magic-link tabs.
  const isSignupRoute = location.pathname === '/signup'
  const initialMode: FormMode = isSignupRoute ? 'signup' : initialTrack === 'tester' ? 'magic' : 'login'
  const [mode, setMode] = useState<FormMode>(initialMode)
  const [success, setSuccess] = useState<SuccessState>(null)
  const [rememberEmail, setRememberEmail] = useState(!isSignupRoute)
  const [health, setHealth] = useState<HealthStatus>(cloud ? 'ok' : 'checking')
  const [passkeyAvailable, setPasskeyAvailable] = useState(false)
  // Only offer providers the backend has actually enabled. Prevents the raw
  // GoTrue "provider is not enabled" JSON page (supabase-js hard-redirects to
  // /authorize before any client-side error can fire). See authProviders.ts.
  const { providers: authProviders, loading: authProvidersLoading } = useEnabledAuthProviders()
  // Detect ?as=tester URL param (linked from marketplace "Join to test" CTA)
  const [track] = useState<LoginTrack>(initialTrack)

  const supabaseHost = getSupabaseHost()
  const defaultNextPath = track === 'tester' ? '/tester' : '/dashboard'
  const nextPath = nextPathFromLoginState(location.state, searchParams.get('next'), defaultNextPath)

  useEffect(() => {
    if (cloud) return

    const supabaseUrl = RESOLVED_SUPABASE_URL
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
      } else if (mode === 'magic' || track === 'tester') {
        // Both tracks use magic-link; the post-auth redirect is driven by `nextPath`.
        const magicFn = signInWithMagicLink
        const result = await magicFn(email)
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
    <div className="min-h-full flex items-center justify-center overflow-y-auto bg-surface-root p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold">
            <span className="text-brand">mushi</span>mushi
          </h1>
          <p className="text-2xs text-fg-faint mt-0.5">admin console</p>
          <p className="text-xs text-fg-muted mt-3 leading-relaxed max-w-xs mx-auto">
            {cloud ? LOGIN_HERO.cloudTagline : LOGIN_HERO.selfHostTagline}
          </p>
        </div>

        {/* Success: signup confirmation */}
        {success === 'signup-confirm' && (
          <div className="bg-surface border border-edge rounded-md p-5 space-y-3">
            <div className="flex items-center justify-center">
              <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full ${CHIP_TONE.okSubtle}`}>
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
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { switchMode('signup'); setEmail(email) }}
                className={`inline !px-0 !py-0 text-2xs ${LINK_ACCENT}`}
              >
                try again
              </Btn>.
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
              <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full ${CHIP_TONE.okSubtle}`}>
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
              <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-brand/30 bg-brand/12 text-brand border border-brand/28">
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
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => switchMode('login')}
                  className={`rounded-sm !border-transparent px-2 py-1.5 text-2xs font-medium shadow-none motion-safe:transition-colors ${mode === 'login' ? 'bg-surface-raised text-fg shadow-card' : 'text-fg-faint hover:text-fg-muted'}`}
                >
                  Password
                </Btn>
                <Btn
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => switchMode('magic')}
                  className={`rounded-sm !border-transparent px-2 py-1.5 text-2xs font-medium shadow-none motion-safe:transition-colors ${mode === 'magic' ? 'bg-surface-raised text-fg shadow-card' : 'text-fg-faint hover:text-fg-muted'}`}
                >
                  Email link
                </Btn>
              </div>
            ) : null}

            {/* OAuth sign-in — only render providers the backend has enabled
                (fetched from GoTrue /settings). While that resolves we withhold
                the buttons so we never flash a provider we're about to hide. */}
            {(mode === 'login' || mode === 'signup') &&
              !authProvidersLoading &&
              (authProviders.github || authProviders.google) && (
              <div className="space-y-2">
                {authProviders.github && (
                  <Btn
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={loading}
                    onClick={() => void signInWithGitHub()}
                    className="w-full justify-center gap-2 rounded-md bg-surface px-3 py-2.5 text-xs font-medium text-fg hover:bg-surface-raised"
                  >
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                    </svg>
                    Continue with GitHub
                  </Btn>
                )}
                {authProviders.google && (
                  <Btn
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={loading}
                    onClick={() => void signInWithGoogle()}
                    className="w-full justify-center gap-2 rounded-md bg-surface px-3 py-2.5 text-xs font-medium text-fg hover:bg-surface-raised"
                  >
                    {/* mushi-mushi-allowlist: Google "G" logo official brand colors (#4285F4/#34A853/#FBBC05/#EA4335) — mandated by Google branding guidelines, cannot be tokenized */}
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continue with Google
                  </Btn>
                )}
                <div className="relative flex items-center gap-2">
                  <div className="h-px flex-1 bg-edge-subtle" />
                  <span className="text-2xs text-fg-faint">or</span>
                  <div className="h-px flex-1 bg-edge-subtle" />
                </div>
              </div>
            )}

            {mode === 'login' && !authProvidersLoading && authProviders.passkeys && (
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                onClick={handlePasskeySignIn}
                disabled={loading || !passkeyAvailable}
                className="group w-full justify-between rounded-md border-brand/30 bg-brand/10 px-3 py-2.5 text-left text-xs text-fg hover:border-brand/60 hover:bg-brand/15"
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
              </Btn>
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
                  <Btn
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearRememberedEmail}
                    className={`shrink-0 !px-0 !py-0 text-2xs ${LINK_ACCENT}`}
                  >
                    Not you?
                  </Btn>
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
              <HelpBanner tone="warn">
                <p className="text-xs text-warn">
                  Cannot connect to <code className="text-2xs bg-surface-raised px-1 rounded">{supabaseHost}</code>.
                  Verify your <code className="text-2xs bg-surface-raised px-1 rounded">VITE_SUPABASE_URL</code> and
                  make sure the Supabase project is running.
                </p>
              </HelpBanner>
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
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => switchMode('forgot')}
                className="block w-full justify-center !px-0 !py-0 text-2xs text-fg-faint hover:text-brand"
              >
                Forgot your password?
              </Btn>
            )}

            <p className="text-center text-2xs text-fg-faint">
              {mode === 'forgot' ? (
                <>
                  Remember your password?{' '}
                  <Btn type="button" variant="ghost" size="sm" onClick={() => switchMode('login')} className={`inline !px-0 !py-0 text-2xs ${LINK_ACCENT}`}>
                    Sign in
                  </Btn>
                </>
              ) : mode === 'magic' ? (
                <>
                  Prefer a password?{' '}
                  <Btn type="button" variant="ghost" size="sm" onClick={() => switchMode('login')} className={`inline !px-0 !py-0 text-2xs ${LINK_ACCENT}`}>
                    Use password
                  </Btn>
                </>
              ) : mode === 'login' ? (
                <>
                  Don't have an account?{' '}
                  <Btn type="button" variant="ghost" size="sm" onClick={() => switchMode('signup')} className={`inline !px-0 !py-0 text-2xs ${LINK_ACCENT}`}>
                    Sign up
                  </Btn>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <Btn type="button" variant="ghost" size="sm" onClick={() => switchMode('login')} className={`inline !px-0 !py-0 text-2xs ${LINK_ACCENT}`}>
                    Sign in
                  </Btn>
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
                        className="text-accent-foreground hover:text-accent underline"
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
