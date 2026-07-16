import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Metadata lives here because page.tsx is a client component ('use client'
// for the filter rail) and client components cannot export metadata.
export const metadata: Metadata = {
  title: 'Apps to test — find bugs, earn bounties',
  description:
    'The full Mushi Bounties catalog — web and mobile apps looking for testers. Pick one, find a real bug, earn mushi-points.',
  alternates: { canonical: 'https://kensaur.us/mushi-mushi/testers/apps/' },
}

export default function AppsLayout({ children }: { children: ReactNode }) {
  return children
}
