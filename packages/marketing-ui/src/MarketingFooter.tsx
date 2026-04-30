'use client'

import { useMarketing } from './context'
import { StatusPill } from './StatusPill'

interface MarketingFooterProps {
  /**
   * Optional: full URL to the gateway `/health` endpoint that <StatusPill />
   * polls. When omitted (or empty) the pill shows the muted "unknown" state
   * instead of pretending the gateway is healthy. Cloud passes its
   * NEXT_PUBLIC_API_BASE_URL; admin can pass undefined to skip the live probe.
   */
  apiBaseUrl?: string
}

export function MarketingFooter({ apiBaseUrl }: MarketingFooterProps) {
  const { Link, urls } = useMarketing()

  return (
    <footer className="border-t border-[var(--mushi-rule)] pb-4 pt-6 text-sm text-[var(--mushi-ink-muted)]">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-sm">
          <div className="flex items-center gap-2 font-serif text-base font-semibold text-[var(--mushi-ink)]">
            <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-sm bg-[var(--mushi-vermillion)] font-mono text-[10px] text-white">
              虫
            </span>
            Mushi Mushi
          </div>
          <p className="mt-2 leading-6">
            Small SDK, honest classifier, optional auto-fix. Run it yourself
            or let us host.
          </p>
          <StatusPill apiBaseUrl={apiBaseUrl} />
        </div>

        {/* Footer nav. Reader is by definition past the loop section here, so
            "Loop" (which scrolls back UP to #loop) was redundant with the
            sticky header's own Loop link AND confusing as a primary footer
            item — a footer answers "where do I go next?", not "let me show
            you the section you just left". Removed for clarity.
            Pricing routes to the real /docs/cloud#plans table (the earlier
            `#pricing` anchor was a dead hash). All cross-site links open in
            a new tab so a visitor reading the landing doesn't lose context;
            mailto: stays default. */}
        <nav aria-label="Site" className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em]">
          <Link href={urls.pricing} target="_blank" rel="noreferrer" className="hover:text-[var(--mushi-vermillion)]">Pricing</Link>
          <Link href={urls.docs()} target="_blank" rel="noreferrer" className="hover:text-[var(--mushi-vermillion)]">Docs</Link>
          <Link href={urls.repo()} target="_blank" rel="noreferrer" className="hover:text-[var(--mushi-vermillion)]">GitHub</Link>
          <Link href={urls.repo('/blob/master/CHANGELOG.md')} target="_blank" rel="noreferrer" className="hover:text-[var(--mushi-vermillion)]">Changelog</Link>
          <Link href={urls.contact('Mushi Mushi inquiry')} className="hover:text-[var(--mushi-vermillion)]">Contact</Link>
        </nav>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--mushi-rule)] pt-4 font-mono text-[10px] uppercase tracking-[0.22em]">
        <p>© Mushi Mushi · Cloud runs the same OSS code, hosted by us.</p>
        <p className="text-[var(--mushi-ink-muted)]" lang="ja">むしむし。</p>
      </div>
    </footer>
  )
}
