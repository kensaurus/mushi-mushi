import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { supabase } from './supabase'
import type { Session, User } from '@supabase/supabase-js'
import { authRedirectUrl } from './authRedirect'
import { notifySignOut, subscribeAuthBroadcast } from './authBroadcast'
import { signInWithPasskey as signInWithPasskeyApi } from './passkeys'

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
  signInWithPasskey: async () => ({}),
  signUp: async () => ({}),
  signOut: async () => {},
  resetPassword: async () => ({}),
  updatePassword: async () => ({}),
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      syncSentryUser(session)
      setLoading(false)
    }).catch(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      syncSentryUser(session)
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
      }
      if (event === 'SIGNED_OUT') {
        notifySignOut()
        setIsPasswordRecovery(false)
      }
    })

    const unsubscribeBroadcast = subscribeAuthBroadcast((event) => {
      if (event !== 'SIGNED_OUT') return
      setSession(null)
      syncSentryUser(null)
      setIsPasswordRecovery(false)
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
      signIn, signInWithMagicLink, signInWithPasskey, signUp, signOut, resetPassword, updatePassword,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
