import Link from 'next/link'
import { contactMailto, docsUrl, repoUrl } from '@/lib/links'
import { StatusPill } from './StatusPill'

export function MarketingFooter() {
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
            Open source repair loop &mdash; hosted by us, or run it inside your
            own VPC.
          </p>
          <StatusPill />
        </div>

        <nav aria-label="Site" className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em]">
          <Link href="#loop" className="hover:text-[var(--mushi-vermillion)]">Loop</Link>
          <Link href="#pricing" className="hover:text-[var(--mushi-vermillion)]">Pricing</Link>
          <Link href={docsUrl()} className="hover:text-[var(--mushi-vermillion)]">Docs</Link>
          <Link href={repoUrl()} className="hover:text-[var(--mushi-vermillion)]">GitHub</Link>
          <Link href={repoUrl('/blob/master/CHANGELOG.md')} className="hover:text-[var(--mushi-vermillion)]">Changelog</Link>
          <Link href={contactMailto('Mushi Mushi inquiry')} className="hover:text-[var(--mushi-vermillion)]">Contact</Link>
        </nav>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--mushi-rule)] pt-4 font-mono text-[10px] uppercase tracking-[0.22em]">
        <p>© Mushi Mushi · Cloud runs the same OSS code, hosted by us.</p>
        <p className="text-[var(--mushi-ink-muted)]" lang="ja">むしむし。</p>
      </div>
    </footer>
  )
}
