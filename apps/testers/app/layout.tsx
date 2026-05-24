/**
 * Root layout for the Mushi Bounties tester marketplace.
 * Provides <html> and <body> tags required by Next.js App Router.
 */
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
// Tailwind CSS is loaded via PostCSS at the app level — no explicit import needed
// when using @tailwindcss/postcss with Turbopack.

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
    <html lang="en">
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  )
}
