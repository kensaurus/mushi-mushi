import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Mushi Mushi Cloud — Bug intelligence that fixes itself',
    template: '%s — Mushi Mushi Cloud',
  },
  description:
    'Sign up for Mushi Mushi Cloud. Pay only for the reports you ingest. 1,000 reports/month free.',
  metadataBase: new URL('https://mushimushi.dev'),
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
