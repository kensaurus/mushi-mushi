/**
 * FILE: apps/admin/src/components/tester/TesterLayout.tsx
 * PURPOSE: Layout wrapper for tester-facing pages.
 * Nav: Home / Apps / Wallet / Learn / Settings
 * Right side: live balance + reputation tier pill linking to /tester/wallet.
 */

import type { ReactNode } from 'react'
import { useTesterStatus, reputationTier } from '../../lib/useTesterStatus'

interface TesterLayoutProps {
  children: ReactNode
  title?: string
}

const NAV_LINKS = [
  { href: '/tester',          label: 'Home' },
  { href: '/tester/apps',     label: 'Apps' },
  { href: '/tester/wallet',   label: 'Wallet' },
  { href: '/tester/learn',    label: 'Learn' },
  { href: '/tester/settings', label: 'Settings' },
]

function BalancePill() {
  const { data: status } = useTesterStatus()
  if (!status?.isTester) return null
  const tier = reputationTier(status.reputation)
  return (
    <a
      href="/tester/wallet"
      className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium transition-opacity hover:opacity-80 ${tier.bg} ${tier.color}`}
      title="Your mushi-points balance — click to redeem"
    >
      <span>🪙</span>
      <span>{status.balance.toLocaleString()} pts</span>
      <span className="opacity-60">·</span>
      <span>{tier.name}</span>
    </a>
  )
}

export function TesterLayout({ children, title }: TesterLayoutProps) {
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''

  function isActive(href: string) {
    if (href === '/tester') return currentPath === '/tester' || currentPath === '/tester/'
    return currentPath.startsWith(href)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-gray-950/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-4xl items-center gap-1 px-4">
          <a href="/mushi-mushi/testers/" className="shrink-0 text-sm font-bold mr-2">
            <span className="text-violet-400">mushi</span>mushi
            <span className="ml-1.5 rounded-sm bg-violet-500/20 px-1.5 py-0.5 text-xs font-medium text-violet-400">
              🪲 Bounties
            </span>
          </a>
          <div className="flex items-center gap-0.5 text-sm flex-1">
            {NAV_LINKS.map(l => (
              <a
                key={l.href}
                href={l.href}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  isActive(l.href)
                    ? 'bg-violet-500/15 text-violet-300 font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {l.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            <BalancePill />
            {title && <p className="text-xs text-gray-500 hidden md:block">{title}</p>}
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-4xl px-4 py-8">
        {children}
      </main>
    </div>
  )
}
