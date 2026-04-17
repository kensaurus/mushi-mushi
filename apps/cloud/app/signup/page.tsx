import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServer } from '@/lib/supabase-server'

const signUp = async (formData: FormData) => {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const orgName = String(formData.get('org') ?? '').trim()
  if (!email || !password || !orgName) {
    redirect(`/signup?error=missing_fields`)
  }

  const supabase = await getSupabaseServer()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.mushimushi.dev'}/auth/callback`,
      data: { org_name: orgName },
    },
  })
  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`)
  }
  redirect('/signup/check-email')
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-8 text-sm text-neutral-400 hover:text-white">
        ← Back to home
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Create your project</h1>
      <p className="mt-2 text-sm text-neutral-400">
        1,000 reports / month, free forever. No credit card to start.
      </p>

      <form action={signUp} className="mt-8 space-y-4">
        <div>
          <label htmlFor="org" className="text-sm font-medium">Organisation name</label>
          <input
            id="org"
            name="org"
            required
            autoComplete="organization"
            placeholder="Acme Inc."
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-indigo-400"
          />
        </div>
        <div>
          <label htmlFor="email" className="text-sm font-medium">Work email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@acme.com"
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-indigo-400"
          />
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={12}
            placeholder="At least 12 characters"
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-indigo-400"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          className="w-full rounded-md bg-indigo-500 px-4 py-2.5 font-medium text-white hover:bg-indigo-400"
        >
          Create account
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-400">
        Already have an account?{' '}
        <Link href="/login" className="text-indigo-400 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  )
}
