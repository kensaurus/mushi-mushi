import { redirect } from 'next/navigation'
import Link from 'next/link'
import { apiBaseUrl, getSupabaseServer } from '@/lib/supabase-server'
import { adminUrl, docsUrl } from '@/lib/links'

interface BillingState {
  customer: { stripe_customer_id: string; email: string; default_payment_ok: boolean } | null
  subscription: { status: string; current_period_end: string; cancel_at_period_end: boolean } | null
  usage: { reports_last_30d: number }
}

const fetchBilling = async (token: string, projectId: string): Promise<BillingState | null> => {
  try {
    const res = await fetch(
      `${apiBaseUrl()}/api/v1/admin/billing?project_id=${projectId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { ok: boolean } & BillingState
    return json.ok ? json : null
  } catch {
    return null
  }
}

// All admin API responses use the wrapped envelope `{ ok, data: { ... } }`.
// The cloud dashboard talks to the gateway with a plain `fetch` (no apiFetch
// helper, unlike apps/admin), so we have to unwrap `data` ourselves —
// reading `json.url` directly was the bug that silently broke both the
// "Add a card" and "Manage card" buttons in production.
type CheckoutResponse = { ok: boolean; data?: { url?: string; plan_id?: string } }
type PortalResponse = { ok: boolean; data?: { url?: string } }

const startCheckout = async (formData: FormData) => {
  'use server'
  const projectId = String(formData.get('project_id') ?? '')
  // Plan tier the user picked on the marketing landing (`/signup?plan=…`).
  // We persist it in user_metadata at signup; here we round-trip it through
  // a hidden form field so the server-action body is self-contained.
  const planId = (() => {
    const raw = String(formData.get('plan_id') ?? '').trim().toLowerCase()
    return raw === 'pro' || raw === 'starter' ? raw : 'starter'
  })()
  const supabase = await getSupabaseServer()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const email = data.session?.user?.email
  if (!token || !email) redirect('/login')
  const res = await fetch(`${apiBaseUrl()}/api/v1/admin/billing/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ project_id: projectId, email, plan_id: planId }),
  })
  const json = (await res.json()) as CheckoutResponse
  if (json.ok && json.data?.url) redirect(json.data.url)
  redirect(`/dashboard?error=checkout_failed`)
}

const openPortal = async (formData: FormData) => {
  'use server'
  const projectId = String(formData.get('project_id') ?? '')
  const supabase = await getSupabaseServer()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) redirect('/login')
  const res = await fetch(`${apiBaseUrl()}/api/v1/admin/billing/portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ project_id: projectId }),
  })
  const json = (await res.json()) as PortalResponse
  if (json.ok && json.data?.url) redirect(json.data.url)
  redirect(`/dashboard?error=portal_failed`)
}

const signOut = async () => {
  'use server'
  const supabase = await getSupabaseServer()
  await supabase.auth.signOut()
  redirect('/login')
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const supabase = await getSupabaseServer()
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session
  if (!session) redirect('/login')

  const { error: errorRaw } = await searchParams
  const errorBanner = (() => {
    if (errorRaw === 'checkout_failed') {
      return "Stripe checkout couldn't be opened. Try again, or email us if it keeps happening."
    }
    if (errorRaw === 'portal_failed') {
      return "We couldn't open the billing portal. Refresh and try again — your subscription is unaffected."
    }
    return null
  })()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(1)
  const project = projects?.[0]

  // Empty-state branch — same editorial chrome as the populated dashboard
  // so users feel they landed somewhere intentional, not a flash of nothing.
  if (!project) {
    return (
      <DashboardChrome session={session} onSignOut={signOut}>
        <article className="rounded-2xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-8 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--mushi-vermillion)]">
            Provisioning
          </p>
          <h2 className="mt-3 font-serif text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--mushi-ink)]">
            Welcome — your project is being provisioned.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--mushi-ink-muted)]">
            This usually takes about ten seconds. Refresh the page to see your
            dashboard appear, or skim the quickstart while you wait.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-full bg-[var(--mushi-ink)] px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mushi-paper)] shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-[color-mix(in_oklch,var(--mushi-ink)_82%,var(--mushi-vermillion))]"
            >
              Refresh →
            </Link>
            <Link
              href={docsUrl('/quickstart')}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--mushi-rule)] bg-white/40 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mushi-ink)] transition hover:border-[var(--mushi-vermillion)] hover:text-[var(--mushi-vermillion)]"
            >
              Skim the quickstart
            </Link>
          </div>
        </article>
      </DashboardChrome>
    )
  }

  const billing = await fetchBilling(session.access_token, project.id)
  const subscribed = billing?.subscription?.status === 'active'
  const reports30d = billing?.usage.reports_last_30d ?? 0
  const FREE_TIER = 1000
  const overage = Math.max(0, reports30d - FREE_TIER)
  const adminConsoleUrl = adminUrl()

  // Pulled from `user_metadata.signup_plan` set by the signup server action
  // when the user lands on `/signup?plan=starter|pro` from the marketing
  // pricing CTAs. Without this, both `Start trial` buttons used to
  // funnel everyone into the same Starter checkout — a silent dead link
  // for anyone who clicked the Pro tier.
  const signupPlan = (() => {
    const raw = String(
      (session.user.user_metadata as Record<string, unknown> | null)?.signup_plan ?? '',
    ).toLowerCase()
    return raw === 'pro' ? 'pro' : 'starter'
  })()

  // Usage / quota maths. We render a vermillion ledger bar that fills as
  // the user's report count approaches the free-tier ceiling — same metaphor
  // as the Hero report preview's "Loop coverage 87%" pill, so a returning
  // user sees the brand language carry across surfaces.
  const usagePct = Math.min(100, Math.round((reports30d / FREE_TIER) * 100))

  const subscriptionLine = (() => {
    if (billing?.subscription?.current_period_end) {
      const date = new Date(billing.subscription.current_period_end).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
      return billing.subscription.cancel_at_period_end
        ? `Cancels on ${date}`
        : `Renews on ${date}`
    }
    return 'Add a card any time to lift the cap.'
  })()

  return (
    <DashboardChrome session={session} onSignOut={signOut}>
      {/* Header strip — project label + admin console pull-through */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--mushi-rule)] pb-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--mushi-vermillion)]">
            Project ledger
          </p>
          <h1 className="mt-2 font-serif text-4xl font-semibold leading-[1] tracking-[-0.04em] text-[var(--mushi-ink)] sm:text-5xl">
            {project.name}
          </h1>
          <p className="mt-2 font-mono text-[11px] text-[var(--mushi-ink-muted)]">
            ID · {project.id}
          </p>
        </div>
        <Link
          href={adminConsoleUrl}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--mushi-rule)] bg-white/40 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mushi-ink)] transition hover:border-[var(--mushi-vermillion)] hover:text-[var(--mushi-vermillion)]"
        >
          Open admin console
          <span aria-hidden>→</span>
        </Link>
      </div>

      {errorBanner ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-[var(--mushi-vermillion)]/40 bg-[var(--mushi-vermillion-wash)] px-4 py-3 text-sm leading-6 text-[var(--mushi-vermillion-ink)]"
        >
          {errorBanner}
        </p>
      ) : null}

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        {/* Reports — vermillion fill bar, ledger numbers in display serif */}
        <article className="rounded-2xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-6 shadow-[0_30px_60px_-48px_rgba(14,13,11,0.45)]">
          <header className="flex items-baseline justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
              Reports · last 30 days
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
              {usagePct}%
            </p>
          </header>
          <p className="mt-4 font-serif text-5xl font-semibold leading-none tracking-[-0.04em] text-[var(--mushi-ink)] tabular-nums sm:text-6xl">
            {reports30d.toLocaleString()}
          </p>
          <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--mushi-paper-wash)]">
            <div
              role="progressbar"
              aria-valuenow={usagePct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-full rounded-full bg-[var(--mushi-vermillion)] transition-[width] duration-500"
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <p className="mt-3 text-[12px] leading-5 text-[var(--mushi-ink-muted)]">
            {overage > 0 ? (
              <>
                <span className="font-mono uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
                  +{overage.toLocaleString()}
                </span>{' '}
                billable @ $0.0025 ·{' '}
                <span className="font-mono text-[var(--mushi-ink)]">
                  ${(overage * 0.0025).toFixed(2)}
                </span>
              </>
            ) : (
              <>
                <span className="font-mono text-[var(--mushi-ink)]">
                  {(FREE_TIER - reports30d).toLocaleString()}
                </span>{' '}
                of <span className="font-mono">{FREE_TIER.toLocaleString()}</span> free remaining
              </>
            )}
          </p>
        </article>

        {/* Subscription — quiet card, status as serif word */}
        <article className="rounded-2xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-6 shadow-[0_30px_60px_-48px_rgba(14,13,11,0.45)]">
          <header className="flex items-baseline justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
              Subscription
            </p>
            <p
              className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
                subscribed
                  ? 'text-[var(--mushi-vermillion)]'
                  : 'text-[var(--mushi-ink-muted)]'
              }`}
            >
              {subscribed ? 'Active' : 'Free tier'}
            </p>
          </header>
          <p className="mt-4 font-serif text-5xl font-semibold leading-none tracking-[-0.04em] capitalize text-[var(--mushi-ink)] sm:text-6xl">
            {billing?.subscription?.status ?? 'Hobby'}
          </p>
          <p className="mt-5 text-[12px] leading-5 text-[var(--mushi-ink-muted)]">
            {subscriptionLine}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)]">
            {billing?.customer?.email ?? session.user.email}
          </p>
        </article>
      </section>

      {/* Billing — primary action row */}
      <section className="mt-8 rounded-2xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-6 shadow-[0_30px_60px_-48px_rgba(14,13,11,0.45)] sm:p-8">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--mushi-rule)] pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-vermillion)]">
              Chapter 05 / billing
            </p>
            <h2 className="mt-2 font-serif text-2xl font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--mushi-ink)] sm:text-3xl">
              {subscribed ? 'Manage your card &amp; invoices' : 'Lift the cap when you outgrow free'}
            </h2>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)]">
            Stripe · cancel anytime
          </p>
        </header>

        {subscribed ? (
          <form action={openPortal} className="mt-5">
            <input type="hidden" name="project_id" value={project.id} />
            <p className="text-sm leading-6 text-[var(--mushi-ink-muted)]">
              Stripe&rsquo;s billing portal lets you swap cards, download invoices, or pause your
              subscription. We never see your card details.
            </p>
            <button
              type="submit"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--mushi-ink)] px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mushi-paper)] shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-[color-mix(in_oklch,var(--mushi-ink)_82%,var(--mushi-vermillion))]"
            >
              Manage card &amp; invoices
              <span aria-hidden>→</span>
            </button>
          </form>
        ) : (
          <form action={startCheckout} className="mt-5">
            <input type="hidden" name="project_id" value={project.id} />
            <input type="hidden" name="plan_id" value={signupPlan} />
            <p className="text-sm leading-6 text-[var(--mushi-ink-muted)]">
              {signupPlan === 'pro' ? (
                <>
                  You picked <span className="text-[var(--mushi-ink)]">Pro</span> on signup —
                  that&rsquo;s <span className="font-mono text-[var(--mushi-ink)]">$99</span> /
                  project / month for 50,000 reports plus{' '}
                  <span className="font-mono">$0.002</span> per report after that.
                </>
              ) : (
                <>
                  Add a card to ingest more than{' '}
                  <span className="font-mono text-[var(--mushi-ink)]">
                    {FREE_TIER.toLocaleString()}
                  </span>{' '}
                  reports / month. We charge <span className="font-mono">$0.0025</span> per report
                  after that — no seat tax.
                </>
              )}
            </p>
            <button
              type="submit"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--mushi-vermillion)] px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] transition hover:bg-[color-mix(in_oklch,var(--mushi-vermillion)_82%,var(--mushi-ink))]"
            >
              {signupPlan === 'pro' ? 'Subscribe to Pro via Stripe' : 'Add a card via Stripe'}
              <span aria-hidden>→</span>
            </button>
          </form>
        )}
      </section>

      {/* Quiet utility row — docs + admin link as a closer */}
      <footer className="mt-10 grid gap-4 border-t border-[var(--mushi-rule)] pt-6 text-[12px] leading-5 text-[var(--mushi-ink-muted)] sm:grid-cols-3">
        <p>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
            Docs
          </span>{' '}
          ·{' '}
          <Link
            href={docsUrl('/quickstart')}
            className="text-[var(--mushi-ink)] underline decoration-[var(--mushi-vermillion)] underline-offset-4 hover:text-[var(--mushi-vermillion)]"
          >
            Quickstart
          </Link>
          {' · '}
          <Link
            href={adminUrl('/reports')}
            className="text-[var(--mushi-ink)] underline decoration-[var(--mushi-vermillion)] underline-offset-4 hover:text-[var(--mushi-vermillion)]"
          >
            Reports
          </Link>
        </p>
        <p>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
            Console
          </span>{' '}
          ·{' '}
          <Link
            href={adminConsoleUrl}
            className="text-[var(--mushi-ink)] underline decoration-[var(--mushi-vermillion)] underline-offset-4 hover:text-[var(--mushi-vermillion)]"
          >
            Open admin
          </Link>
        </p>
        <p className="sm:text-right">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
            Loop
          </span>{' '}
          ·{' '}
          <Link
            href="/#loop"
            className="text-[var(--mushi-ink)] underline decoration-[var(--mushi-vermillion)] underline-offset-4 hover:text-[var(--mushi-vermillion)]"
          >
            Replay the seven stages
          </Link>
        </p>
      </footer>
    </DashboardChrome>
  )
}

/**
 * Dashboard-page chrome (header bar + outer paper sheet). Pulled into a
 * sub-component so both the populated and provisioning views share the
 * exact same shell — no flash of layout shift between empty / populated.
 */
function DashboardChrome({
  session,
  onSignOut,
  children,
}: {
  session: { user: { email?: string | null } }
  onSignOut: () => Promise<void>
  children: React.ReactNode
}) {
  const email = session.user.email ?? '—'
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 pb-12 pt-6">
      <header className="flex items-center justify-between rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)] px-4 py-2 shadow-[0_18px_40px_-32px_rgba(14,13,11,0.5)] backdrop-blur sm:px-5">
        <Link
          href="/"
          className="flex items-center gap-2 font-serif text-base font-semibold text-[var(--mushi-ink)]"
        >
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-sm bg-[var(--mushi-vermillion)] font-mono text-xs text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]"
          >
            虫
          </span>
          <span>Mushi Mushi</span>
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span
            className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)] sm:inline"
            title={email}
          >
            {email}
          </span>
          <form action={onSignOut}>
            <button
              type="submit"
              className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mt-10">{children}</section>
    </main>
  )
}
