import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServer } from '@/lib/supabase-server'
import {
  AuthError,
  AuthField,
  AuthShell,
  authInputClass,
  authPrimaryBtnClass,
} from '@/app/_components/AuthShell'

const signIn = async (formData: FormData) => {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const supabase = await getSupabaseServer()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
  redirect('/dashboard')
}

// Map the small set of machine error codes the callback / signup hand back
// into language a returning user can act on. Anything else passes through
// unchanged (Supabase produces sentence-form messages for credential errors).
const friendlyError = (raw: string): string => {
  switch (raw) {
    case 'missing_code':
      return 'That confirmation link was incomplete — try clicking it again from your email, or request a new sign-in below.'
    case 'auth_callback_failed':
      return "We couldn't finish signing you in. Please try the magic link from your email again, or sign in with your password."
    default:
      return raw
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error: errorRaw } = await searchParams
  const error = errorRaw ? friendlyError(errorRaw) : undefined
  return (
    <AuthShell
      chapter="Chapter 04 / sign in"
      title="Welcome back."
      subtitle="Pick up where you left off — your projects, billing, and weekly intelligence reports are still waiting."
      footer={
        <>
          New here?{' '}
          <Link
            href="/signup"
            className="font-mono uppercase tracking-[0.18em] text-[var(--mushi-vermillion)] underline decoration-[var(--mushi-vermillion)] underline-offset-4 hover:text-[var(--mushi-ink)]"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form action={signIn} className="space-y-5">
        <AuthField id="email" label="Email">
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@acme.com"
            className={authInputClass}
          />
        </AuthField>

        <AuthField id="password" label="Password">
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••••••"
            className={authInputClass}
          />
        </AuthField>

        {error ? <AuthError>{error}</AuthError> : null}

        <button type="submit" className={authPrimaryBtnClass}>
          Sign in →
        </button>
      </form>
    </AuthShell>
  )
}
