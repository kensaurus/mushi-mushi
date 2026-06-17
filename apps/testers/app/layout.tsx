/**
 * Root layout for the Mushi Bounties tester marketplace.
 * Dark editorial theme via --mushi-* brand tokens (Bounties is always dark).
 */
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Mushi Bounties',
    template: '%s · Mushi Bounties',
  },
  description:
    'Browse apps, find bugs, earn mushi-points redeemable for Mushi Pro credit or gift cards.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-mushi-theme="dark">
      <body className="antialiased">{children}</body>
    </html>
  )
}
