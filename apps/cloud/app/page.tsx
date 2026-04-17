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

const pricingTiers = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    headline: '1,000 reports / month',
    points: [
      'All web + mobile SDKs',
      'Hosted admin console',
      'Community Discord support',
    ],
    cta: { label: 'Start free', href: '/signup' },
  },
  {
    name: 'Cloud',
    price: '$0.0025',
    cadence: 'per ingested report',
    headline: 'After 1,000 free, no seat caps',
    points: [
      'Everything in Free',
      'Unlimited team members',
      'Plugin marketplace + webhooks',
      'Priority email support',
    ],
    cta: { label: 'Add a card', href: '/signup' },
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Talk',
    cadence: 'to us',
    headline: 'SOC 2 evidence, SSO, BYOK, BYO storage',
    points: [
      'Everything in Cloud',
      'SAML SSO, SCIM',
      'Self-hosted option',
      'Annual SOC 2 evidence pack',
    ],
    cta: { label: 'Email sales', href: 'mailto:hello@mushimushi.dev' },
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
          Usage-based — no seat tax, no surprise overage. Upgrade in 60s.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {pricingTiers.map((tier) => (
            <article
              key={tier.name}
              className={`rounded-xl border p-6 ${
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
              <ul className="mt-4 space-y-1.5 text-sm text-neutral-300">
                {tier.points.map((p) => (
                  <li key={p}>· {p}</li>
                ))}
              </ul>
              <Link
                href={tier.cta.href}
                className={`mt-6 inline-block rounded-md px-4 py-2 text-sm font-medium ${
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
