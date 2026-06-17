/**
 * FILE: apps/testers/app/components/TestersNav.tsx
 * PURPOSE: Shared sticky nav for all Mushi Bounties public marketplace routes.
 */
import Link from 'next/link'

const BASE = '/mushi-mushi/testers'

export function TestersNav() {
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? '/mushi-mushi/console'

  return (
    <nav className="testers-nav sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href={`${BASE}/`} className="text-lg font-bold text-[var(--mushi-ink)]">
          <span className="testers-brand-mark">mushi</span>mushi
          <span className="testers-badge ml-2">Bounties</span>
        </Link>
        <div className="hidden items-center gap-4 text-sm sm:flex">
          <Link href={`${BASE}/apps/`} className="testers-muted hover:text-[var(--mushi-ink)] motion-safe:transition-colors">
            Apps
          </Link>
          <Link href={`${BASE}/how-it-works/`} className="testers-muted hover:text-[var(--mushi-ink)] motion-safe:transition-colors">
            How it works
          </Link>
          <Link href={`${BASE}/leaderboard/`} className="testers-muted hover:text-[var(--mushi-ink)] motion-safe:transition-colors">
            Leaderboard
          </Link>
        </div>
        <a
          href={`${adminUrl}/login?as=tester`}
          className="testers-cta px-4 py-1.5 text-sm"
        >
          Sign in as tester
        </a>
      </div>
    </nav>
  )
}
