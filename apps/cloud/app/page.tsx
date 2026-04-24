import Link from 'next/link'

const features = [
  {
    title: 'User-reported bugs, classified in seconds',
    body: 'A two-stage LLM pipeline turns raw "this is broken" into a structured report with severity, taxonomy, repro steps, and likely root cause.',
  },
  {
    title: 'Agentic fix orchestrator',
    body: 'Mushi opens a draft PR with the fix on your repo. You review and merge — or hand it back for another round.',
  },
  {
    title: 'Knowledge graph + intelligence reports',
    body: 'Every report is linked into a per-project knowledge graph. Get a weekly PDF on top friction trends, blast radius, and customer impact.',
  },
  {
    title: 'BYOK + BYO storage + data residency',
    body: 'Your Anthropic / OpenAI keys, your S3 / R2 / GCS bucket, your region (US / EU / JP). Mushi never sees a model key in plaintext.',
  },
]

// Mirrors `pricing_plans` in 20260419000000_billing_plans.sql.
// Pricing copy here is the marketing surface; the gateway reads the DB catalog.
const pricingTiers = [
  {
    name: 'Hobby',
    price: '$0',
    cadence: 'forever',
    headline: '1,000 reports / month',
    points: [
      'All 8 SDKs (web, mobile, desktop)',
      'Hosted admin console + dashboards',
      '7-day report retention',
      'Up to 3 teammates',
      'Community Discord support',
    ],
    cta: { label: 'Start free', href: '/signup' },
  },
  {
    name: 'Starter',
    price: '$19',
    cadence: '/ project / month',
    headline: '10,000 reports + $0.0025/report after',
    points: [
      'Everything in Hobby',
      'Unlimited teammates',
      '30-day report retention',
      'Plugin marketplace + webhooks',
      'BYOK (bring your own LLM keys)',
      'Email support, 48h SLA',
    ],
    cta: { label: 'Start trial', href: '/signup?plan=starter' },
    featured: true,
  },
  {
    name: 'Pro',
    price: '$99',
    cadence: '/ project / month',
    headline: '50,000 reports + $0.002/report after',
    points: [
      'Everything in Starter',
      '90-day report retention + audit log',
      'SSO (SAML / OIDC)',
      'Weekly intelligence reports (PDF)',
      'Priority support, 8h SLA',
    ],
    cta: { label: 'Start trial', href: '/signup?plan=pro' },
  },
  {
    name: 'Enterprise',
    price: 'Talk',
    cadence: 'to us',
    headline: 'Unlimited volume, self-hosted, SOC 2',
    points: [
      'Everything in Pro',
      'Unlimited reports, 365-day retention',
      'Self-hosted (your VPC) or dedicated cloud',
      'SCIM provisioning, custom DPA',
      'Annual SOC 2 / ISO evidence pack',
      'Dedicated success engineer, 4h SLA',
    ],
    cta: { label: 'Email sales', href: 'mailto:kensaurus@gmail.com?subject=Enterprise%20inquiry' },
  },
]

// Optional add-ons surfaced under the tier grid. Keeps the headline tiers
// readable while still flagging that there's a Teams seat-pack story.
const addOns = [
  {
    name: 'Teams pack',
    body: 'Add 5 reviewer seats with read-only triage scope. Useful for support / PMs who need to read reports but not deploy fixes.',
    price: '$10 / 5 seats / month',
  },
  {
    name: 'Extended retention',
    body: 'Bump report + audit retention beyond your tier default. Required for some regulated industries.',
    price: 'From $25 / month',
  },
]

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <span aria-hidden>🪲</span>
          <span>Mushi Mushi</span>
        </div>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="https://docs.mushimushi.dev" className="text-neutral-400 hover:text-white">
            Docs
          </Link>
          <Link href="/login" className="text-neutral-400 hover:text-white">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-indigo-500 px-3 py-1.5 font-medium text-white hover:bg-indigo-400"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="mt-20 max-w-3xl">
        <h1 className="text-balance text-5xl font-semibold tracking-tight">
          Bug intelligence that <span className="text-indigo-400">fixes itself</span>.
        </h1>
        <p className="mt-6 text-lg text-neutral-300">
          Your users find bugs your monitoring can't. Mushi Mushi captures
          their reports, classifies them with a self-improving LLM pipeline,
          and opens fix PRs autonomously. Pay only for what you ingest.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/signup"
            className="rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
          >
            Start free — 1,000 reports / month
          </Link>
          <Link
            href="https://docs.mushimushi.dev/quickstart"
            className="rounded-md border border-neutral-700 px-4 py-2 font-medium hover:border-neutral-500"
          >
            Read the quickstart →
          </Link>
        </div>
      </section>

      <section className="mt-24 grid gap-6 sm:grid-cols-2">
        {features.map((f) => (
          <article
            key={f.title}
            className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-6"
          >
            <h2 className="text-lg font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-neutral-300">{f.body}</p>
          </article>
        ))}
      </section>

      <section id="pricing" className="mt-24">
        <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
        <p className="mt-2 text-neutral-400">
          Pay for outcomes — flat plan + cheap overage. No seat tax, no PR fees.
          Cancel any time.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {pricingTiers.map((tier) => (
            <article
              key={tier.name}
              className={`flex flex-col rounded-xl border p-6 ${
                tier.featured
                  ? 'border-indigo-400 bg-indigo-500/10'
                  : 'border-neutral-800 bg-neutral-950/60'
              }`}
            >
              <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
                {tier.name}
              </h3>
              <p className="mt-3">
                <span className="text-3xl font-semibold">{tier.price}</span>{' '}
                <span className="text-sm text-neutral-400">{tier.cadence}</span>
              </p>
              <p className="mt-1 text-sm text-neutral-300">{tier.headline}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-neutral-300">
                {tier.points.map((p) => (
                  <li key={p}>· {p}</li>
                ))}
              </ul>
              <Link
                href={tier.cta.href}
                className={`mt-6 inline-block rounded-md px-4 py-2 text-center text-sm font-medium ${
                  tier.featured
                    ? 'bg-indigo-500 text-white hover:bg-indigo-400'
                    : 'border border-neutral-700 hover:border-neutral-500'
                }`}
              >
                {tier.cta.label}
              </Link>
            </article>
          ))}
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {addOns.map((addon) => (
            <article
              key={addon.name}
              className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-sm font-semibold text-neutral-200">{addon.name}</h4>
                <span className="text-xs text-neutral-400">{addon.price}</span>
              </div>
              <p className="mt-2 text-sm text-neutral-400">{addon.body}</p>
            </article>
          ))}
        </div>

        <p className="mt-6 text-xs text-neutral-500">
          Prices in USD. EU, UK, and JP customers are billed in their local
          currency at Stripe's daily rate. Volume discounts available for
          annual contracts — <Link href="mailto:kensaurus@gmail.com" className="underline">talk to us</Link>.
        </p>
      </section>

      <footer className="mt-24 border-t border-neutral-900 pt-8 text-sm text-neutral-500">
        <p>
          OSS-first — every line of code is in{' '}
          <Link href="https://github.com/kensaurus/mushi-mushi" className="underline">
            kensaurus/mushi-mushi
          </Link>
          . Cloud runs the same code, hosted by us.
        </p>
      </footer>
    </main>
  )
}
