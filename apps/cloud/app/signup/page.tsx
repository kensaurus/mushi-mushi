import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServer } from '@/lib/supabase-server'
import { cloudUrl } from '@/lib/links'
import {
  AuthError,
  AuthField,
  AuthShell,
  authInputClass,
  authPrimaryBtnClass,
} from '@/app/_components/AuthShell'

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

const planCopy: Record<SignupPlan, { headline: string; subline: string }> = {
  pro: {
    headline: 'Pro tier · $99 / project / month',
    subline:
      "We'll start your trial after email verification — 50,000 reports included, $0.002 per report after that.",
  },
  starter: {
    headline: 'Starter tier · $19 / project / month',
    subline:
      "We'll start your trial after email verification — 10,000 reports included, $0.0025 per report after that.",
  },
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
      emailRedirectTo: cloudUrl('/auth/callback'),
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
  const subtitle = plan
    ? planCopy[plan].subline
    : '1,000 reports / month, free forever — no card to start.'
  const planHeadline = plan ? planCopy[plan].headline : 'Hobby tier · free forever'

  return (
    <AuthShell
      chapter="Chapter 04 / create your project"
      title="Sign up to Mushi Mushi"
      subtitle={subtitle}
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-mono uppercase tracking-[0.18em] text-[var(--mushi-vermillion)] underline decoration-[var(--mushi-vermillion)] underline-offset-4 hover:text-[var(--mushi-ink)]"
          >
            Sign in
          </Link>
        </>
      }
    >
      <div className="mb-5 flex items-baseline justify-between gap-3 border-b border-[var(--mushi-rule)] pb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
          Selected
        </p>
        <p className="font-serif text-sm text-[var(--mushi-ink)] sm:text-base">{planHeadline}</p>
      </div>

      <form action={signUp} className="space-y-5">
        {plan ? <input type="hidden" name="plan" value={plan} /> : null}

        <AuthField id="org" label="Organisation">
          <input
            id="org"
            name="org"
            required
            autoComplete="organization"
            placeholder="Acme Inc."
            className={authInputClass}
          />
        </AuthField>

        <AuthField id="email" label="Work email">
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

        <AuthField
          id="password"
          label="Password"
          hint="Twelve characters or more — we'll never email it back to you."
        >
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={12}
            placeholder="••••••••••••"
            className={authInputClass}
          />
        </AuthField>

        {error ? <AuthError>{error}</AuthError> : null}

        <button type="submit" className={authPrimaryBtnClass}>
          {plan === 'pro'
            ? 'Start the Pro trial →'
            : plan === 'starter'
              ? 'Start the Starter trial →'
              : 'Create my free project →'}
        </button>
      </form>
    </AuthShell>
  )
}
