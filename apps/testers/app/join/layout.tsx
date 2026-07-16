import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Metadata lives here because page.tsx is a client component (reads ?app=
// via useSearchParams) and client components cannot export metadata.
export const metadata: Metadata = {
  title: 'Join as a tester',
  description:
    'Sign up for Mushi Bounties — test real apps, file bug reports, and earn mushi-points redeemable for Mushi Pro credit or gift cards.',
  alternates: { canonical: 'https://kensaur.us/mushi-mushi/testers/join/' },
}

export default function JoinLayout({ children }: { children: ReactNode }) {
  return children
}
