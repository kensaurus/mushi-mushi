/**
 * FILE: apps/testers/app/components/TestersFooter.tsx
 * PURPOSE: Shared footer for Mushi Bounties public marketplace routes.
 */
import Link from 'next/link'

export function TestersFooter() {
  return (
    <footer className="border-t border-[var(--mushi-rule)] py-8 text-center text-sm testers-faint">
      <p>
        <span className="testers-brand-mark">mushi</span>mushi Bounties ·{' '}
        <Link href="/apps/" className="hover:text-[var(--mushi-ink-muted)] motion-safe:transition-colors">
          Browse apps
        </Link>
        {' · '}
        <Link href="/how-it-works/" className="hover:text-[var(--mushi-ink-muted)] motion-safe:transition-colors">
          How it works
        </Link>
        {' · '}
        <Link href="/leaderboard/" className="hover:text-[var(--mushi-ink-muted)] motion-safe:transition-colors">
          Leaderboard
        </Link>
        {' · '}
        Gift cards powered by Tremendous · $599/yr cap before KYC
      </p>
      {/* Legal pages live in the docs export (another basePath), so these are
          plain absolute <a>s — next/link would prepend /mushi-mushi/testers. */}
      <p className="mt-3">
        <a href="https://kensaur.us/mushi-mushi/docs/legal/privacy" className="hover:text-[var(--mushi-ink-muted)] motion-safe:transition-colors">
          Privacy
        </a>
        {' · '}
        <a href="https://kensaur.us/mushi-mushi/docs/legal/terms" className="hover:text-[var(--mushi-ink-muted)] motion-safe:transition-colors">
          Terms
        </a>
        {' · '}
        <a href="https://kensaur.us/mushi-mushi/docs/security" className="hover:text-[var(--mushi-ink-muted)] motion-safe:transition-colors">
          Security
        </a>
        {' · '}
        <a href="mailto:kensaurus@gmail.com" className="hover:text-[var(--mushi-ink-muted)] motion-safe:transition-colors">
          Contact
        </a>
      </p>
    </footer>
  )
}
