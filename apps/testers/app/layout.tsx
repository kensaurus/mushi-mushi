/**
 * Root layout for the Mushi Bounties tester marketplace.
 * Dark editorial theme via --mushi-* brand tokens (Bounties is always dark).
 */
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

const SITE = 'https://kensaur.us/mushi-mushi/testers'

export const viewport: Viewport = {
  themeColor: '#0e0d0b', // editorialTokens.ink — Bounties is always dark
}

export const metadata: Metadata = {
  metadataBase: new URL('https://kensaur.us/mushi-mushi'),
  title: {
    default: 'Mushi Bounties — get paid to find bugs',
    template: '%s · Mushi Bounties',
  },
  description:
    'Browse apps, find bugs, earn mushi-points redeemable for Mushi Pro credit or gift cards.',
  robots: { index: true, follow: true },
  // No `alternates.canonical` here — metadata inheritance would stamp the
  // homepage canonical onto every page that doesn't override it. Each page
  // declares its own.
  // Fully-absolute asset URLs: Next joins metadataBase.pathname onto
  // root-relative URLs, which would double the /mushi-mushi prefix.
  icons: { icon: [{ url: `${SITE}/favicon.svg`, type: 'image/svg+xml' }] },
  openGraph: {
    siteName: 'Mushi Bounties',
    type: 'website',
    url: `${SITE}/`,
    images: [{ url: `${SITE}/og-card.png`, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@mushimushi_dev',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-mushi-theme="dark">
      <body className="antialiased">{children}</body>
    </html>
  )
}
