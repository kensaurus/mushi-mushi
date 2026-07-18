import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { supabase } from './supabase'
import type { Session, User } from '@supabase/supabase-js'
import { authRedirectUrl, detectRecoveryFromUrl } from './authRedirect'
import { notifySignOut, subscribeAuthBroadcast } from './authBroadcast'
import { signInWithPasskey as signInWithPasskeyApi } from './passkeys'
import { upsertAccount } from './accountSessions'

// Attach the Supabase user id (UUID — not PII) to every Sentry event so we can
// answer "which user hit this?" without scanning replays. Email is intentionally
// omitted to stay consistent with `sendDefaultPii: false`.
function syncSentryUser(session: Session | null): void {
  if (session?.user?.id) {
    Sentry.setUser({ id: session.user.id })
  } else {
    Sentry.setUser(null)
  }
}

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  isPasswordRecovery: boolean
  clearPasswordRecovery: () => void
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signInWithMagicLink: (email: string) => Promise<{ error?: string }>
  signInWithGitHub: () => Promise<{ error?: string }>
  signInWithGoogle: () => Promise<{ error?: string }>
  /** Sign in as a Mushi Bounties tester via magic-link. Sets signup_intent='tester'
   *  so the DB trigger auto-provisions a mushi_testers row on first login. */
  signInAsTester: (email: string) => Promise<{ error?: string }>
  signInWithPasskey: () => Promise<{ error?: string }>
  signUp: (email: string, password: string) => Promise<{ error?: string; needsConfirmation?: boolean }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error?: string }>
  updatePassword: (newPassword: string) => Promise<{ error?: string }>
}

function getRedirectUrl(): string {
  return authRedirectUrl('/dashboard')
}

function getResetPasswordRedirectUrl(): string {
  return authRedirectUrl('/reset-password')
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  isPasswordRecovery: false,
  clearPasswordRecovery: () => {},
  signIn: async () => ({}),
  signInWithMagicLink: async () => ({}),
  signInWithGitHub: async () => ({}),
  signInWithGoogle: async () => ({}),
  signInAsTester: async () => ({}),
  signInWithPasskey: async () => ({}),
  signUp: async () => ({}),
  signOut: async () => {},
  resetPassword: async () => ({}),
  updatePassword: async () => ({}),
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Seed the recovery flag from the URL on the very first render. supabase-js
  // processes the recovery token asynchronously inside _initialize() and then
  // strips the hash from the URL via history.replaceState. If our React tree
  // mounts a tick later, the PASSWORD_RECOVERY event has already fired and the
  // hash is gone — we'd never know the user came from a reset email. Reading
  // window.location.hash *here* (synchronously, in the useState initializer)
  // captures the signal before either side-effect can race us.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(detectRecoveryFromUrl)

  useEffect(() => {
    // Subscribe BEFORE getSession() so we never miss a PASSWORD_RECOVERY event
    // that supabase-js dispatches while resolving the URL token. The previous
    // ordering registered the listener after getSession()'s promise was kicked
    // off, which on a slow render could miss the event entirely.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      syncSentryUser(session)
      // Keep the multi-account switcher store in sync: a real sign-in (or the
      // initial restored session) records + activates that account; a silent
      // token refresh only updates the stored tokens so a background account's
      // rotating refresh token never goes stale.
      if (session) {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          upsertAccount(session, true)
        } else if (event === 'TOKEN_REFRESHED') {
          upsertAccount(session, false)
        }
      }
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
      }
      if (event === 'SIGNED_OUT') {
        notifySignOut()
        setIsPasswordRecovery(false)
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      syncSentryUser(session)
      if (session) upsertAccount(session, true)
      setLoading(false)
    }).catch(() => setLoading(false))

    const unsubscribeBroadcast = subscribeAuthBroadcast((event) => {
      if (event === 'SIGNED_OUT') {
        setSession(null)
        syncSentryUser(null)
        setIsPasswordRecovery(false)
        return
      }
      if (event === 'ACCOUNT_SWITCHED' && typeof window !== 'undefined') {
        // Another tab switched the active account. Reload so this tab drops any
        // in-memory data from the previous account and boots into the new one.
        window.location.reload()
      }
    })

    return () => {
      subscription.unsubscribe()
      unsubscribeBroadcast()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message }
  }

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getRedirectUrl(),
        shouldCreateUser: false,
      },
    })
    return { error: error?.message }
  }

  const signInWithGitHub = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: getRedirectUrl() },
    })
    return { error: error?.message }
  }

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getRedirectUrl(),
        // Without this, Google silently re-authenticates whichever Google
        // account is already active in the browser session (or the last one
        // used) instead of showing the account chooser — so a user with
        // multiple Google accounts (or a stale session) can never pick a
        // different one. `select_account` forces the chooser every time.
        queryParams: { prompt: 'select_account' },
      },
    })
    return { error: error?.message }
  }

  const signInAsTester = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authRedirectUrl('/tester'),
        shouldCreateUser: true,
        data: { signup_intent: 'tester' },
      },
    })
    return { error: error?.message }
  }

  const signInWithPasskey = async () => signInWithPasskeyApi()

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: getRedirectUrl() },
    })
    if (error) return { error: error.message }
    const needsConfirmation = !data.session && !!data.user
    return { needsConfirmation }
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getResetPasswordRedirectUrl(),
    })
    return { error: error?.message }
  }

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (!error) setIsPasswordRecovery(false)
    return { error: error?.message }
  }

  const clearPasswordRecovery = () => setIsPasswordRecovery(false)

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    syncSentryUser(null)
    setIsPasswordRecovery(false)
  }

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null, loading,
      isPasswordRecovery, clearPasswordRecovery,
      signIn, signInWithMagicLink, signInWithGitHub, signInWithGoogle, signInAsTester, signInWithPasskey, signUp, signOut, resetPassword, updatePassword,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
