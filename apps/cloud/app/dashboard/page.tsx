import { redirect } from 'next/navigation'
import Link from 'next/link'
import { apiBaseUrl, getSupabaseServer } from '@/lib/supabase-server'

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

export default async function DashboardPage() {
  const supabase = await getSupabaseServer()
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session
  if (!session) redirect('/login')

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(1)
  const project = projects?.[0]
  if (!project) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold">Welcome 👋</h1>
        <p className="mt-3 text-neutral-400">
          Your project is being provisioned. Refresh in a few seconds.
        </p>
      </main>
    )
  }

  const billing = await fetchBilling(session.access_token, project.id)
  const subscribed = billing?.subscription?.status === 'active'
  const reports30d = billing?.usage.reports_last_30d ?? 0
  const FREE_TIER = 1000
  const overage = Math.max(0, reports30d - FREE_TIER)
  const adminConsoleUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.mushimushi.dev'

  // Pulled from `user_metadata.signup_plan` set by the signup server action
  // when the user lands on `/signup?plan=starter|pro` from the marketing
  // pricing CTAs. Without this, both `Start trial` buttons used to
  // funnel everyone into the same Starter checkout — a silent dead link
  // for anyone who clicked the Pro tier.
  const signupPlan = (() => {
    const raw = String((session.user.user_metadata as Record<string, unknown> | null)?.signup_plan ?? '').toLowerCase()
    return raw === 'pro' ? 'pro' : 'starter'
  })()

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-sm text-neutral-400 hover:text-white">
          ← Home
        </Link>
        <Link
          href={adminConsoleUrl}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500"
        >
          Open admin console →
        </Link>
      </header>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight">{project.name}</h1>
      <p className="mt-2 text-sm text-neutral-400">Project ID: {project.id}</p>

      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <article className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Reports last 30 days
          </h2>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{reports30d.toLocaleString()}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {overage > 0
              ? `${overage.toLocaleString()} billable @ $0.0025 = $${(overage * 0.0025).toFixed(2)}`
              : `${(FREE_TIER - reports30d).toLocaleString()} of ${FREE_TIER.toLocaleString()} free remaining`}
          </p>
        </article>

        <article className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Subscription
          </h2>
          <p className="mt-2 text-3xl font-semibold capitalize">
            {billing?.subscription?.status ?? 'Free tier'}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {billing?.subscription?.current_period_end
              ? `Renews ${new Date(billing.subscription.current_period_end).toLocaleDateString()}`
              : 'Add a card any time to lift the cap.'}
          </p>
        </article>
      </section>

      <section className="mt-10 rounded-xl border border-neutral-800 bg-neutral-950/60 p-6">
        <h2 className="text-lg font-semibold">Billing</h2>
        {subscribed ? (
          <form action={openPortal} className="mt-4">
            <input type="hidden" name="project_id" value={project.id} />
            <button
              type="submit"
              className="rounded-md border border-neutral-700 px-4 py-2 hover:border-neutral-500"
            >
              Manage card / invoices →
            </button>
          </form>
        ) : (
          <form action={startCheckout} className="mt-4">
            <input type="hidden" name="project_id" value={project.id} />
            <input type="hidden" name="plan_id" value={signupPlan} />
            <p className="text-sm text-neutral-400">
              {signupPlan === 'pro'
                ? `You picked Pro on signup — that's $99 / project / month for 50,000 reports + $0.002 per report after.`
                : `Add a payment method to ingest more than ${FREE_TIER.toLocaleString()} reports per month. We charge $0.0025 per report after that — no seat tax.`}
            </p>
            <button
              type="submit"
              className="mt-3 rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
            >
              {signupPlan === 'pro' ? 'Subscribe to Pro via Stripe →' : 'Add a card via Stripe →'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
