import Link from 'next/link'
import { ClosingCta } from './_components/ClosingCta'
import { Hero } from './_components/Hero'
import { MarketingFooter } from './_components/MarketingFooter'
import { MushiCanvas } from './_components/MushiCanvas'
import { contactMailto, docsUrl, repoUrl } from '@/lib/links'

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
    cta: { label: 'Email sales', href: contactMailto('Enterprise inquiry') },
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
    <main className="mx-auto max-w-6xl space-y-12 px-6 pb-10 pt-4">
      <header className="sticky top-3 z-30 flex items-center justify-between rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)] px-4 py-2 shadow-[0_18px_40px_-32px_rgba(14,13,11,0.5)] backdrop-blur sm:px-5">
        <Link href="/" className="flex items-center gap-2 font-serif text-base font-semibold text-[var(--mushi-ink)]">
          <span className="grid h-7 w-7 place-items-center rounded-sm bg-[var(--mushi-vermillion)] font-mono text-xs text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]" aria-hidden>
            虫
          </span>
          <span>Mushi Mushi</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <Link href="#loop" className="hidden rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)] sm:inline-block">
            Loop
          </Link>
          <Link href="#pricing" className="hidden rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)] sm:inline-block">
            Pricing
          </Link>
          <Link href={docsUrl()} className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)]">
            Docs
          </Link>
          <Link href="/login" className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)]">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="ml-1 rounded-full bg-[var(--mushi-ink)] px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--mushi-paper)] shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-[color-mix(in_oklch,var(--mushi-ink)_82%,var(--mushi-vermillion))]"
          >
            Get started
          </Link>
        </nav>
      </header>

      <Hero />
      <MushiCanvas />

      {/* Pricing — deliberately small. The OSS path is the answer; cloud
          tiers are an inline footnote so the page never reads as a sales
          pitch. Hobby ($0 / 1k reports) lives inside the self-host panel as
          "or use our free cloud" so the free tier doesn't get lost. */}
      <section id="pricing" className="space-y-4">
        <header className="border-t border-[var(--mushi-rule)] pt-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--mushi-vermillion)]">
            Chapter 03 / honest pricing
          </p>
          <h2 className="mt-2 max-w-2xl font-serif text-3xl font-semibold leading-[1] tracking-[-0.04em] text-[var(--mushi-ink)] sm:text-4xl">
            Free, open source, and run-it-yourself.
          </h2>
        </header>

        <article className="relative overflow-hidden rounded-2xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-6 sm:p-8">
          <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
                Self-host
              </p>
              <p className="mt-2 flex items-baseline gap-2">
                <span className="font-serif text-5xl font-semibold leading-none tracking-[-0.04em] text-[var(--mushi-ink)] sm:text-6xl">
                  $0
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--mushi-vermillion)]">
                  MIT · forever
                </span>
              </p>
            </div>
            <p className="text-sm leading-6 text-[var(--mushi-ink-muted)] sm:text-base sm:leading-7">
              Clone the repo. Run the same admin, gateway, and SDKs on your
              keys, your storage, your VPC. We never see a request. Or use
              our free cloud tier &mdash; <span className="font-mono text-[var(--mushi-ink)]">1,000 reports / month</span>{' '}
              with no credit card &mdash; while you decide.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href={repoUrl()}
              className="inline-flex items-center gap-2 rounded-sm border border-[var(--mushi-rule)] bg-white/40 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--mushi-ink)] transition hover:border-[var(--mushi-vermillion)] hover:text-[var(--mushi-vermillion)]"
            >
              Read the source
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href={docsUrl('/quickstart')}
              className="inline-flex items-center gap-2 rounded-sm px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:text-[var(--mushi-vermillion)]"
            >
              Self-host guide
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-sm px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:text-[var(--mushi-vermillion)]"
            >
              Try the free cloud
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </article>

        <details className="group rounded-xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_94%,white)] open:bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)]">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)] transition group-hover:text-[var(--mushi-vermillion)]">
            <span>Don&rsquo;t want to host? Cloud tiers ↓</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)]">
              Same code · cancel anytime
            </span>
          </summary>
          <ul className="divide-y divide-[var(--mushi-rule)] border-t border-[var(--mushi-rule)]">
            {pricingTiers
              .filter((tier) => tier.name !== 'Hobby')
              .map((tier) => (
                <li
                  key={tier.name}
                  className="grid grid-cols-[4.5rem_auto_1fr_auto] items-center gap-3 px-5 py-2.5 sm:gap-4"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
                    {tier.name}
                  </span>
                  <span className="flex items-baseline gap-1">
                    <span className="font-serif text-base font-semibold leading-none tracking-[-0.02em] text-[var(--mushi-ink)] sm:text-lg">
                      {tier.price}
                    </span>
                    <span className="hidden font-mono text-[9px] text-[var(--mushi-ink-muted)] sm:inline">
                      {tier.cadence}
                    </span>
                  </span>
                  <span className="hidden text-[11px] leading-snug text-[var(--mushi-ink-muted)] sm:inline">
                    {tier.headline}
                  </span>
                  <Link
                    href={tier.cta.href}
                    className="justify-self-end rounded-sm border border-[var(--mushi-rule)] px-2.5 py-1 text-center font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition-colors hover:border-[var(--mushi-vermillion)] hover:text-[var(--mushi-vermillion)]"
                  >
                    {tier.cta.label}
                  </Link>
                </li>
              ))}
          </ul>
          <p className="border-t border-[var(--mushi-rule)] px-5 py-2 text-[11px] leading-5 text-[var(--mushi-ink-muted)]">
            Add-ons:{' '}
            {addOns.map((addon, i) => (
              <span key={addon.name}>
                <span className="text-[var(--mushi-ink)]">{addon.name.toLowerCase()}</span>{' '}
                <span className="font-mono text-[var(--mushi-vermillion)]">{addon.price}</span>
                {i < addOns.length - 1 ? ' · ' : ''}
              </span>
            ))}
            . Volume / annual &mdash;{' '}
            <Link href={contactMailto('Volume or annual pricing')} className="underline decoration-[var(--mushi-vermillion)] underline-offset-4 hover:text-[var(--mushi-vermillion)]">
              talk to us
            </Link>
            .
          </p>
        </details>
      </section>

      <ClosingCta />
      <MarketingFooter />
    </main>
  )
}
