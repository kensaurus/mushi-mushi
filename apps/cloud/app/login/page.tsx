import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServer } from '@/lib/supabase-server'

const signIn = async (formData: FormData) => {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const supabase = await getSupabaseServer()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
  redirect('/dashboard')
}

export default async function LoginPage({
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
      <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>

      <form action={signIn} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
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
            autoComplete="current-password"
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
          Sign in
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-400">
        New to Mushi?{' '}
        <Link href="/signup" className="text-indigo-400 hover:underline">
          Create an account
        </Link>
      </p>
    </main>
  )
}
