import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServer } from '@/lib/supabase-server'

// Mirrors the marketing landing's pricing CTAs: `?plan=starter` and
// `?plan=pro` flow through here so the user's tier choice survives the
// signup → email-verification → first-checkout journey instead of being
// silently dropped (the original bug). Hobby is the default free tier
// and doesn't need a plan tag; Enterprise is sales-led and never lands here.
type SignupPlan = 'starter' | 'pro'

const parsePlan = (raw: string | undefined): SignupPlan | null => {
  const v = (raw ?? '').trim().toLowerCase()
  return v === 'starter' || v === 'pro' ? v : null
}

const signUp = async (formData: FormData) => {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const orgName = String(formData.get('org') ?? '').trim()
  const plan = parsePlan(String(formData.get('plan') ?? ''))
  if (!email || !password || !orgName) {
    redirect(plan ? `/signup?plan=${plan}&error=missing_fields` : `/signup?error=missing_fields`)
  }

  const supabase = await getSupabaseServer()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.mushimushi.dev'}/auth/callback`,
      data: {
        org_name: orgName,
        // `signup_plan` is read by /dashboard's startCheckout server action
        // so the tier the user clicked on the marketing landing makes it all
        // the way to Stripe Checkout. Stored as user_metadata, not on the
        // project, because the user might create more projects later.
        ...(plan ? { signup_plan: plan } : {}),
      },
    },
  })
  if (error) {
    const errParam = encodeURIComponent(error.message)
    redirect(plan ? `/signup?plan=${plan}&error=${errParam}` : `/signup?error=${errParam}`)
  }
  redirect('/signup/check-email')
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; plan?: string }>
}) {
  const { error, plan: planRaw } = await searchParams
  const plan = parsePlan(planRaw)
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-8 text-sm text-neutral-400 hover:text-white">
        ← Back to home
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Create your project</h1>
      <p className="mt-2 text-sm text-neutral-400">
        {plan === 'pro'
          ? 'Pro tier ($99 / project / month) — we\'ll start your trial after email verification.'
          : plan === 'starter'
            ? 'Starter tier ($19 / project / month) — we\'ll start your trial after email verification.'
            : '1,000 reports / month, free forever. No credit card to start.'}
      </p>

      <form action={signUp} className="mt-8 space-y-4">
        {plan && <input type="hidden" name="plan" value={plan} />}
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
