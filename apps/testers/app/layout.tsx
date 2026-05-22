import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Mushi Bounties — earn rewards, find real bugs',
    template: '%s | Mushi Bounties',
  },
  description:
    'Join the Mushi Bounties crowd-testing marketplace. Pick an app, find a bug, earn mushi-points redeemable for Mushi Pro credit or 100+ gift cards.',
  metadataBase: new URL('https://kensaur.us'),
  openGraph: {
    siteName: 'Mushi Bounties',
    type: 'website',
    locale: 'en_US',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        {children}
      </body>
    </html>
  )
}
