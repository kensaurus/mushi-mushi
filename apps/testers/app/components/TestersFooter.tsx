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
    </footer>
  )
}
