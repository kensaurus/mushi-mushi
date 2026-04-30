'use client'

/**
 * FILE: packages/marketing-ui/src/SwitchingFromStrip.tsx
 * PURPOSE: "Switching from <competitor>?" strip rendered on the marketing
 *          surfaces (admin's PublicHomePage and the cloud landing).
 *
 * Five low-key chips, one per competitor with a published migration guide.
 * Each links into the relevant /migrations/<slug> page on the docs site
 * via the `urls.docs(...)` helper from the MarketingProvider so the
 * package stays framework-agnostic (cloud uses next/link, admin uses
 * react-router; both end up at the same Nextra page).
 *
 * Visual budget: one editorial line, deliberately quieter than the
 * <Hero /> and <ClosingCta /> cards above and below it. We don't want
 * "switching from Instabug" to be the loudest line on the page — it's
 * a discovery surface for the ~5 % of visitors who arrive with a
 * competitor in mind.
 */

import { useMarketing } from './context'

interface Competitor {
  /** Display label as it appears on the chip. */
  label: string
  /** Migration guide slug (must exist in apps/docs/content/migrations/). */
  slug: string
}

const COMPETITORS: readonly Competitor[] = [
  { label: 'Instabug / Luciq', slug: 'instabug-to-mushi' },
  { label: 'Shake', slug: 'shake-to-mushi' },
  { label: 'LogRocket', slug: 'logrocket-feedback-to-mushi' },
  { label: 'BugHerd', slug: 'bugherd-to-mushi' },
  { label: 'Pendo', slug: 'pendo-feedback-to-mushi' },
]

export function SwitchingFromStrip() {
  const { Link, urls } = useMarketing()

  return (
    <section
      aria-labelledby="switching-from-heading"
      className="rounded-[1.5rem] border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_94%,white)] px-5 py-5 sm:px-7 sm:py-6"
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="space-y-1">
          {/* Eyebrow is plain English — the kana scaffold (`のりかえ — switching?`)
              was loan-text decoration that asked the reader to translate before
              they could read the section. The page's Japanese budget (one
              phrase max, see docs/marketing/VOICE.md) is spent on the footer
              wink, not here. */}
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--mushi-ink-muted)]">
            <span className="text-[var(--mushi-ink)]">Coming from</span>
            <span className="mx-2 opacity-40">/</span>
            another tool?
          </p>
          <h2
            id="switching-from-heading"
            className="max-w-md font-serif text-xl leading-snug tracking-[-0.02em] text-[var(--mushi-ink)] sm:text-2xl"
          >
            We&rsquo;ve already mapped the move.
          </h2>
          <p className="max-w-md text-sm text-[var(--mushi-ink-muted)]">
            Each guide walks you through the rename, what to keep, and what
            changes &mdash; your existing widget keeps working until you cut
            over.
          </p>
        </div>
        {/* Migration chips. Each links to a real, published migration guide
            in the docs site (`apps/docs/content/migrations/<slug>.mdx`)
            opened in a new tab — the chip is a discovery surface for
            visitors who arrived with a competitor in mind, so we don't
            want to bounce them off the landing on first click. */}
        <ul className="flex flex-wrap gap-1.5 sm:max-w-md sm:justify-end">
          {COMPETITORS.map((c) => (
            <li key={c.slug}>
              <Link
                href={urls.docs(`/migrations/${c.slug}`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)] px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:-translate-y-0.5 hover:border-[var(--mushi-vermillion)] hover:text-[var(--mushi-vermillion)]"
              >
                {c.label}
                <span aria-hidden className="text-[var(--mushi-vermillion)]">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
